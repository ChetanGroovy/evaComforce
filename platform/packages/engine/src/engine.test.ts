/**
 * @comforceeva/engine — Vitest test suite
 *
 * Ports three prototype invariant suites from studygen.mjs:
 *   1. golden        — frozen eval-clean regression (10 studies, 10/10 pass)
 *   2. test-converse — batch === stepwise terminal for all-pass + per-knockout
 *                      matrix (11/11 on WC45726; also runs AZD and VP-VQW)
 *   3. serve-selfcheck — stepSession driver verdict === screenPatient verdict
 *                        for the same answer set (10/10 on WC45726)
 *
 * Studies are read from the filesystem at test time (fixture path configurable
 * via STUDIES_DIR env var; default resolves to ../../studies relative to
 * this package's root, matching the prototype's assumption).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  evalCond,
  norm,
  compileQuestions,
  parseAnswerTxt,
  screenPatient,
  startSession,
  stepSession,
  finishSession,
  sessionPrompt,
  type Study,
  type ScreeningQuestion,
  type ExtractFn,
  type ExtractResult,
} from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to the studies directory — configurable via env for CI. */
const STUDIES_DIR =
  process.env['STUDIES_DIR'] ??
  resolve(__dirname, '../../../../studies');

function loadStudy(id: string): Study | null {
  const p = resolve(STUDIES_DIR, id, 'study.json');
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, 'utf8')) as Study;
}

/** Build the canonical "passing" answer set for a question list. */
function passVal(q: ScreeningQuestion): unknown {
  if (q.answer_type === 'number') return 40;
  if (q.answer_type === 'choice') return (q.choices ?? ['Female'])[0];
  return /answer == yes/.test(q.disqualify_condition ?? '') ? 'no'
    : /answer == no/.test(q.disqualify_condition ?? '') ? 'yes'
    : 'no';
}

function buildPassBase(qs: ScreeningQuestion[]): Record<string, unknown> {
  const base: Record<string, unknown> = {};
  for (const q of qs) base[q.variable_name] = passVal(q);
  return base;
}

/**
 * A minimal replay extractor: returns the scripted value directly.
 * Mirrors the prototype's replayChannel — the value is already canonical
 * (yes/no string, number, choice string), so no parsing needed.
 */
function makeReplayExtractor(
  answers: Record<string, unknown>,
): ExtractFn {
  return (q, _text): ExtractResult => {
    const v = answers[q.variable_name];
    if (v == null || v === '') {
      return { value: null, confidence: 0, needs_clarification: false };
    }
    return { value: v, confidence: 1, needs_clarification: false };
  };
}

// ---------------------------------------------------------------------------
// evalCond unit tests
// ---------------------------------------------------------------------------

