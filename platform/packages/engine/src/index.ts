/**
 * @comforceeva/engine — PURE deterministic screening engine.
 * No fs, no http, no LLM. All I/O lives in callers; LLM lives in @comforceeva/extractor.
 *
 * Ported verbatim from studygen.mjs (evalCond, norm, screenPatient,
 * compileQuestions, startSession/stepSession/finishSession, parseAnswerTxt).
 */
import type { Study, ScreeningQuestion, TraceRow } from '@comforceeva/schema';

// ---------------------------------------------------------------------------
// Public result types
// ---------------------------------------------------------------------------

export interface ScreenResult {
  terminal: 'QUALIFIED' | 'DNQ' | 'INCOMPLETE';
  reason: string | null;
  failed?: string;
  criteria_ids?: string[];
  deferred: string[];
  trace: TraceRow[];
}

export interface StepResult {
  done: boolean;
  prompt?: string;
  terminal?: 'QUALIFIED' | 'DNQ' | 'INCOMPLETE';
  reason?: string | null;
  deferred?: string[];
  trace?: TraceRow[];
  needs_clarification?: boolean;
}

export interface Session {
  id: string;
  S: Study;
  qs: ScreeningQuestion[];
  i: number;
  ans: Record<string, unknown>;
  trace: TraceRow[];
  maxReask: number;
  reaskCount: number;
  done: boolean;
  /** caller-supplied extraction function */
  extractor: ExtractFn;
  ctx?: Record<string, unknown>;
}

/** Contract for a pluggable answer extractor (rule or llm). */
export type ExtractFn = (
  q: ScreeningQuestion,
  replyText: string,
  ctx?: Record<string, unknown>,
) => ExtractResult;

export interface ExtractResult {
  value: unknown;
  confidence: number;
  needs_clarification: boolean;
  skip?: boolean;
}

// ---------------------------------------------------------------------------
// norm — normalize a raw answer for yes/no comparisons (lowercase).
// Ported from studygen.mjs `norm`.
// ---------------------------------------------------------------------------
export function norm(v: unknown): unknown {
  return typeof v === 'string' ? v.trim().toLowerCase() : v;
}

// ---------------------------------------------------------------------------
// evalCond — safe new Function evaluator for disqualify_condition / show_if.
// Supports expressions like:
//   answer == no
//   age < 18 || age > 65
//   sex_at_birth == "Female"
// Constants (yes, no, Female, Male) are injected as named parameters.
// Returns:
//   true  — condition is satisfied
//   false — condition is NOT satisfied (or expression threw)
//   undefined — could not evaluate (e.g. missing variable)
// Ported verbatim from studygen.mjs `evalCond`.
// ---------------------------------------------------------------------------
export function evalCond(
  expr: string,
  scope: Record<string, unknown>,
): boolean | undefined {
  if (!expr) return false;
  const keys = Object.keys(scope);
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...keys, `"use strict"; return (${expr});`) as (
      ...args: unknown[]
    ) => unknown;
    return !!fn(...keys.map((k) => scope[k]));
  } catch {
    return undefined; // missing answer or syntax error → can't evaluate
  }
}

// ---------------------------------------------------------------------------
// compileQuestions — return questions sorted by rank.
// Ported from studygen.mjs `compileQuestions`.
// ---------------------------------------------------------------------------
export function compileQuestions(S: Study): ScreeningQuestion[] {
  return (S.screeningQuestions ?? [])
    .slice()
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

// ---------------------------------------------------------------------------
// parseAnswerTxt — parse key:value text file into answers object.
// Supports `variable_name: value` or `alias = value` lines.
// Ported from studygen.mjs `parseAnswerTxt`.
// ---------------------------------------------------------------------------
export function parseAnswerTxt(txt: string): Record<string, string> {
  const a: Record<string, string> = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([\w.\- ]+?)\s*[:=]\s*(.+?)\s*$/);
    if (m) {
      const key = m[1]!.trim().replace(/\s+/g, '_').toLowerCase();
      a[key] = m[2]!.trim();
    }
  }
  return a;
}

