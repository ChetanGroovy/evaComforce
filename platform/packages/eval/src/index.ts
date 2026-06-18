// @comforceeva/eval — precision / recall / label eval gate + golden regression
// Types defined locally so this compiles before @comforceeva/schema and @comforceeva/engine are built.

// ---------------------------------------------------------------------------
// Local type definitions (mirrors @comforceeva/schema + domain model)
// ---------------------------------------------------------------------------
export interface Criterion {
  criterion_number: number;
  source_pages?: number[];
  criterion_text?: string;
  original_text?: string;
  verification_method: 'self_report' | 'exam' | 'lab' | 'imaging' | 'records' | 'derived';
  knockout_strength: 'hard' | 'soft' | 'none';
  phone_screenable?: boolean;
  rationale?: string;
}

export interface ScreeningQuestion {
  rank?: number;
  variable_name: string;
  sms_question: string;
  answer_type: 'yes_no' | 'number' | 'choice' | 'bmi' | 'text';
  choices?: string[];
  routing?: boolean;
  show_if?: string;
  disqualify_condition?: string;
  qualify_condition?: string;
  depends_on?: string[];
  criteria_ids?: string[];
  is_qualifying_question?: boolean;
  knockout_power?: string;
  included_in_flow?: boolean;
}

export interface FlowNode {
  id: string;
  type?: string;
  label?: string;
}

export interface FlowEdge {
  source: string;
  target: string;
  label?: string;
}

export interface StudyMeta {
  name?: string;
  internalNumber?: string;
  sponsor?: string;
  principalInvestigator?: string;
  site?: string;
  priority?: string;
  indication?: string;
  drug?: string;
  flowStatus?: string;
  flowVersion?: number;
  isPublished?: boolean;
  flowUpdated?: string;
  studyId?: string;
  selectedProtocolDocumentId?: string;
}

export interface Study {
  source?: string;
  capturedAt?: string;
  status?: 'draft' | 'ready';
  study?: StudyMeta;
  documents?: Array<{
    name?: string;
    type?: string;
    uploaded?: string;
    documentId?: string;
    extractionStatus?: string;
  }>;
  knowledgeBank?: Record<string, string>;
  inclusionCriteria?: Criterion[];
  exclusionCriteria?: Criterion[];
  screeningQuestions?: ScreeningQuestion[];
  flow?: { nodes?: FlowNode[]; edges?: FlowEdge[] };
  funnel?: unknown[];
  patients?: unknown[];
  recruiters?: unknown[];
}

// ---------------------------------------------------------------------------
// Public contract types
// ---------------------------------------------------------------------------
export interface Finding {
  level: 'FAIL' | 'WARN' | 'INFO';
  msg: string;
}

export interface EvalResult {
  fails: number;
  warns: number;
  findings: Finding[];
}

// ---------------------------------------------------------------------------
// Internal helpers (ported verbatim from studygen.mjs)
// ---------------------------------------------------------------------------

/** Returns true when the criterion is phone-screenable (self-report hard knockout). */
function isPhoneScreenable(c: Criterion): boolean {
  if (typeof c.phone_screenable === 'boolean') return c.phone_screenable;
  return c.verification_method === 'self_report' && c.knockout_strength === 'hard';
}

interface CriterionWithId extends Criterion {
  _id: string;
}

/** Flatten inclusion + exclusion criteria, tagging each with INC-N / EXC-N. */
function allCriteria(S: Study): CriterionWithId[] {
  const inc: CriterionWithId[] = (S.inclusionCriteria ?? []).map((c) => ({
    ...c,
    _id: `INC-${c.criterion_number}`,
  }));
  const exc: CriterionWithId[] = (S.exclusionCriteria ?? []).map((c) => ({
    ...c,
    _id: `EXC-${c.criterion_number}`,
  }));
  return [...inc, ...exc];
}

/**
 * Ground the Knowledge Bank drug form and compensation figures against provided
 * source text (combined protocol + ICF text). Inline version — no fs calls.
 */
