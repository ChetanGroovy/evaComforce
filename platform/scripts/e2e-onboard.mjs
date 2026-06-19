/**
 * e2e-onboard.mjs — SELF-CONTAINED end-to-end harness for the StudyOnboard slice (PF5 / Phase 1).
 *
 * Run from the repo root:
 *   node platform/scripts/e2e-onboard.mjs
 *
 * Exit 0 = all assertions passed, exit 1 = any failure (or spawn/listen timeout).
 *
 * What it does (no external server, no shared fixtures, no network):
 *   1. Rebuilds the @comforceeva/schema dist + apps/api dist so the spawned server runs the
 *      CURRENT TypeScript (start='node dist/index.js' serves the compiled dist — a stale dist
 *      404s the /onboard route and silently runs OLD createStudy). A deliberately stale dist
 *      must make this harness fail fast, so the rebuild is an ordered precondition, not optional.
 *   2. Writes a canned extraction JSON fixture to /tmp (>=6 questions, valid disqualify_condition
 *      grammar) and points the server at it via process.env.LLM_JSON_STUB — the deterministic
 *      seam the onboard pipeline reads INSTEAD of any LLM/network call.
 *   3. Spawns its OWN api child_process (node platform/apps/api/dist/index.js) on a throwaway PORT,
 *      with STUDIES_DIR=/tmp/onboard-e2e-<pid>, ONBOARD_ON_CREATE=on, and a non-rule LLM backend so
 *      onboard actually fires. Waits for the server to listen.
 *   4. Creates a study (POST /api/studies) with a protocol PDF, then polls GET /api/studies/:id
 *      until status is terminal (needs_review | draft), bounded ~60s.
 *   5. Asserts: status === 'needs_review', screeningQuestions.length > 0, flow.nodes.length > 1.
 *   6. ALWAYS kills the child and rm -rf's the temp STUDIES_DIR (success or failure).
 *
 * CONTRACT NOTE: the LLM_JSON_STUB seam and the onboard-on-create trigger are implemented in later
 * waves (P1-T2 / P1-T3 / PF1 / PF6). This harness is written to MATCH that contract and is RUN in
 * Gate-C, NOT now. If you run it before those waves land, it will fail at the assertion stage
 * (status stays 'draft' or 'ready') — that is expected pre-wave behaviour.
 *
 * Playwright import style mirrors platform/apps/web/e2e/verify-flow-feature.mjs (absolute path import).
 * Playwright is loaded only to keep the import seam identical to the sibling harness; the actual
 * driving here is HTTP (the onboard slice has no bespoke UI assertion beyond AgentFlowGraph, which
 * verify-flow-feature.mjs already covers).
 */

import { chromium } from '/home/groovy/Desktop/projects/comforceEva/node_modules/playwright/index.mjs';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';

// ──────────────────────────────────────────────────────────────────────────────
// Paths (all absolute, anchored at the repo root two levels up from this file).
// ──────────────────────────────────────────────────────────────────────────────
const REPO_ROOT = path.resolve('/home/groovy/Desktop/projects/comforceEva');
const API_DIR = path.join(REPO_ROOT, 'platform', 'apps', 'api');
const API_ENTRY = path.join(API_DIR, 'dist', 'index.js');
const API_TSCONFIG = path.join(API_DIR, 'tsconfig.json');
const SCHEMA_TSCONFIG = path.join(REPO_ROOT, 'platform', 'packages', 'schema', 'tsconfig.json');
const TSC = path.join(REPO_ROOT, 'platform', 'node_modules', '.bin', 'tsc');
const TSC_FALLBACK = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

// Throwaway runtime config.
const PORT = 7900 + (process.pid % 80); // unlikely-to-collide ephemeral-ish port
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;
const STUDIES_DIR = path.join(os.tmpdir(), `onboard-e2e-${process.pid}`);
const STUB_PATH = path.join(os.tmpdir(), `onboard-e2e-stub-${process.pid}.json`);

const LISTEN_TIMEOUT_MS = 30_000;
const POLL_TIMEOUT_MS = 60_000;
const POLL_INTERVAL_MS = 2_000;

