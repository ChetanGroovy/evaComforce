/**
 * onboard.ts — the StudyOnboard extraction pipeline (P1-T2).
 *
 * Turns the text extracted from an uploaded protocol (protocol.txt [+icf.txt])
 * into screeningQuestions + a derived agent flow, then parks the result at
 * status:'needs_review' — NEVER 'ready'. A human must review and pass the
 * publish gate (PF3) before it can go patient-facing.
 *
 * Hard safety contract (in order):
 *  1. NULL-GUARD FIRST. If the LLM backend is 'rule' (no real model), or there
 *     is no protocol.txt, or the LLM returns null, we leave the DRAFT skeleton
 *     untouched, write status:'draft', and RETURN before any parse. We never
 *     manufacture questions from a non-LLM path.
 *  2. Fenced-JSON-tolerant parse inside try/catch. Any throw -> DRAFT fallback.
 *  3. Whole-payload validation: every disqualify_condition must match the
 *     /^(age < \d+|answer == no|answer == yes)$/ grammar, and any
 *     pregnancy/childbearing question must be gated by show_if + depends_on on
 *     a sex routing question. Validation failure -> DRAFT fallback.
 *  4. load-modify-write: preserve the existing funnel/patients/recruiters/
 *     documents/knowledgeBank on the loaded study object.
 *
 * The stub seam: if process.env.LLM_JSON_STUB is set, that file is read as the
 * raw LLM response (used by deriveFlow/onboard tests to drive the pipeline
 * deterministically without a live model).
 */

import fs from 'node:fs';
import path from 'node:path';
import { llmBackend, llmText } from '@comforceeva/extractor';
import type { Study, ScreeningQuestion } from './engine-shim.js';
import { deriveFlow } from './deriveFlow.js';
import { getStudiesDir, loadStudy } from './studies.js';

export interface OnboardResult {
  id: string;
  status: 'draft' | 'needs_review';
  questionCount: number;
  note: string;
}

const DISQUALIFY_GRAMMAR = /^(age < \d+|answer == no|answer == yes)$/;

/** Write status:'draft' onto the on-disk study without touching anything else. */
function setStatusDraft(studyJsonPath: string): void {
  try {
    const S = JSON.parse(fs.readFileSync(studyJsonPath, 'utf8')) as Study;
    S.status = 'draft';
    fs.writeFileSync(studyJsonPath, JSON.stringify(S, null, 2));
  } catch {
    /* skeleton already says draft; nothing safe to do */
  }
}