function groundKB(
  S: Study,
  src: string,
  emitters: { fail: (m: string) => void; warn: (m: string) => void; info: (m: string) => void }
): void {
  const { fail, warn, info } = emitters;
  const srcLow = src.toLowerCase();
  if (!srcLow.trim()) {
    info('No protocol/ICF text provided — KB grounding skipped.');
    return;
  }

  // Drug FORM: claimed form in overview.drug / KB must appear in source text.
  const drugText = (
    (S.study?.drug ?? '') + ' ' + (S.knowledgeBank?.['General Study Information'] ?? '')
  ).toLowerCase();

  const FORMS: Array<[string, RegExp]> = [
    ['oral', /\boral\b|tablet|by mouth|swallow/],
    ['subcutaneous', /subcutaneous|injection under the skin|\bsc\b|under the skin/],
    ['intravenous', /intravenous|\biv\b infusion/],
  ];

  const claimed = FORMS.filter(([, re]) => re.test(drugText)).map(([f]) => f);
  for (const f of claimed) {
    const re =
      f === 'oral'
        ? /\boral\b|tablet|swallow/
        : f === 'subcutaneous'
          ? /subcutaneous|under the skin/
          : /intravenous|\biv\b/;
    if (!re.test(srcLow)) {
      fail(
        `KB claims drug form "${f}" but the Protocol/ICF text does not support it — possible dirty-oracle/hallucination.`
      );
    }
  }

  // Compensation: each $ figure in KB should appear in source.
  const comp = S.knowledgeBank?.['Compensation / Reimbursement'] ?? '';
  const figs = [...comp.matchAll(/\$\s?([0-9][0-9,]*)/g)].map((m) =>
    (m[1] ?? '').replace(/,/g, '')
  );
  for (const f of figs) {
    if (f.length <= 2) continue; // skip tiny incidental numbers
    if (!srcLow.replace(/,/g, '').includes(f)) {
      warn(
        `Compensation figure $${f} not found in Protocol/ICF text — verify it traces to the ICF stipend table.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Main eval function
// ---------------------------------------------------------------------------

/**
 * Run precision / recall / label / KB eval checks against a Study object.
 * Ported from studygen.mjs `runCheck`.
 *
 * @param S - The study to evaluate.
 * @param opts - Optional source texts for KB grounding.
 */
export function runEval(
  S: Study,
  opts?: { protocolText?: string; icfText?: string }
): EvalResult {
  const findings: Finding[] = [];
  const fail = (m: string) => findings.push({ level: 'FAIL', msg: m });
  const warn = (m: string) => findings.push({ level: 'WARN', msg: m });
  const info = (m: string) => findings.push({ level: 'INFO', msg: m });

  const crit = allCriteria(S);
  const byId = new Map(crit.map((c) => [c._id, c]));
  const qs = S.screeningQuestions ?? [];

  // 0. Classification completeness — can't run joins without labels.
  const VALID_VM = new Set(['self_report', 'exam', 'lab', 'imaging', 'records', 'derived']);
  const VALID_KS = new Set(['hard', 'soft', 'none']);
  const unclassified = crit.filter(
    (c) => !VALID_VM.has(c.verification_method) || !VALID_KS.has(c.knockout_strength)
  );
  if (crit.length > 0 && unclassified.length > 0) {
    warn(
      `${unclassified.length}/${crit.length} criteria not classified (need verification_method + knockout_strength) — precision/recall joins skipped for those.`
    );
  }

  // 1. PRECISION — every question must source a phone_screenable criterion.
  //    Kills clinical-gate + drug-recall structurally.
  for (const q of qs) {
    const ids = q.criteria_ids ?? [];
    if (ids.length === 0) {
      if (q.routing) continue;
      fail(`Q${q.rank ?? '?'} has no criteria_ids — untraceable.`);
      continue;
    }
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) {
        fail(`Q${q.rank ?? '?'} references ${id} which does not exist.`);
        continue;
      }
      if (!VALID_VM.has(c.verification_method)) continue; // unclassified already warned
      if (!isPhoneScreenable(c)) {
        fail(
          `Q${q.rank ?? '?'} sources ${id} (${c.verification_method}/${c.knockout_strength}) which is NOT phone_screenable — a ${c.verification_method} criterion is confirmed at the screening visit, not on the phone. Drop or reframe.`
        );
      }
    }
  }

  // 2. RECALL — every phone_screenable criterion must be covered by ≥1 question.
  const covered = new Set(qs.flatMap((q) => q.criteria_ids ?? []));
  const phone = crit.filter((c) => VALID_VM.has(c.verification_method) && isPhoneScreenable(c));
  for (const c of phone) {
    if (!covered.has(c._id)) {
      fail(
        `${c._id} is phone_screenable (hard self-report knockout) but NO question covers it — missed knockout: "${(c.criterion_text ?? '').slice(0, 60)}…"`
      );
    }
  }

  // 3. Count sanity — more questions than phone-screenable + 1 is suspicious.
  if (phone.length > 0 && qs.length > phone.length + 1) {
    warn(
      `${qs.length} questions vs ${phone.length} phone_screenable criteria — possible over-build.`
    );
  }

  // 4. Label cross-check: self_report criteria whose text reads clinical/lab are mislabel suspects.
  const CLINICAL =
    /\bCRP\b|\bESR\b|DAS28|CDAI|SDAI|\bACPA\b|swollen joint|tender joint|joint count|\bSJC\b|\bTJC\b|\bMRI\b|\bIGRA\b|\bHBV\b|\bHCV\b|\bHIV\b|tuberculosis|\bTB\b|h(a)?emoglobin|neutrophil|platelet|bilirubin|eGFR|serolog|antibod|QTc/i;
  for (const c of crit) {
    if (c.verification_method === 'self_report' && CLINICAL.test(c.criterion_text ?? '')) {
      warn(
        `${c._id} labeled self_report but text reads clinical/lab ("${(c.criterion_text ?? '').slice(0, 50)}…") — verify the label.`
      );
    }
  }

  // 5. KB grounding (when source text is provided).
  if (opts?.protocolText != null || opts?.icfText != null) {
    const combined = [(opts.protocolText ?? ''), (opts.icfText ?? '')].join('\n');
    groundKB(S, combined, { fail, warn, info });
  }

  // 6. CRM-only fields — must be set from site, not documents.
  const m = S.study ?? {};
  for (const [k, label] of [
    ['principalInvestigator', 'PI'],
    ['site', 'Site'],
    ['priority', 'Priority'],
  ] as const) {
    if (!m[k]) warn(`Overview "${label}" blank — REQUIRED-FROM-SITE (not in any document).`);
  }

  // 7. KB section gaps.
  const kb = S.knowledgeBank ?? {};
  for (const sec of ['General Study Information', 'Trial Design', 'Compensation / Reimbursement']) {
    if (!kb[sec]) info(`Knowledge Bank "${sec}" empty — fill from Protocol/ICF if available.`);
  }

  const fails = findings.filter((f) => f.level === 'FAIL').length;
  const warns = findings.filter((f) => f.level === 'WARN').length;
  return { fails, warns, findings };
}

// ---------------------------------------------------------------------------
// Golden regression — 4 frozen test cases
// ---------------------------------------------------------------------------

/** Build the canonical correct AZD1163-like Study that passes eval (0 FAILs). */
export function buildGoldenStudy(): Study {
  return {
    source: 'Golden test fixture (AZD1163-like)',
    capturedAt: '2026-06-17',
    study: {
      name: 'D9640C00003 (AZD1163)_Rheumatoid Arthritis (LaunchPAD-RA)',
      internalNumber: 'D9640C00003',
      sponsor: 'AstraZeneca AB',
      principalInvestigator: 'Shaikh Ali, MD',
      site: 'Houston Metro — Tomball',
      priority: 'Very High',
      indication: 'Moderately-to-severely active rheumatoid arthritis (RA)',
      drug: 'AZD1163 (bispecific anti-PAD2/4 antibody), subcutaneous',
    },
    knowledgeBank: {
      'General Study Information':
        'Study for adults with RA. AZD1163 is given as an injection under the skin (subcutaneous).',
      'Trial Design': 'Phase II, randomized, double-blind, placebo-controlled.',
      'Compensation / Reimbursement': 'Participants are paid $150 for the Screening visit.',
    },
    inclusionCriteria: [
      {
        criterion_number: 3,
        criterion_text: 'Is ≥18 years of age at the time of signing informed consent.',
        verification_method: 'self_report',
        knockout_strength: 'hard',
        phone_screenable: true,
      },
      {
        criterion_number: 4,
        criterion_text:
          'Has a diagnosis of adult-onset RA per the 2010 ACR/EULAR classification criteria.',
        verification_method: 'self_report',
        knockout_strength: 'hard',
        phone_screenable: true,
      },
      {
        criterion_number: 5,
        criterion_text:
          'Has moderately-to-severely active RA: ≥6 swollen joints (SJC66) and ≥6 tender joints (TJC68).',
        verification_method: 'exam',
        knockout_strength: 'hard',
        phone_screenable: false,
      },
      {
        criterion_number: 7,
        criterion_text:
          'History of inadequate response, loss of response, or intolerance to at least one csDMARD.',
        verification_method: 'self_report',
        knockout_strength: 'hard',
        phone_screenable: true,
      },
    ],
    exclusionCriteria: [
      {
        criterion_number: 1,
        criterion_text: 'Stage IV RA (end-stage with extensive damage, deformity).',
        verification_method: 'self_report',
        knockout_strength: 'hard',
        phone_screenable: true,
      },
      {
        criterion_number: 2,
        criterion_text:
          'History or evidence of another autoimmune or other condition that could confound the RA diagnosis.',
        verification_method: 'self_report',
        knockout_strength: 'hard',
        phone_screenable: true,
      },
      {
        criterion_number: 6,
        criterion_text:
          'Received or planning to receive any bDMARD/tsDMARD beyond anti-TNF for RA.',
        verification_method: 'records',
        knockout_strength: 'hard',
        phone_screenable: false,
      },
      {
        criterion_number: 17,
        criterion_text:
          'Pregnant or breastfeeding, or planning pregnancy/breastfeeding from Screening through end of safety follow-up.',
        verification_method: 'self_report',
        knockout_strength: 'hard',
        phone_screenable: true,
      },
      {
        criterion_number: 22,
        criterion_text:
          'History of or current malignancy, except fully treated basal/squamous cell skin cancer.',
        verification_method: 'self_report',
        knockout_strength: 'hard',
        phone_screenable: true,
      },
    ],
    screeningQuestions: [
      {
        rank: 1,
        variable_name: 'q1_age',
        sms_question: 'How old are you?',
        answer_type: 'number',
        disqualify_condition: 'age < 18',
        criteria_ids: ['INC-3'],
      },
      {
        rank: 2,
        variable_name: 'sex_at_birth',
        sms_question: 'What is your sex assigned at birth?',
        answer_type: 'choice',
        choices: ['Female', 'Male'],
        routing: true,
        criteria_ids: [],
      },
      {
        rank: 3,
        variable_name: 'q2_pregnancy',
        sms_question: 'Are you currently pregnant, breastfeeding, or planning to become pregnant?',
        answer_type: 'yes_no',
        disqualify_condition: 'answer == yes',
        show_if: 'sex_at_birth == "Female"',
        criteria_ids: ['EXC-17'],
      },
      {
        rank: 4,
        variable_name: 'q3_ra_dx',
        sms_question: 'Have you been diagnosed with rheumatoid arthritis (RA) by a doctor?',
        answer_type: 'yes_no',
        disqualify_condition: 'answer == no',
        criteria_ids: ['INC-4'],
      },
      {
        rank: 5,
        variable_name: 'q4_ra_med',
        sms_question:
          'Have you taken an RA medication, such as methotrexate or Enbrel, that did not work well enough?',
        answer_type: 'yes_no',
        disqualify_condition: 'answer == no',
        criteria_ids: ['INC-7'],
      },
      {
        rank: 6,
        variable_name: 'q5_stage4',
        sms_question:
          'Does your rheumatoid arthritis prevent you from taking care of your basic daily needs on your own?',
        answer_type: 'yes_no',
        disqualify_condition: 'answer == yes',
        criteria_ids: ['EXC-1'],
      },
      {
        rank: 7,
        variable_name: 'q6_other_autoimmune',
        sms_question:
          'Have you ever been diagnosed with lupus, psoriatic arthritis, or another autoimmune joint condition?',
        answer_type: 'yes_no',
        disqualify_condition: 'answer == yes',
        criteria_ids: ['EXC-2'],
      },
      {
        rank: 8,
        variable_name: 'q7_cancer',
        sms_question:
          'Have you ever had cancer, other than skin cancer or cervical cancer that was cured?',
        answer_type: 'yes_no',
        disqualify_condition: 'answer == yes',
        criteria_ids: ['EXC-22'],
      },
    ],
    flow: { nodes: [], edges: [] },
    funnel: [],
    patients: [],
    recruiters: [],
  };
}

// ---------------------------------------------------------------------------
// Golden case runner
// ---------------------------------------------------------------------------

export interface GoldenCase {
  name: string;
  description: string;
  study: Study;
  expectFails: boolean;
  expectFailContaining?: string;
}

export interface GoldenResult {
  pass: number;
  fail: number;
  cases: Array<{ name: string; ok: boolean; detail?: string }>;
}

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj)) as T;
}

/**
 * Run the 4 frozen regression cases (golden).
 * Any deviation from expected behaviour is a regression.
 */
export function golden(): GoldenResult {
  const base = buildGoldenStudy();
  const cases: GoldenResult['cases'] = [];
  let pass = 0;
  let fail = 0;

  const run = (c: GoldenCase) => {
    const result = runEval(c.study);
    let ok: boolean;
    let detail: string | undefined;

    if (c.expectFails) {
      if (result.fails === 0) {
        ok = false;
        detail = `Expected ≥1 FAIL but got 0. Findings: ${JSON.stringify(result.findings)}`;
      } else if (c.expectFailContaining) {
        const match = result.findings.some(
          (f) =>
            f.level === 'FAIL' &&
            f.msg.includes(c.expectFailContaining!)
        );
        if (match) {
          ok = true;
        } else {
          ok = false;
          detail = `Expected FAIL containing "${c.expectFailContaining}" but got: ${result.findings.filter((f) => f.level === 'FAIL').map((f) => f.msg).join(' | ')}`;
        }
      } else {
        ok = true;
      }
    } else {
      // expect 0 FAILs
      if (result.fails === 0) {
        ok = true;
      } else {
        ok = false;
        detail = `Expected 0 FAILs but got ${result.fails}: ${result.findings.filter((f) => f.level === 'FAIL').map((f) => f.msg).join(' | ')}`;
      }
    }

    cases.push({ name: c.name, ok, detail });
    if (ok) pass++; else fail++;
  };

  // Case 1: joint-count question sourced from INC-5 (exam/hard) → precision FAIL
  const study1 = deepClone(base);
  study1.inclusionCriteria = [
    ...(study1.inclusionCriteria ?? []),
    {
      criterion_number: 5,
      criterion_text:
        'Has moderately-to-severely active RA: ≥6 swollen joints (SJC66) and ≥6 tender joints (TJC68).',
      verification_method: 'exam',
      knockout_strength: 'hard',
      phone_screenable: false,
    },
  ];
  study1.screeningQuestions = [
    ...(study1.screeningQuestions ?? []),
    {
      rank: 9,
      variable_name: 'q_joint_count',
      sms_question: 'Do you have 6 or more swollen joints?',
      answer_type: 'yes_no',
      disqualify_condition: 'answer == no',
      criteria_ids: ['INC-5'],
    },
  ];
  run({
    name: 'azd-joint-count-precision',
    description: 'Question sourced from INC-5 (exam/hard) must fail precision',
    study: study1,
    expectFails: true,
    expectFailContaining: 'INC-5',
  });

  // Case 2: drug-recall question sourced from EXC-6 (records/hard) → precision FAIL
  const study2 = deepClone(base);
  study2.screeningQuestions = [
    ...(study2.screeningQuestions ?? []),
    {
      rank: 9,
      variable_name: 'q_drug_recall',
      sms_question:
        'Have you ever received tocilizumab, rituximab, or another biologic drug other than a TNF blocker for RA?',
      answer_type: 'yes_no',
      disqualify_condition: 'answer == yes',
      criteria_ids: ['EXC-6'],
    },
  ];
  run({
    name: 'azd-drug-recall-precision',
    description: 'Question sourced from EXC-6 (records/hard) must fail precision',
    study: study2,
    expectFails: true,
    expectFailContaining: 'EXC-6',
  });

  // Case 3: EXC-1 question removed → recall FAIL
  const study3 = deepClone(base);
  study3.screeningQuestions = (study3.screeningQuestions ?? []).filter(
    (q) => !(q.criteria_ids ?? []).includes('EXC-1')
  );
  run({
    name: 'azd-stage4-recall',
    description: 'EXC-1 (Stage IV) uncovered must fail recall',
    study: study3,
    expectFails: true,
    expectFailContaining: 'EXC-1',
  });

  // Case 4: clean study → 0 FAILs
  run({
    name: 'azd-clean',
    description: 'Correct AZD study should pass with 0 FAILs',
    study: deepClone(base),
    expectFails: false,
  });

  return { pass, fail, cases };
}