const STUDY_NAME = 'Onboard E2E Study';
const STUDY_INTERNAL = 'ONBOARDE2E001';

// ──────────────────────────────────────────────────────────────────────────────
// Result bookkeeping.
// ──────────────────────────────────────────────────────────────────────────────
const results = [];
function pass(name, evidence) {
  results.push({ name, status: 'PASS', evidence });
  console.log(`PASS  ${name}${evidence ? ` — ${evidence}` : ''}`);
}
function fail(name, evidence) {
  results.push({ name, status: 'FAIL', evidence });
  console.error(`FAIL  ${name}${evidence ? ` — ${evidence}` : ''}`);
}

// ──────────────────────────────────────────────────────────────────────────────
// Canned extraction fixture: >=6 questions, valid disqualify_condition grammar.
// Grammar (per EXTRACTION-PLAYBOOK / studygen linter): age < N | answer == no | answer == yes.
// Mirrors the live WC45276 valid form (spaced operators). Includes an inverted-framing knockout
// (answer == no) and a carve-out (answer == yes) so deriveFlow emits pass/fail/dnq edges.
// ──────────────────────────────────────────────────────────────────────────────
const STUB_EXTRACTION = {
  inclusionCriteria: [
    { id: 'INC-1', text: 'Adult aged 18 years or older' },
    { id: 'INC-2', text: 'Able to provide written informed consent' },
  ],
  exclusionCriteria: [
    { id: 'EXC-1', text: 'Currently pregnant or breastfeeding' },
    { id: 'EXC-2', text: 'Active malignancy within the last 5 years' },
    { id: 'EXC-3', text: 'Known hypersensitivity to the study drug' },
  ],
  screeningQuestions: [
    {
      question_key: 'q1',
      variable_name: 'age',
      sms_question: 'How old are you?',
      answer_type: 'number',
      disqualify_condition: 'age < 18',
      criteria_ids: ['INC-1'],
      rank: 1,
    },
    {
      question_key: 'q2',
      variable_name: 'consent',
      sms_question: 'Are you able to provide written informed consent?',
      answer_type: 'yes_no',
      disqualify_condition: 'answer == no',
      criteria_ids: ['INC-2'],
      rank: 2,
    },
    {
      // Early routing question — the pregnancy gate (q3) depends on this.
      // validateQuestions() requires any pregnancy/breastfeeding question to be
      // gated by show_if (matching /sex|gender/) + depends_on pointing at a
      // routing:true variable. Without this, q3 fails validation and the
      // pipeline parks the study at 'draft' with 0 questions.
      question_key: 'q2b',
      variable_name: 'sex_at_birth',
      sms_question: 'What was your sex assigned at birth?',
      answer_type: 'choice',
      choices: ['Female', 'Male'],
      routing: true,
      rank: 3,
    },
    {
      question_key: 'q3',
      variable_name: 'pregnant',
      sms_question: 'Are you currently pregnant or breastfeeding?',
      answer_type: 'yes_no',
      disqualify_condition: 'answer == yes',
      show_if: 'sex_at_birth == "Female"',
      depends_on: ['sex_at_birth'],
      criteria_ids: ['EXC-1'],
      rank: 4,
    },
    {
      question_key: 'q4',
      variable_name: 'malignancy',
      sms_question: 'Have you had any active cancer in the last 5 years?',
      answer_type: 'yes_no',
      disqualify_condition: 'answer == yes',
      criteria_ids: ['EXC-2'],
      rank: 5,
    },
    {
      question_key: 'q5',
      variable_name: 'allergy',
      sms_question: 'Do you have a known allergy to the study drug?',
      answer_type: 'yes_no',
      disqualify_condition: 'answer == yes',
      criteria_ids: ['EXC-3'],
      rank: 6,
    },
    {
      question_key: 'q6',
      variable_name: 'available',
      sms_question: 'Are you able to attend the study visits at the site?',
      answer_type: 'yes_no',
      disqualify_condition: 'answer == no',
      criteria_ids: ['INC-2'],
      rank: 7,
    },
  ],
};