/** Fenced-JSON-tolerant parse: strips ```json fences, then JSON.parse. */
function parseFenced(raw: string): unknown {
  let s = raw.trim();
  // ```json ... ``` or ``` ... ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence && fence[1]) s = fence[1].trim();
  // Fall back to the first {...} or [...] span if there's leading/trailing prose.
  if (!/^[[{]/.test(s)) {
    const span = s.match(/[[{][\s\S]*[\]}]/);
    if (span) s = span[0];
  }
  return JSON.parse(s);
}

/**
 * Whole-payload validation. Returns true only if EVERY question is well-formed.
 * - disqualify_condition (when present) must match the exact grammar.
 * - any pregnancy/childbearing question must carry show_if + depends_on, and the
 *   thing it depends on must itself be a routing question (sex_at_birth).
 */
function validateQuestions(qs: ScreeningQuestion[]): boolean {
  if (!Array.isArray(qs) || qs.length === 0) return false;

  const routingVars = new Set(
    qs.filter((q) => q.routing === true).map((q) => q.variable_name)
  );

  for (const q of qs) {
    if (!q || typeof q.variable_name !== 'string' || typeof q.sms_question !== 'string') {
      return false;
    }
    const cond = q.disqualify_condition;
    if (cond !== undefined && cond !== null && cond !== '') {
      if (!DISQUALIFY_GRAMMAR.test(String(cond))) return false;
    }

    const isPregnancy = /pregnan|breastfeed|childbearing|nursing/i.test(
      `${q.sms_question} ${q.variable_name} ${q.category ?? ''}`
    );
    if (isPregnancy && q.routing !== true) {
      const showIf = q.show_if;
      const dependsOn = q.depends_on;
      if (!showIf || !Array.isArray(dependsOn) || dependsOn.length === 0) return false;
      // show_if/depends_on must point at a routing (sex) question.
      const gated = dependsOn.some((d) => routingVars.has(d));
      if (!gated) return false;
      if (!/(sex|gender)/i.test(showIf)) return false;
    }
  }
  return true;
}

/**
 * The prompt is piped to `claude` via STDIN (see extractor `claudeStdin`), so the
 * 128KB single-argv ceiling no longer applies — we can send the whole protocol so
 * the model actually sees the deep eligibility sections (often ~page 46), not just
 * the table of contents. We keep a generous upper bound only to cap model context
 * on pathological multi-MB documents.
 */
function safeCap(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

/** Build the playbook-encoded extraction prompt from the protocol/icf text. */
function buildPrompt(name: string, protocol: string, icf: string): string {
  const fullProtocol = safeCap(protocol, 280000);
  const fullIcf = icf ? safeCap(icf, 60000) : '';
  const docs = fullIcf
    ? `PROTOCOL:\n${fullProtocol}\n\nINFORMED CONSENT (ICF):\n${fullIcf}`
    : `PROTOCOL:\n${fullProtocol}`;
  return [
    `You are a clinical-trial pre-screen extractor for the study "${name}".`,
    `Read the source document(s) and output ONLY a JSON array of phone-screen`,
    `screeningQuestions. No prose, no markdown fences.`,
    ``,
    `HARD RULES (from the extraction playbook):`,
    `- Phone pre-screen only: 6-8 tight knockouts a patient can answer by phone.`,
    `  Generate questions ONLY from self-report + hard criteria. NEVER ask`,
    `  lab/exam/imaging/records checks (HIV, hepatitis, blood counts, MRI, ECG,`,
    `  specific investigational drug recall) — those happen at the screening visit.`,
    `- Layperson wording with brand examples (e.g. "ibuprofen, Aleve, naproxen"),`,
    `  never "NSAID / bDMARD / subcutaneous monoclonal".`,
    `- Each question object: { rank:int, variable_name, sms_question, answer_type`,
    `  in [yes_no,number,choice,bmi,text], optional choices[], criteria_ids[],`,
    `  knockout_power, included_in_flow:true }.`,
    `- disqualify_condition, when present, MUST be EXACTLY one of:`,
    `  "age < N"  |  "answer == no"  |  "answer == yes"  (no other form).`,
    `- Pregnancy/breastfeeding: add ONE early routing question`,
    `  { variable_name:"sex_at_birth", answer_type:"choice",`,
    `    choices:["Female","Male"], routing:true } and make the pregnancy`,
    `  question conditional: show_if:"sex_at_birth == \\"Female\\"",`,
    `  depends_on:["sex_at_birth"], plain wording.`,
    `- Age: a numeric question ("How old are you?") with disqualify_condition`,
    `  "age < N".`,
    ``,
    docs,
  ].join('\n');
}

/**
 * Obtain the raw LLM response. The stub seam (LLM_JSON_STUB) short-circuits the
 * live model so tests can drive the pipeline deterministically.
 */
async function rawLlmResponse(prompt: string): Promise<string | null> {
  const stub = process.env['LLM_JSON_STUB'];
  if (stub) {
    try {
      return fs.readFileSync(stub, 'utf8');
    } catch {
      return null;
    }
  }
  return llmText(prompt);
}

export async function onboardStudy(
  id: string,
  opts?: { force?: boolean }
): Promise<OnboardResult> {
  const dir = path.join(getStudiesDir(), id);
  const studyJsonPath = path.join(dir, 'study.json');
  const protocolPath = path.join(dir, 'protocol.txt');
  const icfPath = path.join(dir, 'icf.txt');

  // ---- NULL-GUARD FIRST (before any parse) ----
  const stub = process.env['LLM_JSON_STUB'];
  // Without the stub seam, a 'rule' backend means there is no real model — leave DRAFT.
  if (!stub && llmBackend() === 'rule') {
    setStatusDraft(studyJsonPath);
    return { id, status: 'draft', questionCount: 0, note: 'no LLM backend; left as draft' };
  }
  if (!fs.existsSync(protocolPath)) {
    setStatusDraft(studyJsonPath);
    return { id, status: 'draft', questionCount: 0, note: 'no protocol.txt; left as draft' };
  }

  // Refuse to clobber an already-populated question set unless forced.
  const loaded = loadStudy(id);
  if (!loaded) {
    return { id, status: 'draft', questionCount: 0, note: 'study not found' };
  }
  if (!opts?.force && (loaded.screeningQuestions ?? []).length > 0) {
    return {
      id,
      status: (loaded.status as OnboardResult['status']) ?? 'needs_review',
      questionCount: (loaded.screeningQuestions ?? []).length,
      note: 'screeningQuestions already present; pass force to overwrite',
    };
  }

  const protocol = (() => {
    try {
      return fs.readFileSync(protocolPath, 'utf8');
    } catch {
      return '';
    }
  })();
  const icf = fs.existsSync(icfPath)
    ? (() => {
        try {
          return fs.readFileSync(icfPath, 'utf8');
        } catch {
          return '';
        }
      })()
    : '';

  const name = loaded.study?.name ?? id;
  const prompt = buildPrompt(name, protocol, icf);

  const raw = await rawLlmResponse(prompt);
  if (raw == null || raw.trim() === '') {
    setStatusDraft(studyJsonPath);
    return { id, status: 'draft', questionCount: 0, note: 'LLM returned null; left as draft' };
  }

  // ---- fenced-JSON-tolerant parse; any throw -> DRAFT fallback ----
  let parsed: unknown;
  try {
    parsed = parseFenced(raw);
  } catch {
    setStatusDraft(studyJsonPath);
    return { id, status: 'draft', questionCount: 0, note: 'unparseable LLM response; left as draft' };
  }

  // Accept either a bare array or { screeningQuestions: [...] }.
  const qs: ScreeningQuestion[] = Array.isArray(parsed)
    ? (parsed as ScreeningQuestion[])
    : ((parsed as { screeningQuestions?: ScreeningQuestion[] })?.screeningQuestions ?? []);

  // ---- whole-payload validation; failure -> DRAFT fallback ----
  if (!validateQuestions(qs)) {
    setStatusDraft(studyJsonPath);
    return { id, status: 'draft', questionCount: 0, note: 'payload failed validation; left as draft' };
  }

  // interpretation_text = the machine-facing sms_question for each question.
  for (const q of qs) {
    (q as { interpretation_text?: string }).interpretation_text = q.sms_question;
  }

  // ---- load-modify-write: preserve funnel/patients/recruiters/documents/KB ----
  const out: Study = { ...loaded };
  out.screeningQuestions = qs;
  out.flow = deriveFlow(qs, name) as unknown as Study['flow'];
  out.status = 'needs_review'; // NEVER 'ready'

  fs.writeFileSync(studyJsonPath, JSON.stringify(out, null, 2));
  return {
    id,
    status: 'needs_review',
    questionCount: qs.length,
    note: 'extraction complete; awaiting human review',
  };
}

/** Exported so createStudy's fire-and-forget call-site can park a failed run. */
export function markDraft(id: string): void {
  const studyJsonPath = path.join(getStudiesDir(), id, 'study.json');
  setStatusDraft(studyJsonPath);
}
