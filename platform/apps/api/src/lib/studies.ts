/**
 * studies.ts — file-system helpers for study configs.
 *
 * Study config dir: env STUDIES_DIR (default: the prototype's studies/ dir at
 * /home/groovy/Desktop/projects/comforceEva/studies). All paths are resolved
 * relative to this root.
 *
 * Port of: scanStudies, loadStudy, studyDetail, createStudy, updateStudy,
 * reportForStudy from studygen.mjs — behaviour-identical.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  type Study,
  type ScreeningQuestion,
  compileQuestions,
  screenPatient,
  parseAnswerTxt,
} from './engine-shim.js';

// Resolve STUDIES_DIR. Default is the prototype's studies/ directory.
// File lives at apps/api/src/lib/studies.ts (or dist/lib/studies.js after build).
// Going 5 levels up from lib/ → src/ → api/ → apps/ → platform/ → comforceEva/
// then appending 'studies' gives the prototype's studies/ alongside the monorepo.
const DEFAULT_STUDIES_DIR = path.resolve(
  new URL('../../../../../', import.meta.url).pathname,
  'studies'
);
export function getStudiesDir(): string {
  return process.env['STUDIES_DIR'] ?? DEFAULT_STUDIES_DIR;
}

// ---------- slugify (same as prototype) ----------
export function slugify(s: string): string {
  return String(s || 'study')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'study';
}

// ---------- scanStudies ----------
export interface StudySummary {
  id: string;
  name: string;
  sponsor: string;
  indication: string;
  questionCount: number;
  status: string;
}

export function scanStudies(): StudySummary[] {
  const STUDIES_DIR = getStudiesDir();
  const out: StudySummary[] = [];
  let dirs: string[] = [];
  try {
    dirs = fs
      .readdirSync(STUDIES_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return out;
  }
  for (const id of dirs.sort()) {
    const p = path.join(STUDIES_DIR, id, 'study.json');
    if (!fs.existsSync(p)) continue;
    let S: Study;
    try {
      S = JSON.parse(fs.readFileSync(p, 'utf8')) as Study;
    } catch {
      continue;
    }
    const m = S.study ?? {};
    const qn = (S.screeningQuestions ?? []).length;
    const status = S.status ?? (qn > 0 ? 'ready' : 'draft');
    out.push({
      id,
      name: m.name ?? id,
      sponsor: m.sponsor ?? '',
      indication: m.indication ?? '',
      questionCount: qn,
      status,
    });
  }
  return out;
}

// ---------- loadStudy ----------
export function loadStudy(id: string): Study | null {
  const STUDIES_DIR = getStudiesDir();
  const p = path.join(STUDIES_DIR, id, 'study.json');
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8')) as Study;
  } catch {
    return null;
  }
}

// ---------- studyDetail ----------
export interface StudyDetail {
  id: string;
  name: string;
  sponsor: string;
  indication: string;
  drug: string;
  phase: string;
  questions: Array<{
    rank: number;
    variable_name: string;
    sms_question: string;
    answer_type: string;
    choices: string[] | null;
  }>;
  criteriaCount: { inclusion: number; exclusion: number };
  status: string;
  overview: {
    name: string;
    internalNumber: string;
    sponsor: string;
    principalInvestigator: string;
    site: string;
    priority: string;
    indication: string;
    drug: string;
  };
  knowledgeBank: Record<string, string>;
  // Full editable config for the Agent Flow view + Question Routing editor
  flow: {
    nodes: Array<{ id: string; type: string; label: string }>;
    edges: Array<{ source: string; target: string; label: string }>;
  };
  screeningQuestions: ScreeningQuestion[];
}

export function studyDetail(id: string, S: Study): StudyDetail {
  const m = S.study ?? {};
  return {
    id,
    name: m.name ?? id,
    sponsor: m.sponsor ?? '',
    indication: m.indication ?? '',
    drug: m.drug ?? '',
    phase: m.phase ?? '',
    questions: compileQuestions(S).map((q: ScreeningQuestion) => ({
      rank: q.rank,
      variable_name: q.variable_name,
      sms_question: q.sms_question,
      answer_type: q.answer_type,
      choices: q.choices ?? null,
    })),
    criteriaCount: {
      inclusion: (S.inclusionCriteria ?? []).length,
      exclusion: (S.exclusionCriteria ?? []).length,
    },
    status: S.status ?? ((S.screeningQuestions ?? []).length ? 'ready' : 'draft'),
    overview: {
      name: m.name ?? '',
      internalNumber: m.internalNumber ?? '',
      sponsor: m.sponsor ?? '',
      principalInvestigator: m.principalInvestigator ?? '',
      site: m.site ?? '',
      priority: m.priority ?? '',
      indication: m.indication ?? '',
      drug: m.drug ?? '',
    },
    knowledgeBank: S.knowledgeBank ?? {},
    flow: {
      nodes: (S.flow?.nodes ?? []).map((n) => ({
        id: String(n.id),
        type: String((n as { type?: string }).type ?? 'question'),
        label: String((n as { label?: string }).label ?? ''),
      })),
      edges: (S.flow?.edges ?? []).map((e) => ({
        source: String(e.source),
        target: String(e.target),
        label: String((e as { label?: string }).label ?? ''),
      })),
    },
    screeningQuestions: S.screeningQuestions ?? [],
  };
}

// ---------- createStudy ----------
export interface CreateStudyBody {
  name?: string;
  internalNumber?: string;
  sponsor?: string;
  indication?: string;
  drug?: string;
  documents?: Array<{ filename?: string; type?: string; dataBase64?: string }>;
}

export type CreateStudyResult =
  | { id: string; status: string; documents: number; note: string }
  | { error: string; code: number };

export function createStudy(body: CreateStudyBody): CreateStudyResult {
  const STUDIES_DIR = getStudiesDir();
  const name = (body.name ?? '').trim();
  if (!name) return { error: 'name required', code: 400 };
  const id = slugify(body.internalNumber ?? name);
  const dir = path.join(STUDIES_DIR, id);
  if (fs.existsSync(path.join(dir, 'study.json'))) {
    return { error: `study "${id}" already exists`, code: 409 };
  }
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });

  const documents: Array<{
    name: string;
    type: string;
    uploaded: string;
    documentId: string;
    extractionStatus: string;
  }> = [];

  for (const d of body.documents ?? []) {
    if (!d.filename || !d.dataBase64) continue;
    const safe = path.basename(d.filename).replace(/[^\w.()\-]+/g, '_');
    const pdfPath = path.join(dir, 'docs', safe);
    try {
      fs.writeFileSync(pdfPath, Buffer.from(d.dataBase64, 'base64'));
    } catch {
      continue;
    }
    // extract text next to study root (protocol.txt / icf.txt) for the onboarding pipeline
    let extracted = false;
    const outTxt = path.join(dir, (d.type === 'ICF' ? 'icf' : 'protocol') + '.txt');
    try {
      execFileSync('pdftotext', ['-layout', pdfPath, outTxt]);
      extracted = fs.existsSync(outTxt);
    } catch {
      extracted = false;
    }
    documents.push({
      name: safe,
      type: d.type ?? 'Protocol',
      uploaded: new Date().toISOString().slice(0, 10),
      documentId: '',
      extractionStatus: extracted
        ? 'text-extracted (awaiting criteria/question extraction)'
        : 'uploaded (pdftotext unavailable)',
    });
  }

  const S: Study = {
    source: 'Uploaded via comforceEva UI',
    capturedAt: new Date().toISOString().slice(0, 10),
    status: 'draft',
    study: {
      name,
      internalNumber: body.internalNumber ?? id,
      sponsor: body.sponsor ?? '',
      principalInvestigator: '',
      site: '',
      priority: '',
      indication: body.indication ?? '',
      drug: body.drug ?? '',
      flowStatus: 'draft (uploaded — pending extraction)',
      flowVersion: 0,
      isPublished: false,
      studyId: '',
      selectedProtocolDocumentId: '',
      _REQUIRED_FROM_SITE: 'PI, site, priority — supply from site/CRM',
    },
    documents,
    knowledgeBank: {
      'General Study Information': '',
      'Trial Design': '',
      'Compensation / Reimbursement': '',
      Blinding: '',
    },
    inclusionCriteria: [],
    exclusionCriteria: [],
    screeningQuestions: [],
    flow: {
      nodes: [{ id: 'root', type: 'root', label: 'Are you interested in this study?' }],
      edges: [],
    },
    funnel: [],
    patients: [],
    recruiters: [],
  };

  fs.writeFileSync(path.join(dir, 'study.json'), JSON.stringify(S, null, 2));
  return {
    id,
    status: 'draft',
    documents: documents.length,
    note: 'Documents uploaded and text-extracted. Run the StudyOnboard pipeline (classify → questions → build) to make it screenable.',
  };
}

// ---------- updateStudy ----------
export interface UpdateStudyPatch {
  study?: Record<string, unknown>;
  knowledgeBank?: Record<string, string>;
  conversation?: Record<string, string>;
  screeningQuestions?: ScreeningQuestion[];
  flow?: { nodes: unknown[]; edges: unknown[] };
  status?: string;
}

export type UpdateStudyResult =
  | (StudyDetail & { id: string })
  | { error: string; code: number };

export function updateStudy(id: string, patch: UpdateStudyPatch): UpdateStudyResult {
  const STUDIES_DIR = getStudiesDir();
  const p = path.join(STUDIES_DIR, id, 'study.json');
  if (!fs.existsSync(p)) return { error: 'study not found', code: 404 };
  let S: Study;
  try {
    S = JSON.parse(fs.readFileSync(p, 'utf8')) as Study;
  } catch {
    return { error: 'corrupt study.json', code: 500 };
  }
  if (patch.study && typeof patch.study === 'object') {
    S.study = { ...(S.study ?? {}), ...patch.study };
  }
  if (patch.knowledgeBank && typeof patch.knowledgeBank === 'object') {
    S.knowledgeBank = { ...(S.knowledgeBank ?? {}), ...patch.knowledgeBank };
  }
  if (patch.conversation && typeof patch.conversation === 'object') {
    S.conversation = { ...(S.conversation ?? {}), ...patch.conversation };
  }
  if (Array.isArray(patch.screeningQuestions)) {
    S.screeningQuestions = patch.screeningQuestions;
  }
  if (patch.flow && Array.isArray(patch.flow.nodes) && Array.isArray(patch.flow.edges)) {
    S.flow = patch.flow as Study['flow'];
  }
  if (patch.status) S.status = patch.status as 'draft' | 'ready';
  fs.writeFileSync(p, JSON.stringify(S, null, 2));
  return studyDetail(id, S); // studyDetail already includes `id`
}

// ---------- reportForStudy ----------
export interface ReportResult {
  counts: { qualified: number; dnq: number; incomplete: number; total: number };
  dnqReasons: Array<{ reason: string; count: number }>;
  patients: Array<{ patient: string; terminal: string; failed: string | null; reason: string | null }>;
}

export function reportForStudy(id: string): ReportResult {
  const STUDIES_DIR = getStudiesDir();
  const empty: ReportResult = {
    counts: { qualified: 0, dnq: 0, incomplete: 0, total: 0 },
    dnqReasons: [],
    patients: [],
  };
  const studyDir = path.join(STUDIES_DIR, id);
  const studyPath = path.join(studyDir, 'study.json');
  const inbox = path.join(studyDir, 'screening');
  if (!fs.existsSync(studyPath) || !fs.existsSync(inbox)) return empty;
  const S = loadStudy(id);
  if (!S) return empty;

  const all = fs
    .readdirSync(inbox)
    .filter(
      (f) =>
        /\.(txt|json)$/.test(f) &&
        !f.startsWith('result') &&
        !f.startsWith('transcript-eval')
    );

  // dedupe by patient basename — prefer .json over .txt (LLM-extracted answers)
  const byBase = new Map<string, string>();
  for (const f of all.sort()) {
    const base = f.replace(/\.(txt|json)$/, '');
    if (!byBase.has(base) || f.endsWith('.json')) byBase.set(base, f);
  }

  const results: Array<{
    patient: string;
    terminal: string;
    failed: string | null;
    reason: string | null;
  }> = [];

  for (const f of [...byBase.values()].sort()) {
    let answers: Record<string, unknown>;
    try {
      const raw = fs.readFileSync(path.join(inbox, f), 'utf8');
      answers = f.endsWith('.json')
        ? (JSON.parse(raw) as Record<string, unknown>)
        : parseAnswerTxt(raw);
    } catch {
      continue;
    }
    const r = screenPatient(S, answers);
    results.push({
      patient: f.replace(/\.(txt|json)$/, ''),
      terminal: r.terminal,
      failed: r.failed ?? null,
      reason: r.reason ?? null,
    });
  }

  const counts = {
    qualified: results.filter((r) => r.terminal === 'QUALIFIED').length,
    dnq: results.filter((r) => r.terminal === 'DNQ').length,
    incomplete: results.filter((r) => r.terminal === 'INCOMPLETE').length,
    total: results.length,
  };

  const byReason: Record<string, number> = {};
  for (const r of results.filter((r) => r.terminal === 'DNQ')) {
    byReason[r.reason ?? ''] = (byReason[r.reason ?? ''] ?? 0) + 1;
  }
  const dnqReasons = Object.entries(byReason)
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => ({ reason, count }));

  return { counts, dnqReasons, patients: results };
}