// ──────────────────────────────────────────────────────────────────────────────
// A minimal valid PDF (single page, a few eligibility lines) so createStudy's
// pdftotext step produces protocol.txt — the onboard null-guard requires it.
// This is a hand-written PDF byte stream; it renders/extracts to plain text.
// ──────────────────────────────────────────────────────────────────────────────
function makeProtocolPdfBase64() {
  const text =
    'Eligibility Criteria. Inclusion: adults aged 18 or older able to consent. ' +
    'Exclusion: pregnancy, active malignancy within 5 years, drug hypersensitivity. ' +
    'Participants must attend study visits at the site.';
  const stream = `BT /F1 12 Tf 36 740 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`;
  const objects = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objects.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] ' +
      '/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>'
  );
  objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += '0000000000 65535 f \n';
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, 'latin1').toString('base64');
}

// ──────────────────────────────────────────────────────────────────────────────
// HTTP helpers (no fetch dependency assumptions; uses node:http).
// ──────────────────────────────────────────────────────────────────────────────
function httpJson(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request(
      `${BASE}${urlPath}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(data ? { 'Content-Length': data.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try {
            parsed = raw ? JSON.parse(raw) : null;
          } catch {
            parsed = { _raw: raw };
          }
          resolve({ status: res.statusCode, body: parsed });
        });
      }
    );
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForListen(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await httpJson('GET', '/api/studies');
      if (res.status && res.status < 500) return true;
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  return false;
}

// ──────────────────────────────────────────────────────────────────────────────
// Build step: rebuild schema dist + api dist so the spawned server is current.
// A failed build is a HARD failure — a stale dist would silently pass-then-404.
// ──────────────────────────────────────────────────────────────────────────────
function resolveTsc() {
  if (fs.existsSync(TSC)) return TSC;
  if (fs.existsSync(TSC_FALLBACK)) return TSC_FALLBACK;
  return null;
}

function rebuildDist() {
  const tsc = resolveTsc();
  if (!tsc) {
    fail('build/tsc-present', `tsc not found at ${TSC} or ${TSC_FALLBACK}`);
    return false;
  }
  for (const [label, cfg] of [
    ['schema', SCHEMA_TSCONFIG],
    ['api', API_TSCONFIG],
  ]) {
    const r = spawnSync(tsc, ['-p', cfg], { cwd: REPO_ROOT, encoding: 'utf8' });
    if (r.status !== 0) {
      fail(`build/${label}`, `tsc -p ${cfg} exit=${r.status}\n${r.stdout || ''}${r.stderr || ''}`.slice(0, 800));
      return false;
    }
  }
  if (!fs.existsSync(API_ENTRY)) {
    fail('build/api-entry', `expected built entry missing: ${API_ENTRY}`);
    return false;
  }
  pass('build', `schema + api dist rebuilt; entry present at ${API_ENTRY}`);
  return true;
}

// ──────────────────────────────────────────────────────────────────────────────
// Main.
// ──────────────────────────────────────────────────────────────────────────────
let child = null;
let browser = null;

async function main() {
  // 1) Rebuild dist (ordered precondition).
  if (!rebuildDist()) return;

  // 2) Write the canned extraction stub fixture.
  fs.writeFileSync(STUB_PATH, JSON.stringify(STUB_EXTRACTION, null, 2));
  const stubQ = STUB_EXTRACTION.screeningQuestions.length;
  if (stubQ < 6) {
    fail('stub/question-count', `stub has ${stubQ} questions (need >=6)`);
    return;
  }
  pass('stub', `wrote ${STUB_PATH} with ${stubQ} questions`);

  // 3) Prepare throwaway STUDIES_DIR + spawn the api child.
  fs.mkdirSync(STUDIES_DIR, { recursive: true });

  child = spawn('node', [API_ENTRY], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST,
      STUDIES_DIR,
      ONBOARD_ON_CREATE: 'on',
      LLM_JSON_STUB: STUB_PATH,
      // Force a non-'rule' backend so the onboard trigger actually fires (gate uses
      // llmBackend() !== 'rule'). The stub seam short-circuits any real network call.
      LLM_PROVIDER: 'anthropic',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d) => process.stdout.write(`[api] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[api] ${d}`));
  child.on('exit', (code, sig) => {
    if (code !== 0 && code !== null) {
      console.error(`[api] child exited early code=${code} sig=${sig}`);
    }
  });

  // Keep the playwright import seam identical to the sibling harness (launch a browser
  // so the import is exercised), but drive assertions over HTTP.
  try {
    browser = await chromium.launch({ headless: true });
  } catch {
    // Browser launch is not load-bearing for the assertions; continue if it fails.
    browser = null;
  }

  // 4) Wait for listen.
  const listening = await waitForListen(Date.now() + LISTEN_TIMEOUT_MS);
  if (!listening) {
    fail('server/listen', `api did not listen on ${BASE} within ${LISTEN_TIMEOUT_MS}ms`);
    return;
  }
  pass('server/listen', `api listening on ${BASE}`);

  // 5) Create a study (uploads a protocol PDF -> pdftotext -> protocol.txt for onboard).
  const createRes = await httpJson('POST', '/api/studies', {
    name: STUDY_NAME,
    internalNumber: STUDY_INTERNAL,
    documents: [
      { filename: 'protocol.pdf', type: 'Protocol', dataBase64: makeProtocolPdfBase64() },
    ],
  });
  if (createRes.status !== 201 || !createRes.body || !createRes.body.id) {
    fail('create', `POST /api/studies -> ${createRes.status} ${JSON.stringify(createRes.body).slice(0, 300)}`);
    return;
  }
  const studyId = createRes.body.id;
  pass('create', `study id=${studyId} status=${createRes.body.status}`);

  // 6) Poll GET /api/studies/:id until terminal (needs_review | draft), bounded ~60s.
  const terminal = new Set(['needs_review', 'draft']);
  let last = null;
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const r = await httpJson('GET', `/api/studies/${studyId}`);
    if (r.status === 200 && r.body) {
      last = r.body;
      const st = last.overview?.status ?? last.status;
      if (terminal.has(st)) break;
    }
    await sleep(POLL_INTERVAL_MS);
  }

  if (!last) {
    fail('poll', `never got a 200 detail for ${studyId} within ${POLL_TIMEOUT_MS}ms`);
    return;
  }

  const status = last.overview?.status ?? last.status;
  const questions = Array.isArray(last.screeningQuestions) ? last.screeningQuestions : [];
  const nodes = Array.isArray(last.flow?.nodes) ? last.flow.nodes : [];

  // Assertions.
  if (status === 'needs_review') {
    pass('status', `status === 'needs_review'`);
  } else {
    fail('status', `expected 'needs_review', got '${status}'`);
  }

  if (questions.length > 0) {
    pass('screeningQuestions', `${questions.length} questions`);
  } else {
    fail('screeningQuestions', `expected >0, got ${questions.length}`);
  }

  if (nodes.length > 1) {
    pass('flow.nodes', `${nodes.length} nodes (>1)`);
  } else {
    fail('flow.nodes', `expected >1, got ${nodes.length}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Cleanup: ALWAYS kill the child and rm -rf the temp dir + stub fixture.
// ──────────────────────────────────────────────────────────────────────────────
function cleanup() {
  if (browser) {
    try {
      browser.close();
    } catch {
      /* noop */
    }
  }
  if (child && !child.killed) {
    try {
      child.kill('SIGKILL');
    } catch {
      /* noop */
    }
  }
  for (const p of [STUDIES_DIR, STUB_PATH]) {
    try {
      fs.rmSync(p, { recursive: true, force: true });
    } catch {
      /* noop */
    }
  }
}

main()
  .catch((err) => {
    fail('harness', `uncaught: ${err?.stack || err}`);
  })
  .finally(() => {
    cleanup();
    const failed = results.filter((r) => r.status === 'FAIL');
    const allPass = failed.length === 0 && results.length > 0;
    console.log('\n══════════════════════════════════════════════');
    console.log(allPass ? 'ONBOARD E2E: PASS' : 'ONBOARD E2E: FAIL');
    console.log(`  ${results.filter((r) => r.status === 'PASS').length} passed / ${failed.length} failed`);
    if (failed.length) {
      for (const r of failed) console.error(`  FAIL ${r.name}: ${r.evidence}`);
    }
    console.log('══════════════════════════════════════════════');
    process.exit(allPass ? 0 : 1);
  });
