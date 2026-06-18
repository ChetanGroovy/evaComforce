import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runEval, golden, buildGoldenStudy } from './index.js';
import type { Study, Criterion, ScreeningQuestion } from './index.js';

// Resolve the AZD1163 study fixture using an absolute path derived from this file's location.
// import.meta.url is file:///…/platform/packages/eval/src/eval.test.ts
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const AZD_STUDY_PATH = path.resolve(
  __dirname,
  '../../../../studies/AZD1163-D9640C00003/study.json'
);

function loadAzdStudy(): Study {
  const raw = fs.readFileSync(AZD_STUDY_PATH, 'utf8');
  return JSON.parse(raw) as Study;
}

// ---------------------------------------------------------------------------
// Test 1: golden() — all 4 frozen regression cases must pass
// ---------------------------------------------------------------------------
describe('golden regression', () => {
  it('all 4 golden cases pass', () => {
    const result = golden();
    const failedCases = result.cases.filter((c) => !c.ok);
    if (failedCases.length > 0) {
      const detail = failedCases.map((c) => `${c.name}: ${c.detail ?? 'unknown'}`).join('\n');
      throw new Error(`${failedCases.length} golden case(s) failed:\n${detail}`);
    }
    expect(result.fail).toBe(0);
    expect(result.pass).toBe(4);
  });

  it('joint-count precision case is caught', () => {
    const { cases } = golden();
    const c = cases.find((x) => x.name === 'azd-joint-count-precision');
    expect(c).toBeDefined();
    expect(c!.ok).toBe(true);
  });

  it('drug-recall precision case is caught', () => {
    const { cases } = golden();
    const c = cases.find((x) => x.name === 'azd-drug-recall-precision');
    expect(c).toBeDefined();
    expect(c!.ok).toBe(true);
  });

  it('stage4 recall case is caught', () => {
    const { cases } = golden();
    const c = cases.find((x) => x.name === 'azd-stage4-recall');
    expect(c).toBeDefined();
    expect(c!.ok).toBe(true);
  });

  it('clean study golden case passes', () => {
    const { cases } = golden();
    const c = cases.find((x) => x.name === 'azd-clean');
    expect(c).toBeDefined();
    expect(c!.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 2: Precision fail — question sourced from INC-5 (exam/hard)
// ---------------------------------------------------------------------------
describe('precision fail', () => {
  it('question sourced from INC-5 (exam/hard) produces at least 1 FAIL', () => {
    const base = buildGoldenStudy();

    // Add INC-5 as an exam criterion (if not already there in base)
    const inc5: Criterion = {
      criterion_number: 5,
      criterion_text:
        'Has moderately-to-severely active RA: ≥6 swollen joints (SJC66) and ≥6 tender joints (TJC68).',
      verification_method: 'exam',
      knockout_strength: 'hard',
      phone_screenable: false,
    };

    // Ensure INC-5 is present and has exam/hard classification
    const existingInc5Idx = (base.inclusionCriteria ?? []).findIndex(
      (c) => c.criterion_number === 5
    );
    if (existingInc5Idx >= 0) {
      (base.inclusionCriteria ?? [])[existingInc5Idx] = inc5;
    } else {
      base.inclusionCriteria = [...(base.inclusionCriteria ?? []), inc5];
    }

    // Add a question that sources INC-5
    const badQ: ScreeningQuestion = {
      rank: 99,
      variable_name: 'q_joint_count',
      sms_question: 'Do you currently have 6 or more swollen joints?',
      answer_type: 'yes_no',
      disqualify_condition: 'answer == no',
      criteria_ids: ['INC-5'],
    };
    base.screeningQuestions = [...(base.screeningQuestions ?? []), badQ];

    const result = runEval(base);
    expect(result.fails).toBeGreaterThanOrEqual(1);

    const failMsgs = result.findings.filter((f) => f.level === 'FAIL').map((f) => f.msg);
    const hasINC5Fail = failMsgs.some((m) => m.includes('INC-5'));
    expect(hasINC5Fail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Recall fail — study missing a question for EXC-1
// ---------------------------------------------------------------------------
describe('recall fail', () => {
  it('study missing EXC-1 question produces FAIL containing "EXC-1"', () => {
    const base = buildGoldenStudy();

    // Remove the q5_stage4 question (which covers EXC-1)
    base.screeningQuestions = (base.screeningQuestions ?? []).filter(
      (q) => !(q.criteria_ids ?? []).includes('EXC-1')
    );

    const result = runEval(base);
    expect(result.fails).toBeGreaterThanOrEqual(1);

    const failMsgs = result.findings.filter((f) => f.level === 'FAIL').map((f) => f.msg);
    const hasEXC1Fail = failMsgs.some((m) => m.includes('EXC-1'));
    expect(hasEXC1Fail).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Clean study passes with 0 FAILs
// ---------------------------------------------------------------------------
describe('clean study', () => {
  it('the golden study (correct AZD config) has 0 FAILs', () => {
    const study = buildGoldenStudy();
    const result = runEval(study);
    expect(result.fails).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Label cross-check — self_report with clinical text → WARN
// ---------------------------------------------------------------------------
describe('label cross-check', () => {
  it('self_report criterion with "swollen joint" in text produces a WARN', () => {
    const base = buildGoldenStudy();

    // Add a criterion that has self_report label but reads clinical
    base.inclusionCriteria = [
      ...(base.inclusionCriteria ?? []),
      {
        criterion_number: 99,
        criterion_text:
          'Has ≥6 swollen joint count confirmed by rheumatologist at screening visit.',
        verification_method: 'self_report', // mislabeled
        knockout_strength: 'soft',
        phone_screenable: false,
      },
    ];

    const result = runEval(base);
    const warnMsgs = result.findings.filter((f) => f.level === 'WARN').map((f) => f.msg);
    const hasClinicalWarn = warnMsgs.some(
      (m) => m.includes('self_report') && m.toLowerCase().includes('clinical')
    );
    expect(hasClinicalWarn).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test 6: AZD fixture from disk — sanity check
// ---------------------------------------------------------------------------
describe('AZD study fixture from disk', () => {
  it('loads the AZD1163 study.json without error', () => {
    const study = loadAzdStudy();
    expect(study).toBeDefined();
    expect(study.inclusionCriteria).toBeDefined();
    expect(study.exclusionCriteria).toBeDefined();
    expect(study.screeningQuestions).toBeDefined();
  });

  it('AZD1163 real study fixture produces 0 FAILs on eval', () => {
    const study = loadAzdStudy();
    const result = runEval(study);

    // The real fixture should have no precision/recall FAILs — all questions
    // source phone_screenable criteria and all phone_screenable criteria have questions.
    const fails = result.findings.filter((f) => f.level === 'FAIL');
    const precisionRecallFails = fails.filter(
      (f) =>
        f.msg.includes('NOT phone_screenable') ||
        f.msg.includes('missed knockout') ||
        f.msg.includes('does not exist')
    );
    expect(precisionRecallFails.length).toBe(0);
  });

  it('AZD1163: INC-5 (exam/hard) has no question covering it (correct)', () => {
    const study = loadAzdStudy();
    // INC-5 is exam/hard and should NOT be phone_screenable
    const inc5 = (study.inclusionCriteria ?? []).find((c) => c.criterion_number === 5);
    expect(inc5).toBeDefined();
    expect(inc5!.verification_method).toBe('exam');
    expect(inc5!.phone_screenable).toBe(false);

    // And no question should source INC-5
    const qs = study.screeningQuestions ?? [];
    const q = qs.find((q) => (q.criteria_ids ?? []).includes('INC-5'));
    expect(q).toBeUndefined();
  });

  it('AZD1163: EXC-6 (records/hard) has no question covering it (correct)', () => {
    const study = loadAzdStudy();
    const exc6 = (study.exclusionCriteria ?? []).find((c) => c.criterion_number === 6);
    expect(exc6).toBeDefined();
    expect(exc6!.verification_method).toBe('records');

    const qs = study.screeningQuestions ?? [];
    const q = qs.find((q) => (q.criteria_ids ?? []).includes('EXC-6'));
    expect(q).toBeUndefined();
  });

  it('AZD1163: EXC-1 (Stage IV) has a question covering it', () => {
    const study = loadAzdStudy();
    const qs = study.screeningQuestions ?? [];
    const q = qs.find((q) => (q.criteria_ids ?? []).includes('EXC-1'));
    expect(q).toBeDefined();
  });
});
