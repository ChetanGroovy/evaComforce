// Deterministic HARD gate for humanised (warm / layperson) rewrites of a screening
// question's patient-facing `sms_question`. Phase-2 task P2-T3.
//
// The LLM that produces the warm rewrite is ADVISORY only. This function is the
// pass/fail authority and is 100% deterministic — no network, no model call. A
// humanised candidate is only accepted when:
//   1. Every STRUCTURAL field is byte-identical to the machine original (only
//      sms_question may change). criteria_ids compare order-insensitively;
//      choices compare deeply.
//   2. If the original carries a carve-out exception ("<entity> ... is OK —
//      answer no for that"), the rewrite preserves BOTH the named entity token
//      AND the carve-out answer-direction phrase. (Real case: WC45276 q8 cornea
//      transplant exception on disqualify_condition 'answer == yes'.)
//   3. The question is NOT an inverted-framing knockout (yes_no +
//      disqualify_condition 'answer == no', where "no" disqualifies). Those are
//      too easy to invert in plain language, so we keep the machine wording and
//      flag for human review.
//
// Any reject => caller keeps the machine wording (fail closed).

/** Loose structural shape of a screening question. Only the fields the gate inspects. */
export interface Question {
  variable_name?: string;
  sms_question?: string;
  disqualify_condition?: string;
  answer_type?: string;
  criteria_ids?: string[];
  bmi_cutoff?: number;
  choices?: unknown;
}

export interface AuditResult {
  accepted: boolean;
  reason?: string;
  review_flag?: string;
}

// ---------------------------------------------------------------------------
// Structural equality helpers
// ---------------------------------------------------------------------------

/** Order-insensitive compare of two (possibly undefined) string-id arrays. */
function sameIds(a: string[] | undefined, b: string[] | undefined): boolean {
  const aMissing = a === undefined;
  const bMissing = b === undefined;
  if (aMissing || bMissing) return aMissing === bMissing;
  if (a.length !== b.length) return false;
  const sa = a.slice().sort();
  const sb = b.slice().sort();
  return sa.every((v, i) => v === sb[i]);
}

/** Stable deep-equality via canonical JSON (sorts object keys recursively). */
function deepEqual(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b);
}

function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(obj[k])).join(',') + '}';
}

// ---------------------------------------------------------------------------
// Carve-out detection
// ---------------------------------------------------------------------------

// Phrases that signal a carve-out exception "... is OK — answer no for that".
const CARVEOUT_DIRECTION_RE = /\b(is ok|does not count|doesn'?t count)\b/i;
const CARVEOUT_ANSWER_RE = /\b(answer no|say no)\b/i;

interface CarveOut {
  /** Salient entity nouns named immediately before the direction phrase. */
  entities: string[];
}

/**
 * Detect a carve-out in the ORIGINAL machine sms_question and extract the salient
 * entity noun(s) that precede the direction phrase. Returns null if no carve-out.
 *
 * Example: "(A cornea transplant is OK — answer no for that.)"
 *   -> direction phrase "is OK" + "answer no" present
 *   -> entities preceding "is OK": ['cornea', 'transplant']
 */
function detectCarveOut(text: string): CarveOut | null {
  if (!text) return null;
  const dir = CARVEOUT_DIRECTION_RE.exec(text);
  if (!dir) return null;
  if (!CARVEOUT_ANSWER_RE.test(text)) return null;

  // The clause leading up to the direction phrase, e.g. "(A cornea transplant ".
  const lead = text.slice(0, dir.index);
  // Pull the trailing run of alphabetic word-tokens, dropping leading articles.
  const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'was', 'were', 'and', 'or', 'of', 'that', 'this']);
  const words = (lead.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).map((w) => w.toLowerCase());
  const entities: string[] = [];
  for (let i = words.length - 1; i >= 0 && entities.length < 3; i--) {
    const w = words[i]!;
    if (STOP.has(w)) {
      if (entities.length > 0) break; // hit a stop word after collecting nouns
      continue; // skip trailing articles like "a"
    }
    entities.unshift(w);
  }
  if (entities.length === 0) return null;
  return { entities };
}

/**
 * True iff the rewrite preserves the carve-out: EVERY named exception entity
 * token (e.g. 'cornea' AND 'transplant') AND the answer-direction phrase. We
 * require all entities because the general one (e.g. 'transplant') often also
 * appears in the question stem — only the specific one (e.g. 'cornea') being
 * dropped is the dangerous case the gate must catch.
 */
function carveOutPreserved(carve: CarveOut, rewritten: string): boolean {
  const lower = (rewritten || '').toLowerCase();
  const hasEntities = carve.entities.every((e) => lower.includes(e));
  const hasDirection = CARVEOUT_DIRECTION_RE.test(rewritten) && CARVEOUT_ANSWER_RE.test(rewritten);
  return hasEntities && hasDirection;
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

const FRAMING_SKIP_TYPES = new Set(['bmi', 'number', 'choice']);

/**
 * Decide whether `rewritten` (a warm/layperson humanisation of `original`'s
 * sms_question) is safe to accept. Deterministic hard gate.
 */
export function auditHumanise(original: Question, rewritten: Question): AuditResult {
  // 1. BYTE-IDENTITY INVARIANTS — only sms_question may change.
  if (original.variable_name !== rewritten.variable_name) {
    return { accepted: false, reason: 'variable_name changed' };
  }
  if (original.disqualify_condition !== rewritten.disqualify_condition) {
    return { accepted: false, reason: 'disqualify_condition changed' };
  }
  if (original.answer_type !== rewritten.answer_type) {
    return { accepted: false, reason: 'answer_type changed' };
  }
  if (!sameIds(original.criteria_ids, rewritten.criteria_ids)) {
    return { accepted: false, reason: 'criteria_ids changed' };
  }
  if (original.bmi_cutoff !== rewritten.bmi_cutoff) {
    return { accepted: false, reason: 'bmi_cutoff changed' };
  }
  if (!deepEqual(original.choices, rewritten.choices)) {
    return { accepted: false, reason: 'choices changed' };
  }

  // 2. CORNEA CARVE-OUT (entity + direction) — must survive the rewrite.
  const carve = detectCarveOut(original.sms_question ?? '');
  if (carve && !carveOutPreserved(carve, rewritten.sms_question ?? '')) {
    return {
      accepted: false,
      reason: `carve-out dropped (expected entity [${carve.entities.join('/')}] + direction)`,
    };
  }

  // 3. INVERTED-FRAMING knockout: yes_no where "no" disqualifies. Keep machine
  //    wording and flag for human review. (Skip this check for non-yes/no types.)
  if (!FRAMING_SKIP_TYPES.has(original.answer_type ?? '')) {
    if (original.answer_type === 'yes_no' && original.disqualify_condition === 'answer == no') {
      return {
        accepted: false,
        reason: 'inverted-framing knockout — machine wording retained',
        review_flag: 'inverted_framing_unreviewed',
      };
    }
  }

  // Invariants hold, carve-out preserved (if present), not inverted-framing.
  return { accepted: true };
}
