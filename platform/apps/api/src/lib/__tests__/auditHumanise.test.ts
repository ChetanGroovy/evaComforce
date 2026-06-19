import { describe, it, expect } from 'vitest';
import { auditHumanise, type Question } from '../auditHumanise';

// Fixtures pinned to the REAL shapes in studies/WC45276/study.json.

// q8 — organ-transplant knockout with the cornea carve-out (answer == yes).
const Q8_CORNEA: Question = {
  variable_name: 'q8',
  sms_question:
    'Have you ever had an organ transplant, or are you waiting for one? (A cornea transplant is OK — answer no for that.)',
  answer_type: 'yes_no',
  disqualify_condition: 'answer == yes',
  criteria_ids: ['EXC-14'],
};

// q4 — type-2-diabetes inclusion knockout, inverted framing (answer == no).
const Q4_DIABETES: Question = {
  variable_name: 'q4',
  sms_question: 'Have you been diagnosed with type 2 diabetes?',
  answer_type: 'yes_no',
  disqualify_condition: 'answer == no',
  criteria_ids: ['INC-6'],
};

// q5 — diet/exercise inclusion knockout, inverted framing (answer == no).
const Q5_DIET: Question = {
  variable_name: 'q5',
  sms_question: 'Have you ever tried to lose weight with diet or exercise but were not successful?',
  answer_type: 'yes_no',
  disqualify_condition: 'answer == no',
  criteria_ids: ['INC-8'],
};

// q_bmi — BMI question with a bmi_cutoff (answer == no framing, but bmi type).
const Q_BMI: Question = {
  variable_name: 'q_bmi',
  sms_question: 'What is your height and current weight? (for example: 5 ft 6, 190 lbs)',
  answer_type: 'bmi',
  bmi_cutoff: 27.0,
  disqualify_condition: 'answer == no',
  criteria_ids: ['INC-5'],
};

// q1 — plain age/number question.
const Q1_AGE: Question = {
  variable_name: 'q1',
  sms_question: 'What is your age?',
  answer_type: 'number',
  disqualify_condition: 'age < 18',
  criteria_ids: ['INC-2'],
};

// A plain yes/yes-disqualifies question (not inverted framing, no carve-out).
const Q6_YES: Question = {
  variable_name: 'q6',
  sms_question: 'Have you ever been diagnosed with type 1 diabetes, a diabetic coma, or diabetic ketoacidosis?',
  answer_type: 'yes_no',
  disqualify_condition: 'answer == yes',
  criteria_ids: ['EXC-1'],
};

/** Helper: clone a fixture and override only its sms_question. */
function warm(base: Question, sms: string): Question {
  return { ...base, sms_question: sms };
}

