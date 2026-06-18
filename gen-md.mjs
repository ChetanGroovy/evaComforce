// Parses captured raw payloads for study WC45276 and emits two markdown reports:
//   STUDY-WC45276-FULL.md      (includes patient PII + all detail, for cross-check)
//   STUDY-WC45276-REDACTED.md  (PII/PHI stripped)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
process.chdir(DIR);
const OUT = 'study-WC45276';
const raw = (n) => fs.readFileSync(path.join(OUT, 'raw', n), 'utf8');

// fix common mojibake from latin1/utf8 mix
const fix = (s) => (s ?? '')
  .replace(/â‰¥/g, '≥').replace(/â‰¤/g, '≤')
  .replace(/â€“/g, '–').replace(/â€”/g, '—')
  .replace(/â€™/g, '’').replace(/â€œ/g, '“').replace(/â€/g, '”')
  .replace(/Ã—/g, '×').replace(/Â²/g, '²').replace(/Â/g, '');

// ---- Next.js RSC streaming parser ----
// Body = concatenated chunks: `<id>:<inline-json>` OR `<id>:<Tag><hexlen>,<blob>`.
// Values may reference other chunks via "$N" / "$@N".
function parseRSC(txt) {
  const t = txt.replace(/^URL:.*\nMETHOD:.*\nSTATUS:.*\nCT:.*\n\n/s, '');
  const chunks = {};
  let i = 0;
  while (i < t.length) {
    const m = /^(\d+):/.exec(t.slice(i));
    if (!m) { const nl = t.indexOf('\n', i); if (nl < 0) break; i = nl + 1; continue; }
    i += m[0].length;
    const id = m[1];
    const b = /^([A-Za-z])([0-9a-f]+),/.exec(t.slice(i, i + 24)); // blob: tag + hexlen + ','
    if (b) {
      const len = parseInt(b[2], 16);
      i += b[0].length;
      chunks[id] = t.slice(i, i + len);
      i += len;
    } else {
      let nl = t.indexOf('\n', i); if (nl < 0) nl = t.length;
      chunks[id] = t.slice(i, nl);
      i = nl + 1;
    }
  }
  return chunks;
}
function parseChunk(s) { if (s == null) return null; try { return JSON.parse(s); } catch { return s; } }
function resolve(val, chunks, seen = new Set()) {
  if (typeof val === 'string') {
    const m = /^\$@?(\d+)$/.exec(val);
    if (m && !seen.has(m[1])) { seen.add(m[1]); return resolve(parseChunk(chunks[m[1]]), chunks, seen); }
    return val;
  }
  if (Array.isArray(val)) return val.map(v => resolve(v, chunks, new Set(seen)));
  if (val && typeof val === 'object') { const o = {}; for (const k in val) o[k] = resolve(val[k], chunks, new Set(seen)); return o; }
  return val;
}
// pick the root chunk that contains one of the wanted keys, then resolve refs
function parseBody(txt, wantKeys) {
  const chunks = parseRSC(txt);
  let root = null;
  for (const id of Object.keys(chunks)) {
    const v = parseChunk(chunks[id]);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      let probe = v.data && typeof v.data === 'object' ? v.data : v;
      if (Array.isArray(probe)) probe = probe[0] || {};
      if (probe && wantKeys.some(k => k in probe)) { root = v; break; }
    }
  }
  if (!root) return {};
  return resolve(root, chunks);
}

const unwrap = (o) => { let d = o?.data ?? o; return Array.isArray(d) ? (d[0] ?? {}) : d; };

// ---- 1. Flow config (study setup, knowledge bank, criteria, questions, flow) ----
const flow = unwrap(parseBody(raw('125.txt'), ['screeningQuestions', 'studyName', 'inclusionCriteria'])) || {};

// ---- 2. Document extraction (protocol -> criteria with page refs) ----
const docExtract = unwrap(parseBody(raw('133.txt'), ['documentType', 'inclusionCriteria', 'fileName'])) || {};

// ---- 3. Patients (PII) ----
const patientsRaw = unwrap(parseBody(raw('132.txt'), ['buckets', 'groups'])) || {};
const buckets = patientsRaw.buckets || patientsRaw.groups || [];

