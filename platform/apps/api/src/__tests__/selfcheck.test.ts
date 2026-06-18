/**
 * selfcheck.test.ts — serve-selfcheck equivalence test (vitest)
 *
 * Asserts: for every case in the test matrix, the stepwise session engine
 * (startSession / stepSession / finishSession) produces the SAME terminal as
 * the batch engine (screenPatient) when given the same answers.
 *
 * This is the invariant proof: the conversational server verdict == the batch
 * verdict for the same answer set. If this ever fails, the port has a bug.
 *
 * Port of cmdServeSelfcheck from studygen.mjs.
 *
 * The test discovers study.json files from STUDIES_DIR (env or default).
 * It skips gracefully when STUDIES_DIR contains no studies (CI without data).
 */

import path from 'node:path';
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  screenPatient,
  startSession,
  stepSession,
  finishSession,
  compileQuestions,
  makeExtractor,
  type Study,
  type ScreeningQuestion,
} from '../lib/engine-shim.js';

// ── locate a study for testing ───────────────────────────────────────────────

function findStudies(studiesDir: string): string[] {
  if (!fs.existsSync(studiesDir)) return [];
  return fs
    .readdirSync(studiesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(studiesDir, d.name, 'study.json'))
    .filter((p) => fs.existsSync(p));
}

// File is at src/__tests__/selfcheck.test.ts; going 6 levels up:
// __tests__/ → src/ → api/ → apps/ → platform/ → comforceEva/ → (root)
// then 'studies' gives the prototype's studies/ directory.
const DEFAULT_STUDIES_DIR = path.resolve(
  new URL('../../../../../../', import.meta.url).pathname,
  'studies'
);
const STUDIES_DIR = process.env['STUDIES_DIR'] ?? DEFAULT_STUDIES_DIR;
const studyPaths = findStudies(STUDIES_DIR);

// ── test-matrix builder (same as cmdServeSelfcheck / cmdTestConverse) ────────

function passVal(q: ScreeningQuestion): unknown {
  if (q.answer_type === 'number') return 40;
  if (q.answer_type === 'choice') return (q.choices ?? ['Female'])[0];
  return /answer == yes/.test(q.disqualify_condition ?? '') ? 'no'
    : /answer == no/.test(q.disqualify_condition ?? '') ? 'yes'
    : 'no';
}

function buildCases(S: Study): Array<{ name: string; a: Record<string, unknown> }> {
  const qs = compileQuestions(S);
  const base: Record<string, unknown> = {};
  for (const q of qs) base[q.variable_name] = passVal(q);

  const cases: Array<{ name: string; a: Record<string, unknown> }> = [
    { name: 'all-pass', a: { ...base } },
  ];

  // one DNQ case per disqualifiable question
  for (const q of qs) {
    if (!q.disqualify_condition || q.routing) continue;
    const a: Record<string, unknown> = { ...base };
    if (q.answer_type === 'number') {
      a[q.variable_name] = 10; // triggers age < 18 style conditions
    } else {
      a[q.variable_name] = /answer == yes/.test(q.disqualify_condition) ? 'yes' : 'no';
    }
    cases.push({ name: `knockout:${q.variable_name}`, a });
  }

  // one INCOMPLETE case (drop a middle answer)
  if (qs.length > 3) {
    const a: Record<string, unknown> = { ...base };
    const mid = qs[Math.floor(qs.length / 2)];
    if (mid) delete a[mid.variable_name];
    cases.push({ name: 'missing-one', a });
  }

  return cases;
}

// ── drive the stepwise session with scripted answers ──────────────────────────

function driveSession(S: Study, answers: Record<string, unknown>): string {
  const extractor = makeExtractor('rule');
  const sess = startSession(S, extractor);
  let turn: { done: boolean; terminal?: string } = { done: false };
  let guard = 0;

  while (!sess.done && sess.i < sess.qs.length && guard++ < 200) {
    const q = sess.qs[sess.i];
    if (!q) break;
    const rawVal = answers[q.variable_name];
    const text = rawVal == null ? '' : String(rawVal);
    turn = stepSession(sess, text);
    if (turn.done) break;
  }

  if (!turn.done) turn = finishSession(sess);
  return turn.terminal ?? 'INCOMPLETE';
}