// ---------------------------------------------------------------------------
// screenPatient — deterministic batch verdict.
//
// Rules (CRITICAL — reproduce exactly from studygen.mjs):
//  1. Questions in rank order.
//  2. show_if false → skip (no disqualify, no missing).
//  3. routing questions collect a value but never disqualify.
//  4. A DISCLOSED disqualifier wins even over earlier missing answers
//     (scan all answered; first disqualifier in rank order = DNQ).
//  5. Else any required-missing → INCOMPLETE.
//  6. Else QUALIFIED.
//  yes/no answers normalised lowercase; sex/choice values kept original case.
// ---------------------------------------------------------------------------
export function screenPatient(
  S: Study,
  answersIn: Record<string, unknown>,
): ScreenResult {
  const qs = compileQuestions(S);
  const ans: Record<string, unknown> = { ...(answersIn ?? {}) };

  // derive numeric `age` alias from the number question
  const ageQ = qs.find((q) => q.answer_type === 'number');
  if (ageQ != null && ans[ageQ.variable_name] != null) {
    ans['age'] = Number(ans[ageQ.variable_name]);
  }

  // constants so bareword conditions (answer == yes / sex_at_birth == "Female") resolve
  const base: Record<string, unknown> = {
    ...ans,
    yes: 'yes',
    no: 'no',
    Female: 'Female',
    Male: 'Male',
  };

  const trace: TraceRow[] = [];
  let dnq: {
    failed: string;
    reason: string;
    criteria_ids: string[];
  } | null = null;
  const missing: string[] = [];
  const deferred: string[] = [];

  for (const q of qs) {
    // show_if gate
    if (q.show_if != null) {
      const shown = evalCond(q.show_if, base);
      if (shown === false) {
        trace.push({ rank: q.rank, variable: q.variable_name, shown: false });
        continue;
      }
    }

    // retrieve and normalise the answer
    let val: unknown =
      ageQ != null && q.variable_name === ageQ.variable_name
        ? ans['age']
        : ans[q.variable_name];
    if (q.answer_type === 'yes_no') val = norm(val);

    const known = val != null && val !== '';
    const scope: Record<string, unknown> = { ...base, answer: val };
    const disq =
      q.disqualify_condition != null
        ? evalCond(q.disqualify_condition, scope)
        : false;

    trace.push({
      rank: q.rank,
      variable: q.variable_name,
      question: q.sms_question,
      answer: val ?? null,
      shown: true,
      known,
      disqualified: disq === true,
    });

    // routing questions never disqualify
    if (q.routing === true) continue;

    // A disclosed disqualifier wins even if earlier answers are missing.
    if (known && disq === true && dnq === null) {
      dnq = {
        failed: q.variable_name,
        reason: `DNQ — ${q.sms_question}`,
        criteria_ids: q.criteria_ids ?? [],
      };
    } else if (!known) {
      if (q.defer_if_unanswered === true) {
        deferred.push(q.variable_name);
      } else {
        missing.push(q.variable_name);
      }
    }
  }

  if (dnq !== null) {
    return { terminal: 'DNQ', ...dnq, deferred, trace };
  }
  if (missing.length > 0) {
    return {
      terminal: 'INCOMPLETE',
      failed: missing[0],
      reason: `Missing answer(s): ${missing.join(', ')}`,
      deferred,
      trace,
    };
  }
  return {
    terminal: 'QUALIFIED',
    deferred,
    reason:
      deferred.length > 0
        ? `Pre-qualified; confirm at visit: ${deferred.join(', ')}`
        : null,
    trace,
  };
}

// ---------------------------------------------------------------------------
// sessScope — build the evaluation scope for a session, mirroring screenPatient.
// Ported from studygen.mjs `sessScope`.
// ---------------------------------------------------------------------------
function sessScope(
  sess: Session,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const ageQ = sess.qs.find((q) => q.answer_type === 'number');
  const s: Record<string, unknown> = {
    ...sess.ans,
    yes: 'yes',
    no: 'no',
    Female: 'Female',
    Male: 'Male',
    ...(extra ?? {}),
  };
  if (ageQ != null && sess.ans[ageQ.variable_name] != null) {
    s['age'] = Number(sess.ans[ageQ.variable_name]);
  }
  return s;
}

