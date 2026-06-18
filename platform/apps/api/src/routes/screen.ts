/**
 * routes/screen.ts — stepwise screening session endpoints
 *
 * POST /api/screen/start   { studyId, name? }
 *   → { sessionId, greeting, consent: true, done: false }
 *
 * POST /api/screen/answer  { sessionId, text }
 *   → { ack?, prompt?, done, terminal?, reason?, deferred?, closing?, redirected?, trace? }
 *
 * ── Conversational layer ─────────────────────────────────────────────────────
 * The conversational layer (consent gate, ACK, deflection, closing) is
 * PRESENTATION-ONLY. It NEVER calls screenPatient() directly, never writes to
 * session.ans, and never changes the engine verdict. The verdict is produced
 * exclusively by stepSession() → finishSession() → screenPatient(), so the
 * equivalence invariant (stepwise terminal == screenPatient terminal for the
 * same answers) is always preserved.
 *
 *   consent gate  — greet, wait for affirmative before starting clinical Qs
 *   ACK           — "Got it." prepended on each successful answer advance
 *   deflection    — patient asked a question → redirect without advancing
 *   closing       — human-friendly text appended when session reaches terminal
 *
 * In-memory Map (TODO: swap for Redis in production — see comment below).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FastifyInstance } from 'fastify';
import { loadStudy } from '../lib/studies.js';
import {
  startSession,
  stepSession,
  finishSession,
  sessionPrompt,
  makeExtractor,
  type Session,
} from '../lib/engine-shim.js';
import {
  convoGreeting,
  convoClosing,
  isQuestionLike,
  DEFLECTION,
  ACK,
  CONSENT_YES,
  CONSENT_NO,
} from '../lib/convo.js';

// ── session store ─────────────────────────────────────────────────────────────
// The conversational layer wraps the engine Session with presentation-only state
// (consent phase, the deferred first prompt). These fields never touch the verdict.
type ApiSession = Session & {
  phase?: 'consent' | 'screening';
  firstPrompt?: string | null;
  studyName?: string;
};
// In-memory Map. For production, replace with a Redis adapter that implements
// the same get/set/delete interface — the session object is plain JSON-serialisable.
const SERVER_SESSIONS = new Map<string, ApiSession>();

// ── route definitions ─────────────────────────────────────────────────────────

interface StartBody {
  studyId: string;
  name?: string;
}

interface AnswerBody {
  sessionId: string;
  text?: string;
}

export async function screenRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/screen/start
  app.post<{ Body: StartBody }>('/screen/start', async (req, reply) => {
    const { studyId, name } = req.body;
    if (!studyId || typeof studyId !== 'string') {
      return reply.code(400).send({ error: 'studyId required' });
    }
    const S = loadStudy(studyId);
    if (!S) return reply.code(404).send({ error: 'study not found' });

    const extractor = makeExtractor('rule');
    // NOTE: swap makeExtractor('llm') when @comforceeva/extractor is wired and
    //       ANTHROPIC_API_KEY is set — the engine-shim will fall back to 'rule'
    //       if the key is absent, preserving determinism.

    const sess: ApiSession = startSession(S, extractor);
    // greeting doubles as the consent question; the first clinical question is
    // deferred until the first affirmative reply.
    sess.phase = 'consent';
    sess.firstPrompt = sessionPrompt(sess);
    sess.studyName = S.study?.name ?? studyId;
    SERVER_SESSIONS.set(sess.id, sess);

    return reply.send({
      sessionId: sess.id,
      greeting: convoGreeting(S, name),
      consent: true,
      done: false,
    });
  });

  // POST /api/screen/answer
  app.post<{ Body: AnswerBody }>('/screen/answer', async (req, reply) => {
    const { sessionId, text: rawText } = req.body;
    const text = rawText ?? '';

    const sess = SERVER_SESSIONS.get(sessionId);
    if (!sess) return reply.code(404).send({ error: 'session not found' });
    const S = sess.S;

    // ── consent gate (presentation only) ──────────────────────────────────────
    // The consent gate runs BEFORE any clinical question is presented. It uses
    // isQuestionLike / CONSENT_YES / CONSENT_NO to decide whether to start
    // screening, deflect, or decline. It never touches sess.ans or the engine.
    if (sess.phase === 'consent') {
      if (isQuestionLike(text)) {
        // Patient asked a question before consenting → deflect, repeat greeting
        return reply.send({
          done: false,
          ack: DEFLECTION,
          prompt: convoGreeting(S),
          redirected: true,
        });
      }
      if (CONSENT_NO.test(text) && !CONSENT_YES.test(text)) {
        // Explicit decline → close without entering engine
        SERVER_SESSIONS.delete(sessionId);
        return reply.send({
          done: true,
          terminal: 'INCOMPLETE',
          reason: 'Declined to start screening',
          deferred: [],
          trace: [],
          closing: convoClosing(S, 'INCOMPLETE'),
        });
      }
      // Affirmative (or anything else) → begin clinical questions
      sess.phase = 'screening';
      return reply.send({ done: false, prompt: sess.firstPrompt });
    }

    // ── screening phase ───────────────────────────────────────────────────────
    // Patient asked a question → deflect without advancing the engine cursor
    if (isQuestionLike(text)) {
      // Find the current prompt from the session position (do NOT advance)
      const currentQ = sess.qs[sess.i];
      const currentPrompt = currentQ ? currentQ.sms_question : null;
      return reply.send({
        done: false,
        ack: DEFLECTION,
        prompt: currentPrompt,
        redirected: true,
      });
    }

    // Hand the text to the engine (the ONLY place that changes sess.ans / verdict)
    const turn = stepSession(sess, text);

    if (turn.done) {
      // Terminal: remove session and attach closing message (presentation only)
      SERVER_SESSIONS.delete(sessionId);
      const terminal =
        turn.terminal === 'QUALIFIED' || turn.terminal === 'DNQ' || turn.terminal === 'INCOMPLETE'
          ? turn.terminal
          : 'INCOMPLETE';
      return reply.send({
        ...turn,
        closing: convoClosing(S, terminal),
      });
    }

    // Ongoing: prepend ACK unless we're re-asking for clarification
    return reply.send({
      ...turn,
      ack: turn.needs_clarification ? undefined : ACK,
    });
  });
}

// Export for testing
export { SERVER_SESSIONS };