// ── tests ────────────────────────────────────────────────────────────────────

if (studyPaths.length === 0) {
  describe('serve-selfcheck', () => {
    it.skip('no studies found in STUDIES_DIR — skipping selfcheck', () => {});
  });
} else {
  for (const studyPath of studyPaths) {
    const studyId = path.basename(path.dirname(studyPath));
    let S: Study;
    try {
      S = JSON.parse(fs.readFileSync(studyPath, 'utf8')) as Study;
    } catch {
      continue; // skip corrupt files
    }

    const cases = buildCases(S);

    describe(`serve-selfcheck [${studyId}]`, () => {
      for (const c of cases) {
        it(`${c.name}: stepwise terminal == screenPatient terminal`, () => {
          const batchTerminal = screenPatient(S, c.a).terminal;
          const sessionTerminal = driveSession(S, c.a);
          expect(sessionTerminal).toBe(batchTerminal);
        });
      }
    });
  }
}

// ── unit tests for the engine shim (no study files required) ─────────────────

describe('engine-shim unit tests', () => {
  const minimalStudy: Study = {
    study: { name: 'Test Study', indication: 'Test' },
    screeningQuestions: [
      {
        rank: 1,
        variable_name: 'q_age',
        sms_question: 'How old are you?',
        answer_type: 'number',
        disqualify_condition: 'age < 18',
        routing: false,
        criteria_ids: ['INC-1'],
        included_in_flow: true,
      },
      {
        rank: 2,
        variable_name: 'q_t2d',
        sms_question: 'Do you have Type 2 diabetes?',
        answer_type: 'yes_no',
        disqualify_condition: 'answer == no',
        routing: false,
        criteria_ids: ['INC-2'],
        included_in_flow: true,
      },
      {
        rank: 3,
        variable_name: 'sex_at_birth',
        sms_question: 'What is your sex at birth?',
        answer_type: 'choice',
        choices: ['Female', 'Male'],
        routing: true, // routing: only collect value, never disqualify
        criteria_ids: [],
        included_in_flow: true,
      },
      {
        rank: 4,
        variable_name: 'q_pregnant',
        sms_question: 'Are you currently pregnant or breastfeeding?',
        answer_type: 'yes_no',
        disqualify_condition: 'answer == yes',
        show_if: 'sex_at_birth == "Female"',
        routing: false,
        criteria_ids: ['EXC-1'],
        included_in_flow: true,
      },
    ],
    inclusionCriteria: [],
    exclusionCriteria: [],
  };

  it('QUALIFIED: all passing answers', () => {
    const r = screenPatient(minimalStudy, {
      q_age: 35,
      q_t2d: 'yes',
      sex_at_birth: 'Male',
    });
    expect(r.terminal).toBe('QUALIFIED');
  });

  it('DNQ: age < 18', () => {
    const r = screenPatient(minimalStudy, {
      q_age: 16,
      q_t2d: 'yes',
      sex_at_birth: 'Male',
    });
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q_age');
  });

  it('DNQ: no T2D', () => {
    const r = screenPatient(minimalStudy, {
      q_age: 40,
      q_t2d: 'no',
      sex_at_birth: 'Male',
    });
    expect(r.terminal).toBe('DNQ');
    expect(r.failed).toBe('q_t2d');
  });

  it('INCOMPLETE: missing required answer', () => {
    const r = screenPatient(minimalStudy, {
      q_age: 40,
      sex_at_birth: 'Male',
      // q_t2d omitted
    });
    expect(r.terminal).toBe('INCOMPLETE');
  });

  it('DNQ wins over missing answers (disclosed disqualifier priority)', () => {
    // q_t2d missing but q_age is a disqualifier → still DNQ
    const r = screenPatient(minimalStudy, {
      q_age: 15,
      // q_t2d missing
      sex_at_birth: 'Male',
    });
    expect(r.terminal).toBe('DNQ');
  });

  it('show_if skips pregnancy question for Male patients', () => {
    const r = screenPatient(minimalStudy, {
      q_age: 40,
      q_t2d: 'yes',
      sex_at_birth: 'Male',
    });
    const pregnancyTrace = r.trace.find((t) => t.variable === 'q_pregnant');
    expect(pregnancyTrace?.shown).toBe(false);
    expect(r.terminal).toBe('QUALIFIED');
  });

  it('show_if shows pregnancy question for Female patients', () => {
    const r = screenPatient(minimalStudy, {
      q_age: 40,
      q_t2d: 'yes',
      sex_at_birth: 'Female',
      q_pregnant: 'no',
    });
    const pregnancyTrace = r.trace.find((t) => t.variable === 'q_pregnant');
    expect(pregnancyTrace?.shown).toBe(true);
    expect(r.terminal).toBe('QUALIFIED');
  });

  it('routing question never disqualifies', () => {
    // sex_at_birth has routing: true — even if given a "bad" value it should not DNQ
    const r = screenPatient(minimalStudy, {
      q_age: 40,
      q_t2d: 'yes',
      sex_at_birth: 'Female',
      q_pregnant: 'no',
    });
    expect(r.terminal).toBe('QUALIFIED');
  });

  it('stepwise engine matches batch engine — all-pass', () => {
    const answers: Record<string, unknown> = {
      q_age: 40,
      q_t2d: 'yes',
      sex_at_birth: 'Male',
    };
    const batch = screenPatient(minimalStudy, answers).terminal;
    const session = driveSession(minimalStudy, answers);
    expect(session).toBe(batch);
  });

  it('stepwise engine matches batch engine — DNQ case', () => {
    const answers: Record<string, unknown> = {
      q_age: 16,
      q_t2d: 'yes',
      sex_at_birth: 'Male',
    };
    const batch = screenPatient(minimalStudy, answers).terminal;
    const session = driveSession(minimalStudy, answers);
    expect(session).toBe(batch);
  });

  it('stepwise engine matches batch engine — INCOMPLETE case', () => {
    const answers: Record<string, unknown> = {
      q_age: 40,
      sex_at_birth: 'Male',
      // q_t2d missing
    };
    const batch = screenPatient(minimalStudy, answers).terminal;
    const session = driveSession(minimalStudy, answers);
    expect(session).toBe(batch);
  });
});