// ---------------------------------------------------------------------------
// advance — move the cursor to the next question whose show_if passes.
// Records skipped questions in trace.
// Ported from studygen.mjs `advance`.
// ---------------------------------------------------------------------------
function advance(sess: Session): ScreeningQuestion | null {
  for (let k = sess.i + 1; k < sess.qs.length; k++) {
    const q = sess.qs[k]!;
    if (
      q.show_if != null &&
      evalCond(q.show_if, sessScope(sess)) === false
    ) {
      sess.trace.push({
        rank: q.rank,
        variable: q.variable_name,
        shown: false,
      });
      continue;
    }
    sess.i = k;
    return q;
  }
  sess.i = sess.qs.length;
  return null;
}

// ---------------------------------------------------------------------------
// reaskText — friendly clarification prompt per answer type.
// Ported from studygen.mjs `reaskText`.
// ---------------------------------------------------------------------------
function reaskText(q: ScreeningQuestion): string {
  if (q.answer_type === 'number') {
    return "Sorry, I didn't catch that — could you give me a number?";
  }
  if (q.answer_type === 'yes_no') {
    return 'Sorry, was that a yes or a no?';
  }
  if (q.answer_type === 'choice') {
    return `Please pick one: ${(q.choices ?? []).join(' or ')}.`;
  }
  return 'Sorry, could you say that again?';
}

// ---------------------------------------------------------------------------
// startSession — create a new stepwise session.
// Ported from studygen.mjs `startSession`.
// ---------------------------------------------------------------------------
export function startSession(
  S: Study,
  extractor: ExtractFn = defaultExtractor,
): Session {
  const qs = compileQuestions(S);
  const sess: Session = {
    id: 'sess_' + Math.random().toString(36).slice(2, 10),
    S,
    qs,
    extractor,
    i: -1,
    ans: {},
    trace: [],
    maxReask: 2,
    reaskCount: 0,
    done: false,
  };
  advance(sess); // position at the first applicable question
  return sess;
}

// ---------------------------------------------------------------------------
// finishSession — delegate the final verdict to screenPatient with collected
// answers, ensuring server verdict === batch verdict for the same answers.
// Ported from studygen.mjs `finishSession`.
// ---------------------------------------------------------------------------
export function finishSession(sess: Session): StepResult {
  sess.done = true;
  const r = screenPatient(sess.S, sess.ans);
  return {
    done: true,
    terminal: r.terminal,
    reason: r.reason ?? null,
    deferred: r.deferred,
    trace: r.trace,
  };
}

// ---------------------------------------------------------------------------
// stepSession — advance ONE question with `text`.
// Returns { prompt?, done, terminal?, reason?, deferred?, trace?, needs_clarification? }.
// Ported from studygen.mjs `stepSession`.
// ---------------------------------------------------------------------------
export function stepSession(sess: Session, text: string): StepResult {
  if (sess.done) return finishSession(sess);
  const q = sess.qs[sess.i];
  if (q == null) return finishSession(sess);

  const ex = sess.extractor(q, text, sess.ctx ?? {});

  // clarification re-ask
  if (ex.needs_clarification && sess.reaskCount < sess.maxReask) {
    sess.reaskCount++;
    return {
      done: false,
      prompt: reaskText(q) + ' ' + q.sms_question,
      needs_clarification: true,
    };
  }
  sess.reaskCount = 0;

  if (ex.value != null && !ex.needs_clarification) {
    sess.ans[q.variable_name] =
      q.answer_type === 'yes_no' ? norm(ex.value) : ex.value;
    const disq =
      q.disqualify_condition != null
        ? evalCond(
            q.disqualify_condition,
            sessScope(sess, { answer: sess.ans[q.variable_name] }),
          )
        : false;
    sess.trace.push({
      rank: q.rank,
      variable: q.variable_name,
      answer: sess.ans[q.variable_name],
      shown: true,
      known: true,
      disqualified: disq === true,
    });
    // a disclosed knockout ends the conversation immediately
    if (q.routing !== true && disq === true) return finishSession(sess);
  } else {
    // out of re-asks or explicit skip: leave unanswered; screenPatient will mark INCOMPLETE/deferred
    sess.trace.push({
      rank: q.rank,
      variable: q.variable_name,
      answer: null,
      shown: true,
      known: false,
    });
  }

  const next = advance(sess);
  if (next == null) return finishSession(sess);
  return { done: false, prompt: next.sms_question };
}

