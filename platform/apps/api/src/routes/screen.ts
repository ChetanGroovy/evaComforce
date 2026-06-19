/**
 * routes/screen.ts — screening proxy to the Python engine service.
 *
 * The ENTIRE screening conversation — greeting, warm phrasing, Knowledge-Bank
 * answers, free-text understanding, BMI, the rules, never-lose — is owned by
 * OUR Python engine (Comforce.Engine), exposed over HTTP by engine_service.py.
 * This route is a THIN PROXY: it forwards the UI's calls to that service and
 * returns the JSON verbatim.
 *
 * Why a proxy and not TS logic?
 *   Clinical eligibility must have ONE source of truth. Reimplementing the
 *   engine in TypeScript would create a second copy that silently drifts from
 *   the proven Python brain. So the brain stays in Python; comforce_v2 is the
 *   face — Chetan's UI + question-generation, plus this transport shim.
 *
 *   POST /screen/start   { studyId, name? }  → { sessionId, greeting, consent, done }
 *   POST /screen/answer  { sessionId, text } → { done, prompt } | terminal payload
 *
 * Config:
 *   ENGINE_URL — base URL of the Python engine service (default http://127.0.0.1:7801)
 */

import type { FastifyInstance } from 'fastify';

const ENGINE_URL = process.env['ENGINE_URL'] ?? 'http://127.0.0.1:7801';

interface StartBody {
  studyId: string;
  name?: string;
}

interface AnswerBody {
  sessionId: string;
  text?: string;
}

// Forward a POST to the Python engine service and relay its status + JSON body.
async function forward(
  pathName: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const res = await fetch(`${ENGINE_URL}${pathName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json: unknown = await res.json().catch(() => ({ error: 'bad gateway' }));
  return { status: res.status, json };
}

const UNREACHABLE = (): { error: string } => ({
  error: `engine service unreachable — start engine_service.py (expected at ${ENGINE_URL})`,
});

export async function screenRoutes(app: FastifyInstance): Promise<void> {
  // POST /api/screen/start
  app.post<{ Body: StartBody }>('/screen/start', async (req, reply) => {
    const { studyId, name } = req.body;
    if (!studyId || typeof studyId !== 'string') {
      return reply.code(400).send({ error: 'studyId required' });
    }
    try {
      const { status, json } = await forward('/screen/start', { studyId, name });
      return reply.code(status).send(json);
    } catch (err) {
      req.log.error({ err }, 'engine service unreachable');
      return reply.code(502).send(UNREACHABLE());
    }
  });

  // POST /api/screen/answer
  app.post<{ Body: AnswerBody }>('/screen/answer', async (req, reply) => {
    const { sessionId, text } = req.body;
    if (!sessionId || typeof sessionId !== 'string') {
      return reply.code(400).send({ error: 'sessionId required' });
    }
    try {
      const { status, json } = await forward('/screen/answer', {
        sessionId,
        text: text ?? '',
      });
      return reply.code(status).send(json);
    } catch (err) {
      req.log.error({ err }, 'engine service unreachable');
      return reply.code(502).send(UNREACHABLE());
    }
  });
}