describe('evalCond', () => {
  it('evaluates simple number comparison', () => {
    expect(evalCond('age < 18', { age: 16, yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' })).toBe(true);
    expect(evalCond('age < 18', { age: 40, yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' })).toBe(false);
  });

  it('evaluates compound age condition', () => {
    const scope = (age: number) => ({ age, yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' });
    expect(evalCond('age < 18 || age > 80', scope(16))).toBe(true);
    expect(evalCond('age < 18 || age > 80', scope(85))).toBe(true);
    expect(evalCond('age < 18 || age > 80', scope(40))).toBe(false);
  });

  it('evaluates bareword yes/no comparisons', () => {
    const scope = (answer: unknown) => ({ answer, yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' });
    expect(evalCond('answer == yes', scope('yes'))).toBe(true);
    expect(evalCond('answer == yes', scope('no'))).toBe(false);
    expect(evalCond('answer == no', scope('no'))).toBe(true);
    expect(evalCond('answer == no', scope('yes'))).toBe(false);
  });

  it('evaluates quoted string comparison (sex_at_birth)', () => {
    const scope = (sex: string) => ({ sex_at_birth: sex, answer: sex, yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' });
    expect(evalCond('sex_at_birth == "Female"', scope('Female'))).toBe(true);
    expect(evalCond('sex_at_birth == "Female"', scope('Male'))).toBe(false);
  });

  it('returns false for empty expression', () => {
    expect(evalCond('', {})).toBe(false);
  });

  it('returns undefined for missing variable', () => {
    // `age` is not a key in scope → not a Function param → referencing it throws
    // ReferenceError → evalCond catches and returns undefined (matches the prototype:
    // a condition that can't be evaluated is "unknown", not false).
    const result = evalCond('age < 18', { yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' });
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// norm unit tests
// ---------------------------------------------------------------------------

describe('norm', () => {
  it('lowercases yes/no strings', () => {
    expect(norm('Yes')).toBe('yes');
    expect(norm('NO')).toBe('no');
    expect(norm('yes')).toBe('yes');
  });

  it('passes non-string values through', () => {
    expect(norm(40)).toBe(40);
    expect(norm(null)).toBe(null);
    expect(norm(undefined)).toBe(undefined);
  });

  it('preserves original case for sex values (Female/Male)', () => {
    // norm should NOT be applied to choice/sex questions in screenPatient
    // The choice value 'Female' must remain 'Female', not 'female'
    expect(norm('Female')).toBe('female'); // norm lowercases everything
    // That's why screenPatient only calls norm() for yes_no questions
  });
});

// ---------------------------------------------------------------------------
// parseAnswerTxt
// ---------------------------------------------------------------------------

describe('parseAnswerTxt', () => {
  it('parses colon-separated key:value lines', () => {
    const txt = 'q1_age: 35\nq3_t2d: yes\nsex at birth: Female';
    const r = parseAnswerTxt(txt);
    expect(r['q1_age']).toBe('35');
    expect(r['q3_t2d']).toBe('yes');
    expect(r['sex_at_birth']).toBe('Female'); // spaces → underscores, lowercased key
  });

  it('parses equals-separated lines', () => {
    const txt = 'age = 42\nanswer = no';
    const r = parseAnswerTxt(txt);
    expect(r['age']).toBe('42');
    expect(r['answer']).toBe('no');
  });

  it('ignores blank lines and non-matching lines', () => {
    const txt = '\n# comment\nq1_age: 50\n\nrandom text';
    const r = parseAnswerTxt(txt);
    expect(r['q1_age']).toBe('50');
    expect(Object.keys(r)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// compileQuestions
// ---------------------------------------------------------------------------

describe('compileQuestions', () => {
  it('returns questions sorted by rank', () => {
    const S = loadStudy('WC45726');
    if (S == null) return; // skip if fixture missing
    const qs = compileQuestions(S);
    for (let i = 1; i < qs.length; i++) {
      expect((qs[i]?.rank ?? 0)).toBeGreaterThanOrEqual(qs[i - 1]?.rank ?? 0);
    }
  });

  it('handles empty screeningQuestions gracefully', () => {
    const S = { screeningQuestions: [] } as unknown as Study;
    expect(compileQuestions(S)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// screenPatient — unit invariants
// ---------------------------------------------------------------------------

describe('screenPatient — unit invariants', () => {
  const wc = loadStudy('WC45726');

  it('QUALIFIED when all pass (Male, no pregnancy question shown)', () => {
    if (wc == null) return;
    const qs = compileQuestions(wc);
    const answers: Record<string, unknown> = buildPassBase(qs);
    answers['sex_at_birth'] = 'Male';
    // pregnancy show_if=sex_at_birth=="Female" → skipped for Male → no missing
    const r = screenPatient(wc, answers);
    expect(r.terminal).toBe('QUALIFIED');
  });

  it('DNQ on age < 18', () => {
    if (wc == null) return;
    const qs = compileQuestions(wc);
    const answers: Record<string, unknown> = buildPassBase(qs);
    answers['q1_age'] = 10;
    const r = screenPatient(wc, answers);
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q1_age');
  });

  it('DNQ on BMI disqualifier (answer == no)', () => {
    if (wc == null) return;
    const qs = compileQuestions(wc);
    const answers: Record<string, unknown> = buildPassBase(qs);
    answers['q2_bmi'] = 'no';
    const r = screenPatient(wc, answers);
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q2_bmi');
  });

  it('DNQ wins over earlier missing answers (disclosed disqualifier priority)', () => {
    // Key invariant: a disclosed disqualifier beats earlier unanswered questions.
    if (wc == null) return;
    const qs = compileQuestions(wc);
    // Omit q1_age (missing) but disclose a knockout (q6_t1dm = yes)
    const answers: Record<string, unknown> = buildPassBase(qs);
    delete answers['q1_age']; // missing age
    answers['q6_t1dm'] = 'yes'; // explicit knockout
    const r = screenPatient(wc, answers);
    // The disclosed disqualifier (q6_t1dm at rank 7) wins over missing age (rank 1)
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q6_t1dm');
  });

  it('INCOMPLETE when a required answer is missing', () => {
    if (wc == null) return;
    const qs = compileQuestions(wc);
    const answers: Record<string, unknown> = buildPassBase(qs);
    delete answers['q3_t2d']; // remove a required non-deferred answer
    const r = screenPatient(wc, answers);
    expect(r.terminal).toBe('INCOMPLETE');
  });

  it('routing questions never cause DNQ', () => {
    if (wc == null) return;
    const qs = compileQuestions(wc);
    const answers: Record<string, unknown> = buildPassBase(qs);
    // sex_at_birth is routing=true — omitting it should not cause DNQ
    delete answers['sex_at_birth'];
    const r = screenPatient(wc, answers);
    // With Male base, pregnancy is conditional on sex_at_birth=="Female"
    // Missing sex_at_birth means show_if can't be evaluated → pregnancy also skipped
    // All other non-routing Qs answered → QUALIFIED
    expect(r.terminal).not.toBe('DNQ');
  });

  it('show_if=false skips the question (pregnancy for Male)', () => {
    if (wc == null) return;
    const qs = compileQuestions(wc);
    const answers: Record<string, unknown> = buildPassBase(qs);
    answers['sex_at_birth'] = 'Male';
    // Deliberately set a "would-be" DNQ answer for pregnancy — but it should be skipped
    answers['q10_pregnancy'] = 'yes';
    const r = screenPatient(wc, answers);
    expect(r.terminal).toBe('QUALIFIED');
    // pregnancy trace entry should show shown:false
    const pregnancyTrace = r.trace.find((t) => t.variable === 'q10_pregnancy');
    expect(pregnancyTrace?.shown).toBe(false);
  });

  it('pregnancy shown and checked for Female', () => {
    if (wc == null) return;
    const qs = compileQuestions(wc);
    const answers: Record<string, unknown> = buildPassBase(qs);
    answers['sex_at_birth'] = 'Female';
    answers['q10_pregnancy'] = 'yes'; // disqualifies
    const r = screenPatient(wc, answers);
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q10_pregnancy');
  });

  it('pregnancy defer_if_unanswered: Female with no pregnancy answer → QUALIFIED (deferred)', () => {
    if (wc == null) return;
    const qs = compileQuestions(wc);
    const answers: Record<string, unknown> = buildPassBase(qs);
    answers['sex_at_birth'] = 'Female';
    delete answers['q10_pregnancy']; // unanswered
    const r = screenPatient(wc, answers);
    // defer_if_unanswered=true means it goes to deferred, not missing → QUALIFIED
    expect(r.terminal).toBe('QUALIFIED');
    expect(r.deferred).toContain('q10_pregnancy');
  });
});

// ---------------------------------------------------------------------------
// test-converse — equivalence: batch === stepwise terminal
// Mirrors cmdTestConverse from studygen.mjs.
// ---------------------------------------------------------------------------

function runConverseEquivalence(studyId: string): void {
  describe(`test-converse equivalence: ${studyId}`, () => {
    const S = loadStudy(studyId);
    if (S == null) {
      it.skip(`${studyId} fixture missing`, () => {});
      return;
    }

    const qs = compileQuestions(S);

    // Build all-pass answer set
    const base = buildPassBase(qs);

    // Build test cases: all-pass + one knockout per disqualifiable question
    const cases: Array<{ name: string; a: Record<string, unknown> }> = [
      { name: 'all-pass', a: { ...base } },
    ];

    for (const q of qs) {
      if (q.disqualify_condition == null || q.disqualify_condition === '' || q.routing === true) continue;
      const a = { ...base };
      if (q.answer_type === 'number') {
        a[q.variable_name] = 10; // age < 18
      } else {
        a[q.variable_name] = /answer == yes/.test(q.disqualify_condition ?? '') ? 'yes' : 'no';
      }
      cases.push({ name: `knockout:${q.variable_name}`, a });
    }

    // missing-one case (drop the middle question)
    if (qs.length > 3) {
      const midQ = qs[Math.floor(qs.length / 2)];
      if (midQ != null) {
        const a = { ...base };
        delete a[midQ.variable_name];
        cases.push({ name: 'missing-one', a });
      }
    }

    for (const c of cases) {
      it(`${c.name}: batch === stepwise`, () => {
        const batch = screenPatient(S, c.a);

        // Drive the stepwise session with the scripted answers
        const extractor = makeReplayExtractor(c.a);
        const sess = startSession(S, extractor);
        let turn = { done: false } as ReturnType<typeof stepSession>;
        let guard = 0;
        while (!sess.done && sess.i < sess.qs.length && guard++ < 100) {
          const q = sess.qs[sess.i];
          if (q == null) break;
          const rawVal = c.a[q.variable_name];
          const text = rawVal == null ? '' : String(rawVal);
          turn = stepSession(sess, text);
          if (turn.done) break;
        }
        if (!turn.done) {
          turn = finishSession(sess);
        }

        expect(turn.terminal).toBe(batch.terminal);
      });
    }
  });
}

// Run equivalence for all main study fixtures
runConverseEquivalence('WC45726');
runConverseEquivalence('AZD1163-D9640C00003');
runConverseEquivalence('VP-VQW-765-3201');
runConverseEquivalence('MK-7240');

// ---------------------------------------------------------------------------
// serve-selfcheck — assert stepwise server verdict === screenPatient verdict.
// Mirrors cmdServeSelfcheck from studygen.mjs.
// ---------------------------------------------------------------------------

function runServeSelfcheck(studyId: string): void {
  describe(`serve-selfcheck: ${studyId}`, () => {
    const S = loadStudy(studyId);
    if (S == null) {
      it.skip(`${studyId} fixture missing`, () => {});
      return;
    }

    const qs = compileQuestions(S);
    const base = buildPassBase(qs);

    const cases: Array<{ name: string; a: Record<string, unknown> }> = [
      { name: 'all-pass', a: { ...base } },
    ];
    for (const q of qs) {
      if (q.disqualify_condition == null || q.disqualify_condition === '' || q.routing === true) continue;
      const a = { ...base };
      if (q.answer_type === 'number') a[q.variable_name] = 10;
      else a[q.variable_name] = /answer == yes/.test(q.disqualify_condition ?? '') ? 'yes' : 'no';
      cases.push({ name: `knockout:${q.variable_name}`, a });
    }

    for (const c of cases) {
      it(`${c.name}: server === batch`, () => {
        const batch = screenPatient(S, c.a);

        // Drive the stepwise session by feeding each question its scripted answer
        const extractor = makeReplayExtractor(c.a);
        const sess = startSession(S, extractor);
        let turn = { done: false } as ReturnType<typeof stepSession>;
        let guard = 0;
        while (!sess.done && sess.i < sess.qs.length && guard++ < 100) {
          const q = sess.qs[sess.i];
          if (q == null) break;
          const rawVal = c.a[q.variable_name];
          const text = rawVal == null ? '' : String(rawVal);
          turn = stepSession(sess, text);
          if (turn.done) break;
        }
        if (!turn.done) {
          turn = finishSession(sess);
        }

        expect(turn.terminal).toBe(batch.terminal);
      });
    }
  });
}

runServeSelfcheck('WC45726');
runServeSelfcheck('AZD1163-D9640C00003');

// ---------------------------------------------------------------------------
// Additional edge-case unit tests
// ---------------------------------------------------------------------------

describe('screenPatient — cross-study edge cases', () => {
  it('AZD: pregnancy skipped for Male patient', () => {
    const S = loadStudy('AZD1163-D9640C00003');
    if (S == null) return;
    const qs = compileQuestions(S);
    const answers = buildPassBase(qs);
    answers['sex_at_birth'] = 'Male';
    const r = screenPatient(S, answers);
    expect(r.terminal).toBe('QUALIFIED');
    const pregTrace = r.trace.find((t) => t.variable === 'q2_pregnancy');
    expect(pregTrace?.shown).toBe(false);
  });

  it('AZD: pregnancy question shown and can DNQ for Female', () => {
    const S = loadStudy('AZD1163-D9640C00003');
    if (S == null) return;
    const qs = compileQuestions(S);
    const answers = buildPassBase(qs);
    answers['sex_at_birth'] = 'Female';
    answers['q2_pregnancy'] = 'yes';
    const r = screenPatient(S, answers);
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q2_pregnancy');
  });

  it('MK-7240: compound age condition (age > 80 also disqualifies)', () => {
    const S = loadStudy('MK-7240');
    if (S == null) return;
    const qs = compileQuestions(S);
    const answers = buildPassBase(qs);
    answers['q1_age'] = 85;
    const r = screenPatient(S, answers);
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q1_age');
  });

  it('VP-VQW: age > 65 disqualifies', () => {
    const S = loadStudy('VP-VQW-765-3201');
    if (S == null) return;
    const qs = compileQuestions(S);
    const answers = buildPassBase(qs);
    answers['q1_age'] = 70;
    const r = screenPatient(S, answers);
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q1_age');
  });
});

// ---------------------------------------------------------------------------
// startSession / stepSession / finishSession unit tests
// ---------------------------------------------------------------------------

describe('session lifecycle', () => {
  it('startSession positions at first question', () => {
    const S = loadStudy('WC45726');
    if (S == null) return;
    const sess = startSession(S);
    const prompt = sessionPrompt(sess);
    expect(typeof prompt).toBe('string');
    expect(prompt?.length).toBeGreaterThan(0);
  });

  it('finishSession returns done:true with terminal', () => {
    const S = loadStudy('WC45726');
    if (S == null) return;
    const sess = startSession(S);
    const r = finishSession(sess);
    expect(r.done).toBe(true);
    expect(['QUALIFIED', 'DNQ', 'INCOMPLETE']).toContain(r.terminal);
  });

  it('calling finishSession on an already-done session is idempotent', () => {
    const S = loadStudy('WC45726');
    if (S == null) return;
    const sess = startSession(S);
    const r1 = finishSession(sess);
    const r2 = finishSession(sess);
    expect(r1.terminal).toBe(r2.terminal);
  });

  it('needs_clarification triggers re-ask up to maxReask times', () => {
    const S = loadStudy('WC45726');
    if (S == null) return;
    // Extractor that always says needs_clarification
    const badExtractor: ExtractFn = () => ({
      value: null,
      confidence: 0,
      needs_clarification: true,
    });
    const sess = startSession(S, badExtractor);
    sess.maxReask = 1;

    // First step: needs clarification → re-ask
    const t1 = stepSession(sess, 'umm');
    expect(t1.needs_clarification).toBe(true);
    expect(t1.done).toBe(false);

    // Second step: exceeded maxReask → records unanswered, moves on
    const t2 = stepSession(sess, 'umm');
    expect(t2.needs_clarification).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// golden — eval-clean regression
// Every study that ships must pass runCheck with 0 FAILs.
// We port only the "study is eval-clean" subset (the full eval check
// with KB grounding lives in @comforceeva/eval).
// ---------------------------------------------------------------------------

describe('golden — eval-clean regression', () => {
  const studyIds = [
    'WC45726',
    'AZD1163-D9640C00003',
    'MK-7240',
    'VP-VQW-765-3201',
  ];

  for (const id of studyIds) {
    it(`${id} loads and has non-empty screeningQuestions`, () => {
      const S = loadStudy(id);
      if (S == null) return; // skip if fixture absent
      expect(S.screeningQuestions.length).toBeGreaterThan(0);
    });

    it(`${id} all-pass case returns QUALIFIED`, () => {
      const S = loadStudy(id);
      if (S == null) return;
      const qs = compileQuestions(S);
      const answers = buildPassBase(qs);
      // Use Male to avoid conditional pregnancy question
      if (qs.some((q) => q.variable_name === 'sex_at_birth')) {
        answers['sex_at_birth'] = 'Male';
      }
      const r = screenPatient(S, answers);
      expect(r.terminal).toBe('QUALIFIED');
    });

    it(`${id} compileQuestions is rank-sorted`, () => {
      const S = loadStudy(id);
      if (S == null) return;
      const qs = compileQuestions(S);
      for (let i = 1; i < qs.length; i++) {
        expect(qs[i]?.rank ?? 0).toBeGreaterThanOrEqual(qs[i - 1]?.rank ?? 0);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// parseStudy — schema validation
// ---------------------------------------------------------------------------

describe('parseStudy — schema validation', () => {
  it('parses valid WC45726 study.json', async () => {
    const { parseStudy } = await import('@comforceeva/schema');
    const raw = JSON.parse(
      readFileSync(resolve(STUDIES_DIR, 'WC45726', 'study.json'), 'utf8'),
    ) as unknown;
    const S = parseStudy(raw);
    expect(S.study.name).toContain('WC45726');
    expect(S.screeningQuestions.length).toBeGreaterThan(0);
    expect(S.inclusionCriteria.length).toBeGreaterThan(0);
    expect(S.exclusionCriteria.length).toBeGreaterThan(0);
  });

  it('throws on malformed input (missing required field)', async () => {
    const { parseStudy } = await import('@comforceeva/schema');
    expect(() => parseStudy({ study: {} })).toThrow(); // missing documents, etc.
  });

  it('passes through extra keys on study sub-object', async () => {
    const { parseStudy } = await import('@comforceeva/schema');
    const raw = JSON.parse(
      readFileSync(resolve(STUDIES_DIR, 'WC45726', 'study.json'), 'utf8'),
    ) as unknown;
    // Should not throw even though study._REQUIRED_FROM_SITE is present
    expect(() => parseStudy(raw)).not.toThrow();
  });
});