describe('auditHumanise', () => {
  it('accepts a pure-wording warm rewrite of a plain yes/yes question', () => {
    const rewritten = warm(
      Q6_YES,
      "Have you ever been told you have type 1 diabetes, a diabetic coma, or diabetic ketoacidosis? It's okay if not.",
    );
    const r = auditHumanise(Q6_YES, rewritten);
    expect(r.accepted).toBe(true);
    expect(r.review_flag).toBeUndefined();
  });

  it('rejects when disqualify_condition changes', () => {
    const rewritten: Question = { ...Q6_YES, disqualify_condition: 'answer == no' };
    const r = auditHumanise(Q6_YES, rewritten);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/disqualify_condition/);
  });

  it('rejects when variable_name changes', () => {
    const rewritten: Question = { ...Q6_YES, variable_name: 'q6b' };
    expect(auditHumanise(Q6_YES, rewritten).accepted).toBe(false);
  });

  it('rejects when answer_type changes', () => {
    const rewritten: Question = { ...Q6_YES, answer_type: 'choice' };
    const r = auditHumanise(Q6_YES, rewritten);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/answer_type/);
  });

  it('rejects when criteria_ids change', () => {
    const rewritten: Question = { ...Q6_YES, criteria_ids: ['EXC-1', 'EXC-99'] };
    const r = auditHumanise(Q6_YES, rewritten);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/criteria_ids/);
  });

  it('treats criteria_ids as order-insensitive (re-order is NOT a change)', () => {
    const multi: Question = { ...Q6_YES, criteria_ids: ['EXC-41', 'EXC-42', 'EXC-43'] };
    const reordered: Question = warm(multi, 'A warmer phrasing.');
    reordered.criteria_ids = ['EXC-43', 'EXC-41', 'EXC-42'];
    expect(auditHumanise(multi, reordered).accepted).toBe(true);
  });

  it('rejects when bmi_cutoff changes', () => {
    const rewritten: Question = { ...Q_BMI, bmi_cutoff: 30.0 };
    const r = auditHumanise(Q_BMI, rewritten);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/bmi_cutoff/);
  });

  it('rejects when choices change (deep compare)', () => {
    const orig: Question = { ...Q6_YES, answer_type: 'choice', choices: ['a', 'b', 'c'] };
    const rewritten: Question = { ...orig, choices: ['a', 'b', 'd'] };
    const r = auditHumanise(orig, rewritten);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/choices/);
  });

  it('accepts equal choices (deep-equal, same order)', () => {
    const orig: Question = { ...Q6_YES, answer_type: 'choice', choices: [{ k: 1 }, { k: 2 }] };
    const rewritten: Question = warm({ ...orig, choices: [{ k: 1 }, { k: 2 }] }, 'Warmer choice prompt?');
    expect(auditHumanise(orig, rewritten).accepted).toBe(true);
  });

  it('rejects inverted-framing (q4) and sets review_flag', () => {
    const rewritten = warm(Q4_DIABETES, 'Have you been told by a doctor that you have type 2 diabetes?');
    const r = auditHumanise(Q4_DIABETES, rewritten);
    expect(r.accepted).toBe(false);
    expect(r.review_flag).toBe('inverted_framing_unreviewed');
  });

  it('rejects inverted-framing (q5) and sets review_flag', () => {
    const rewritten = warm(Q5_DIET, 'Have you tried losing weight with diet or exercise without much luck?');
    const r = auditHumanise(Q5_DIET, rewritten);
    expect(r.accepted).toBe(false);
    expect(r.review_flag).toBe('inverted_framing_unreviewed');
  });

  it('rejects when the cornea entity is dropped but direction kept', () => {
    // Direction phrase present, but no cornea/transplant token survives.
    const rewritten = warm(
      Q8_CORNEA,
      'Have you ever had an organ transplant, or are you waiting for one? (That kind is OK — answer no.)',
    );
    const r = auditHumanise(Q8_CORNEA, rewritten);
    expect(r.accepted).toBe(false);
    expect(r.reason).toMatch(/carve-out/);
  });

  it('rejects when the carve-out direction is dropped but cornea kept', () => {
    const rewritten = warm(
      Q8_CORNEA,
      'Have you ever had an organ transplant, or are you waiting for one? (A cornea transplant counts differently.)',
    );
    expect(auditHumanise(Q8_CORNEA, rewritten).accepted).toBe(false);
  });

  it('accepts when both cornea entity AND direction are preserved', () => {
    const rewritten = warm(
      Q8_CORNEA,
      "Have you ever had an organ transplant, or are you on a waiting list for one? (A cornea transplant is OK — please answer no for that.)",
    );
    const r = auditHumanise(Q8_CORNEA, rewritten);
    expect(r.accepted).toBe(true);
    expect(r.review_flag).toBeUndefined();
  });

  it('accepts the carve-out when expressed as "does not count" + "say no"', () => {
    const rewritten = warm(
      Q8_CORNEA,
      'Have you ever had an organ transplant, or are you waiting for one? (A cornea transplant does not count — say no for that.)',
    );
    expect(auditHumanise(Q8_CORNEA, rewritten).accepted).toBe(true);
  });

  it('skips yes/no-framing checks for bmi answer_type (accepts pure-wording rewrite)', () => {
    // q_bmi has disqualify_condition 'answer == no' but answer_type 'bmi' — the
    // inverted-framing rule must NOT fire because the framing-skip set covers bmi.
    const rewritten = warm(Q_BMI, 'Could you share your height and your current weight? (e.g. 5 ft 6, 190 lbs)');
    const r = auditHumanise(Q_BMI, rewritten);
    expect(r.accepted).toBe(true);
    expect(r.review_flag).toBeUndefined();
  });

  it('accepts a pure-wording rewrite of a plain age/number question', () => {
    const rewritten = warm(Q1_AGE, 'How old are you?');
    expect(auditHumanise(Q1_AGE, rewritten).accepted).toBe(true);
  });
});