// ---------------------------------------------------------------------------
// sessionPrompt — return the current question's sms_question text (or null).
// ---------------------------------------------------------------------------
export function sessionPrompt(sess: Session): string | null {
  const q = sess.qs[sess.i];
  return q != null ? q.sms_question : null;
}

// ---------------------------------------------------------------------------
// defaultExtractor — a minimal pass-through extractor for the session API
// when no extractor is supplied by the caller (e.g. in tests that feed raw
// already-extracted values). In production, callers supply the rule or llm
// extractor from @comforceeva/extractor.
//
// This extractor just returns the text as-is (useful for structured replay
// where the caller passes the canonical value directly as the text argument).
// ---------------------------------------------------------------------------
const defaultExtractor: ExtractFn = (
  q: ScreeningQuestion,
  replyText: string,
): ExtractResult => {
  const t = (replyText ?? '').trim();
  if (!t) return { value: null, confidence: 0, needs_clarification: true };
  if (q.answer_type === 'number') {
    const m = t.match(/\d{1,3}/);
    if (m != null) return { value: Number(m[0]), confidence: 0.9, needs_clarification: false };
    return { value: null, confidence: 0, needs_clarification: true };
  }
  if (q.answer_type === 'yes_no') {
    const low = t.toLowerCase();
    const neg =
      /\b(no|nope|nah|never|not|none|negative)\b/.test(low) ||
      /\b(haven'?t|don'?t|didn'?t|doesn'?t|isn'?t|won'?t|can'?t)\b/.test(low) ||
      /^n$/.test(low);
    const pos =
      /\b(yes|yeah|yep|yup|ya|correct|sure|affirmative|definitely|absolutely|true|right|ok|okay)\b/.test(low) ||
      /^y$/.test(low) ||
      /\bi (have|had|did|do|am)\b/.test(low);
    if (pos && !neg) return { value: 'yes', confidence: 0.95, needs_clarification: false };
    if (neg && !pos) return { value: 'no', confidence: 0.95, needs_clarification: false };
    return { value: null, confidence: 0, needs_clarification: true };
  }
  if (q.answer_type === 'choice') {
    const low = t.toLowerCase();
    for (const ch of q.choices ?? []) {
      if (low.includes(ch.toLowerCase())) return { value: ch, confidence: 0.9, needs_clarification: false };
    }
    for (const ch of q.choices ?? []) {
      if (ch[0] != null && low === ch[0].toLowerCase()) return { value: ch, confidence: 0.8, needs_clarification: false };
    }
    if ((q.choices ?? []).includes('Female') && /\b(female|woman|girl)\b/.test(low)) return { value: 'Female', confidence: 0.9, needs_clarification: false };
    if ((q.choices ?? []).includes('Male') && /\b(male|man|boy)\b/.test(low)) return { value: 'Male', confidence: 0.9, needs_clarification: false };
    return { value: null, confidence: 0, needs_clarification: true };
  }
  // text type: return as-is
  return { value: t, confidence: 0.8, needs_clarification: false };
};

// Re-export schema types so engine consumers don't need a second import
export type {
  Study,
  ScreeningQuestion,
  Criterion,
  TraceRow,
} from '@comforceeva/schema';
