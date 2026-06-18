import { describe, it, expect } from 'vitest';
import { makeExtractor } from './index.js';
import type { ScreeningQuestion, ExtractorResult } from './index.js';

const rule = makeExtractor('rule');

function extract(
  q: Partial<ScreeningQuestion>,
  reply: string,
  ctx?: Record<string, unknown>
): ExtractorResult {
  const full: ScreeningQuestion = {
    variable_name: 'test_q',
    sms_question: 'Test question?',
    answer_type: 'yes_no',
    ...q,
  };
  const result = rule(full, reply, ctx);
  // rule extractor is synchronous, but the type allows Promise — cast safely
  return result as ExtractorResult;
}

// ---------------------------------------------------------------------------
// Yes/No extraction
// ---------------------------------------------------------------------------
describe('yes_no extraction', () => {
  const q: Partial<ScreeningQuestion> = { answer_type: 'yes_no' };

  it('"yes" → value yes', () => {
    const r = extract(q, 'yes');
    expect(r.value).toBe('yes');
    expect(r.needs_clarification).toBe(false);
  });

  it('"yeah sure" → value yes', () => {
    const r = extract(q, 'yeah sure');
    expect(r.value).toBe('yes');
  });

  it('"no" → value no', () => {
    const r = extract(q, 'no');
    expect(r.value).toBe('no');
  });

  it('"nope" → value no', () => {
    const r = extract(q, 'nope');
    expect(r.value).toBe('no');
  });

  it('"I don\'t have that" → value no (contraction negation)', () => {
    const r = extract(q, "I don't have that");
    expect(r.value).toBe('no');
  });

  it('"I have it" → value yes (I have pattern)', () => {
    const r = extract(q, 'I have it');
    expect(r.value).toBe('yes');
  });

  it('"maybe" → needs_clarification (ambiguous)', () => {
    const r = extract(q, 'maybe');
    expect(r.needs_clarification).toBe(true);
    expect(r.value).toBeNull();
  });

  it('empty string → needs_clarification', () => {
    const r = extract(q, '');
    expect(r.needs_clarification).toBe(true);
  });

  it('"not sure" → value no (neg=true, pos=false)', () => {
    // "not" triggers negation; "sure" alone would be pos but "not sure" tests neg first
    // The regex matches \b(not)\b → neg=true; pos pattern does NOT match "not sure"
    // because "sure" is present... actually "sure" IS in the pos pattern.
    // Let's re-check: pos = /\b(yes|yeah|yep|yup|ya|correct|sure|...)\b/.test("not sure") → true
    // neg = /\b(no|nope|nah|never|not|none|negative)\b/.test("not sure") → true (has "not")
    // pos && !neg → false; neg && !pos → false → ambiguous → needs_clarification
    const r = extract(q, 'not sure');
    // "not sure" has BOTH neg (not) and pos (sure) → ambiguous → needs_clarification
    expect(r.needs_clarification).toBe(true);
  });

  it('"skip" → skip:true, needs_clarification:false', () => {
    const r = extract(q, 'skip');
    expect(r.skip).toBe(true);
    expect(r.needs_clarification).toBe(false);
    expect(r.value).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Number extraction
// ---------------------------------------------------------------------------
describe('number extraction', () => {
  const q: Partial<ScreeningQuestion> = { answer_type: 'number' };

  it('"42" → value 42', () => {
    const r = extract(q, '42');
    expect(r.value).toBe(42);
    expect(r.needs_clarification).toBe(false);
  });

  it('"I am 35 years old" → value 35', () => {
    const r = extract(q, 'I am 35 years old');
    expect(r.value).toBe(35);
  });

  it('"fifty-two" → value 52 (spelled-out via parseWordNumber)', () => {
    const r = extract(q, 'fifty-two');
    expect(r.value).toBe(52);
    expect(r.confidence).toBe(0.8);
  });

  it('"twenty five" → value 25', () => {
    const r = extract(q, 'twenty five');
    expect(r.value).toBe(25);
  });

  it('"not sure" → needs_clarification (no digit, no word-number)', () => {
    const r = extract(q, 'not sure');
    expect(r.needs_clarification).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Choice extraction
// ---------------------------------------------------------------------------
describe('choice extraction (Female/Male)', () => {
  const q: Partial<ScreeningQuestion> = {
    answer_type: 'choice',
    choices: ['Female', 'Male'],
  };

  it('"Female" → value Female', () => {
    const r = extract(q, 'Female');
    expect(r.value).toBe('Female');
  });

  it('"I\'m a woman" → value Female', () => {
    const r = extract(q, "I'm a woman");
    expect(r.value).toBe('Female');
  });

  it('"male" → value Male', () => {
    const r = extract(q, 'male');
    expect(r.value).toBe('Male');
  });

  it('"man" → value Male', () => {
    const r = extract(q, 'man');
    expect(r.value).toBe('Male');
  });

  it('"other" → needs_clarification', () => {
    const r = extract(q, 'other');
    expect(r.needs_clarification).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// BMI extraction (via ctx height + weight)
// ---------------------------------------------------------------------------
describe('BMI extraction via ctx', () => {
  // BMI = 703 * weight_lbs / (height_inches^2)
  // 5'10" = 70 in; 200 lbs → 703 * 200 / (70*70) = 140600 / 4900 ≈ 28.7 → ≥ 27 → yes
  it('5\'10" 200 lbs → yes (BMI ≈ 28.7 ≥ 27)', () => {
    const q: Partial<ScreeningQuestion> = {
      answer_type: 'bmi',
      bmi_cutoff: 27,
    };
    const r = extract(q, '', { height: "5'10\"", weight: '200 lbs' });
    expect(r.value).toBe('yes');
    expect(r.needs_clarification).toBe(false);
    expect(typeof r.bmi).toBe('number');
    expect((r.bmi as number)).toBeGreaterThan(27);
  });

  // 5'6" = 66 in; 120 lbs → 703 * 120 / (66*66) = 84360 / 4356 ≈ 19.4 → < 27 → no
  it('5\'6" 120 lbs → no (BMI ≈ 19.4 < 27)', () => {
    const q: Partial<ScreeningQuestion> = {
      answer_type: 'bmi',
      bmi_cutoff: 27,
    };
    const r = extract(q, '', { height: "5'6\"", weight: '120 lbs' });
    expect(r.value).toBe('no');
    expect(r.needs_clarification).toBe(false);
    expect((r.bmi as number)).toBeLessThan(27);
  });
});

// ---------------------------------------------------------------------------
// Confidence levels
// ---------------------------------------------------------------------------
describe('confidence levels', () => {
  it('direct yes_no match → confidence 0.95', () => {
    const r = extract({ answer_type: 'yes_no' }, 'yes');
    expect(r.confidence).toBe(0.95);
  });

  it('word number fallback → confidence 0.8', () => {
    const r = extract({ answer_type: 'number' }, 'thirty');
    expect(r.confidence).toBe(0.8);
    expect(r.value).toBe(30);
  });

  it('ambiguous → confidence 0', () => {
    const r = extract({ answer_type: 'yes_no' }, 'maybe');
    expect(r.confidence).toBe(0);
  });
});