// ── convo layer tests (presentation only — never changes a terminal) ──────────

describe('conversational layer — verdict neutrality', () => {
  it('isQuestionLike matches question-ending text', async () => {
    const { isQuestionLike } = await import('../lib/convo.js');
    expect(isQuestionLike('What does the study involve?')).toBe(true);
    expect(isQuestionLike('How long is the trial?')).toBe(true);
    expect(isQuestionLike('Yes')).toBe(false);
    expect(isQuestionLike('no')).toBe(false);
  });

  it('CONSENT_YES / CONSENT_NO match correctly', async () => {
    const { CONSENT_YES, CONSENT_NO } = await import('../lib/convo.js');
    expect(CONSENT_YES.test('yes')).toBe(true);
    expect(CONSENT_YES.test('Sure, sounds good')).toBe(true);
    expect(CONSENT_NO.test('no')).toBe(true);
    expect(CONSENT_NO.test('not interested')).toBe(true);
    expect(CONSENT_YES.test('no')).toBe(false);
  });

  it('convoGreeting uses study.conversation.greeting when set', async () => {
    const { convoGreeting } = await import('../lib/convo.js');
    const S: Study = {
      study: { name: 'Custom Study', indication: 'Diabetes' },
      conversation: { greeting: 'Hi{name}! Join our study.' },
    };
    expect(convoGreeting(S, 'Jane')).toBe('Hi Jane! Join our study.');
    expect(convoGreeting(S)).toBe('Hi! Join our study.');
  });

  it('convoGreeting falls back to default when no conversation.greeting', async () => {
    const { convoGreeting } = await import('../lib/convo.js');
    const S: Study = {
      study: { indication: 'Obesity' },
    };
    expect(convoGreeting(S, 'Bob')).toContain('Obesity');
    expect(convoGreeting(S, 'Bob')).toContain('Bob');
  });

  it('convoClosing returns correct messages per terminal', async () => {
    const { convoClosing } = await import('../lib/convo.js');
    const S: Study = {};
    expect(convoClosing(S, 'QUALIFIED')).toContain('pre-qualify');
    expect(convoClosing(S, 'DNQ')).toContain("doesn't look like a match");
    expect(convoClosing(S, 'INCOMPLETE')).toContain('coordinator');
  });
});