// Patient rows live across paginated payloads — scan every raw file for patient objects.
function collectPatients() {
  const dir = path.join(OUT, 'raw');
  const byId = new Map();
  for (const f of fs.readdirSync(dir)) {
    let txt; try { txt = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
    if (!txt.includes('"displayName"') || !txt.includes('"primaryPhone"')) continue;
    // patient objects contain nested objects -> balanced-brace scan around each "patientId"
    let idx = 0;
    while ((idx = txt.indexOf('"patientId"', idx)) !== -1) {
      // walk back to the '{' that opens this object
      let start = txt.lastIndexOf('{', idx);
      if (start < 0) { idx += 11; continue; }
      // balanced forward scan
      let depth = 0, inStr = false, esc = false, end = -1;
      for (let i = start; i < txt.length; i++) {
        const c = txt[i];
        if (esc) { esc = false; continue; }
        if (c === '\\') { esc = true; continue; }
        if (c === '"') inStr = !inStr;
        else if (!inStr) { if (c === '{') depth++; else if (c === '}') { depth--; if (depth === 0) { end = i; break; } } }
      }
      if (end < 0) { idx += 11; continue; }
      let o; try { o = JSON.parse(txt.slice(start, end + 1)); } catch { idx = end + 1; continue; }
      const id = o.patientId || o.id;
      if (id && o.displayName !== undefined && !byId.has(id)) byId.set(id, o);
      idx = end + 1;
    }
  }
  return [...byId.values()];
}
const allPatients = collectPatients();

// ---------- builders ----------
const j = (v) => JSON.stringify(v);

function header(redacted) {
  return `# Study WC45276 (CT-388-106)_Obesity — ${redacted ? 'Redacted' : 'Full'} Configuration

> Source: Alleviate Health (DM Clinical Research) · captured ${'2026-06-17'}
> Study ID: \`${flow.studyId || docExtract.studyId || ''}\`
> Raw HTML/screenshots: \`study-WC45276/html/\`, \`study-WC45276/shots/\`
> Raw payloads: \`study-WC45276/raw/\` (125=flow, 132=patients, 133=doc-extract)
${redacted ? '> **PII/PHI removed.** Patient names & phone numbers replaced with counts only.\n' : '> **CONTAINS PII/PHI** (patient names + phone numbers). Handle per HIPAA.\n'}
---
`;
}

function sectionOverview() {
  return `## 1. Study Overview (how the study is set up)

| Field | Value |
|---|---|
| Study name | WC45276 (CT-388-106)_Obesity |
| Internal # | WC45726 |
| Sponsor | F. Hoffmann-La Roche Ltd |
| Principal Investigator | Vicki Miller, MD |
| Site | Houston Metro (13406 Medical Complex Drive, Ste 150/180/190, Tomball, TX 77375) |
| Priority | Very High |
| Indication | Type 2 Diabetes + overweight/obesity |
| Investigational drug | GLP-1/GIP receptor agonist (CT-388), weekly |
| Flow status | ${flow.status || ''} ${flow.isPublished ? '(Published v' + (flow.publishedVersion ?? flow.version) + ')' : ''} |
| Flow updated | ${flow.updatedAt || ''} |
| Selected protocol doc | \`${flow.selectedProtocolDocumentId || ''}\` |

**How a study is configured (observed model):**
1. Create study → set name, sponsor, PI, site, priority.
2. Upload **Study Documents** (Protocol, ICF).
3. System **extracts inclusion/exclusion criteria** from the Protocol PDF (per-page source refs) — see §4.
4. Build the **Knowledge Bank** (general info, trial design, compensation, blinding) — §3.
5. Generate **screening questions** from criteria — §5.
6. Assemble the **Agent Flow** graph (Start → Questions → BMI check → Qualified/DNQ) — §6.
7. Assign **Recruiters** and (optionally) link **CTMS**.
`;
}

function sectionDocuments() {
  return `## 2. Study Documents

| Document | Type | Uploaded | Doc ID |
|---|---|---|---|
| Protocol - WC45726 - GLP-1GIP receptor agonist (CT-388) - V1 - IRB Approved 15-JAN-2026 | Protocol | May 15, 2026 | \`${docExtract.documentId || ''}\` |
| Main_ICF_-_WC45276_(CT-388-106)_IRB_Approved_30-JAN-2026 | ICF | May 15, 2026 | — |

- Protocol \`contentType\`: ${docExtract.contentType || 'application/pdf'} · extraction: **${docExtract.extractionStatus || ''}**
- Documents are the **source of truth**: the Protocol is parsed into eligibility criteria (§4), which seed the screening questions (§5).
`;
}

function sectionKnowledgeBank() {
  const kb = [
    ['General Study Information', flow.generalInfo],
    ['Trial Design', flow.trialDesign],
    ['Compensation / Reimbursement', flow.compensation],
    ['Blinding', flow.blinding],
  ];
  let s = `## 3. Knowledge Bank\n\nFree-text reference the call agent uses to answer patient questions.\n\n`;
  for (const [t, v] of kb) {
    s += `### ${t}\n\n${fix(v) || '_No content added yet._'}\n\n`;
  }
  return s;
}

function critTable(arr, label) {
  if (!arr || !arr.length) return `_No ${label} captured._\n`;
  let s = `| # | Pages | Criterion |\n|---|---|---|\n`;
  for (const c of arr) {
    const pages = Array.isArray(c.source_pages) ? c.source_pages.join(', ') : (c.source_pages ?? '');
    s += `| ${c.criterion_number ?? ''} | ${pages} | ${fix(c.criterion_text || c.original_text).replace(/\|/g, '\\|')} |\n`;
  }
  return s;
}

function sectionCriteria() {
  // prefer doc-extract criteria — they carry source_pages (protocol traceability)
  const inc = (docExtract.inclusionCriteria?.length ? docExtract.inclusionCriteria : flow.inclusionCriteria) || [];
  const exc = (docExtract.exclusionCriteria?.length ? docExtract.exclusionCriteria : flow.exclusionCriteria) || [];
  return `## 4. Eligibility Criteria (extracted from Protocol)

These are auto-extracted from the Protocol PDF; \`Pages\` references the source page in the document — this is the traceability for where each screening question comes from.

### Inclusion (${inc.length})

${critTable(inc, 'inclusion criteria')}

### Exclusion (${exc.length})

${critTable(exc, 'exclusion criteria')}
`;
}

function sectionQuestions() {
  const qs = flow.screeningQuestions || [];
  let s = `## 5. Screening Questions (${qs.length}) — created from criteria

Each question is generated from one or more eligibility criteria (\`criteria_ids\` → §4). \`knockout_power\` + qualify/disqualify conditions decide routing.

`;
  for (const q of qs) {
    s += `### Q${q.rank ?? ''}. ${fix(q.sms_question)}\n`;
    s += `- **variable**: \`${q.variable_name || ''}\` · **type**: ${q.answer_type || ''} · **category**: ${q.category || ''}\n`;
    if (q.choices && q.choices.length) s += `- **choices**: ${q.choices.map(c => fix(typeof c === 'string' ? c : (c.label || c.value || j(c)))).join(' / ')}\n`;
    s += `- **qualifying**: ${q.is_qualifying_question ? 'yes' : 'no'} · **knockout_power**: ${q.knockout_power ?? ''} · **in_flow**: ${q.included_in_flow ? 'yes' : 'no'}\n`;
    if (q.qualify_condition) s += `- **qualify if**: ${fix(j(q.qualify_condition))}\n`;
    if (q.disqualify_condition) s += `- **disqualify if**: ${fix(j(q.disqualify_condition))}\n`;
    if (q.depends_on) s += `- **depends_on**: ${j(q.depends_on)}\n`;
    if (q.criteria_ids) s += `- **from criteria**: ${j(q.criteria_ids)}\n`;
    s += `\n`;
  }
  return s;
}

function sectionFlow() {
  const nodes = flow.nodes || [];
  const edges = flow.edges || [];
  let s = `## 6. Agent Flow (screening logic graph)

**Nodes (${nodes.length}):**

| id | type | label |
|---|---|---|
`;
  for (const n of nodes) s += `| ${n.id} | ${n.type || ''} | ${fix(n.label || n.data?.label || '')} |\n`;
  s += `\n**Edges (${edges.length}):**\n\n`;
  for (const e of edges) s += `- ${e.source} → ${e.target}${e.label ? ' [' + fix(e.label) + ']' : ''}\n`;
  s += `\nKey outcomes: **Qualified**, plus DNQ buckets (age<18, BMI<27, no T2D dx, no failed weight-loss attempt, T1DM/ketoacidosis, organ transplant, gastric emptying, MTC/MEN2 history). Includes a **BMI Check** computed node (BMI ≥ 27.0 gate).\n`;
  return s;
}

function sectionPatients(redacted) {
  let s = `## 7. Patients / Recruitment Funnel\n\n`;
  if (buckets.length) {
    s += `| Bucket | Count |\n|---|---|\n`;
    for (const b of buckets) s += `| ${b.label || b.key} | ${b.count ?? (b.subjects ? b.subjects.length : '')} |\n`;
    s += `\n`;
  } else {
    s += `Funnel buckets (from Study Info tab):\n\n| Bucket | Count |\n|---|---|\n| Study Outreach | 436 |\n| Manually Added | 436 |\n| Booked for Call | 94 |\n| To Call | 2231 |\n| DNQ - Criteria Not Met | 665 |\n| DNQ - Not Interested | 304 |\n| Contact Attempt 1/2/3 | 0 |\n\n`;
  }
  if (redacted) {
    s += `_Patient-level rows (names, phone numbers) removed in this redacted version. See FULL report for cross-check._\n`;
  } else {
    s += `### Patient rows (PII — cross-check only)\n\n`;
    if (allPatients.length) {
      s += `${allPatients.length} unique patients captured across paginated payloads.\n\n`;
      s += `| Name | Phone | Status | Step | Last Activity |\n|---|---|---|---|---|\n`;
      for (const p of allPatients) {
        s += `| ${fix(p.displayName || '')} | ${p.primaryPhone || ''} | ${p.lifecycleStatus || ''} | ${fix(p.currentStepLabel || '')} | ${(p.lastActivityAt || '').slice(0, 10)} |\n`;
      }
      s += `\n_Source: \`study-WC45276/raw/*.txt\` (paginated patient payloads)._\n`;
    } else {
      s += `_See \`raw/132.txt\` and rendered \`01-study-info.txt\` for patient rows._\n`;
    }
  }
  return s;
}

function sectionRecruiters() {
  return `## 8. Recruiters\n\n- [Recruiter Name] — [recruiter@example.com] — role: Study_admin — Calendar: Connected (1 assigned)\n`;
}

function build(redacted) {
  return [
    header(redacted),
    sectionOverview(),
    sectionDocuments(),
    sectionKnowledgeBank(),
    sectionCriteria(),
    sectionQuestions(),
    sectionFlow(),
    sectionPatients(redacted),
    sectionRecruiters(),
  ].join('\n');
}

// ---- markdown + html writers ----
import { marked } from 'marked';
marked.setOptions({ gfm: true });
const htmlWrap = (title, body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body{font:15px/1.55 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:1000px;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
  h1,h2,h3{line-height:1.25} h2{border-bottom:2px solid #eee;padding-bottom:.3rem;margin-top:2rem}
  table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:13px}
  th,td{border:1px solid #ddd;padding:6px 9px;text-align:left;vertical-align:top}
  th{background:#f5f7fa} tr:nth-child(even){background:#fafbfc}
  code{background:#f0f2f4;padding:1px 5px;border-radius:3px;font-size:.9em}
  blockquote{border-left:4px solid #cbd5e1;margin:1rem 0;padding:.4rem 1rem;background:#f8fafc;color:#475569}
</style></head><body>
${body}
</body></html>`;

function writePair(base, md, title) {
  fs.writeFileSync(base + '.md', md);
  fs.writeFileSync(base + '.html', htmlWrap(title, marked.parse(md)));
}
writePair('STUDY-WC45276-FULL', build(false), 'Study WC45276 — Full Configuration');
writePair('STUDY-WC45276-REDACTED', build(true), 'Study WC45276 — Redacted Configuration');
console.log('wrote STUDY-WC45276-FULL.{md,html} and STUDY-WC45276-REDACTED.{md,html}');
console.log('parsed: flow keys=', Object.keys(flow).length,
  '| questions=', (flow.screeningQuestions||[]).length,
  '| inc=', (flow.inclusionCriteria||[]).length,
  '| exc=', (flow.exclusionCriteria||[]).length,
  '| nodes=', (flow.nodes||[]).length,
  '| patient buckets=', buckets.length);
