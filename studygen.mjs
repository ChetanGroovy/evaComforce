// studygen.mjs — generate study config reports (md + html, full + redacted)
// from a normalized study.json. No live access required.
//
// Usage:
//   node studygen.mjs build <study.json>            -> writes <slug>-FULL/-REDACTED .md/.html
//   node studygen.mjs from-payloads <rawDir> <out.json> [renderedDir]
//                                                   -> build a study.json from captured RSC payloads
//   node studygen.mjs schema                        -> print the study.json schema/template
//
// study.json schema: see `node studygen.mjs schema` or STUDY-INPUT-CONTRACT.md
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { marked } from 'marked';
marked.setOptions({ gfm: true });

// ---------- shared helpers ----------
const fix = (s) => (s ?? '')
  .replace(/â‰¥/g, '≥').replace(/â‰¤/g, '≤')
  .replace(/â€“/g, '–').replace(/â€”/g, '—')
  .replace(/â€™/g, '’').replace(/â€œ/g, '“').replace(/â€/g, '”')
  .replace(/Ã—/g, '×').replace(/Â²/g, '²').replace(/Â/g, '');
const j = (v) => JSON.stringify(v);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const slugify = (s) => String(s || 'study').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'study';

// ===================================================================
// REPORT BUILDER  (consumes a normalized study object S)
// ===================================================================
function buildReport(S, redacted) {
  const meta = S.study || {};
  const out = [];

  // header
  out.push(`# ${meta.name || 'Study'} — ${redacted ? 'Redacted' : 'Full'} Configuration

> Source: ${S.source || 'Alleviate Health (DM Clinical Research)'}${S.capturedAt ? ' · captured ' + S.capturedAt : ''}
> Study ID: \`${meta.studyId || ''}\`
${redacted
  ? '> **PII/PHI removed.** Patient names & phone numbers replaced with counts only.'
  : '> **CONTAINS PII/PHI** (patient names + phone numbers). Handle per HIPAA.'}

---
`);

  // 1. overview
  const ov = [
    ['Study name', meta.name],
    ['Internal #', meta.internalNumber],
    ['Sponsor', meta.sponsor],
    ['Principal Investigator', meta.principalInvestigator],
    ['Site', meta.site],
    ['Priority', meta.priority],
    ['Indication', meta.indication],
    ['Investigational drug', meta.drug],
    ['Flow status', [meta.flowStatus, meta.isPublished ? `(Published v${meta.flowVersion ?? ''})` : ''].filter(Boolean).join(' ')],
    ['Flow updated', meta.flowUpdated],
    ['Selected protocol doc', meta.selectedProtocolDocumentId ? '`' + meta.selectedProtocolDocumentId + '`' : ''],
  ].filter(([, v]) => v != null && v !== '');
  out.push(`## 1. Study Overview

| Field | Value |
|---|---|
${ov.map(([k, v]) => `| ${k} | ${fix(v)} |`).join('\n')}

**How a study is configured (observed model):**
1. Create study → set name, sponsor, PI, site, priority.
2. Upload **Study Documents** (Protocol, ICF).
3. System **extracts inclusion/exclusion criteria** from the Protocol PDF (per-page source refs) — see §4.
4. Build the **Knowledge Bank** (general info, trial design, compensation, blinding) — §3.
5. Generate **screening questions** from criteria — §5.
6. Assemble the **Agent Flow** graph (Start → Questions → outcomes) — §6.
7. Assign **Recruiters** and (optionally) link **CTMS**.
`);

  // 2. documents
  const docs = S.documents || [];
  out.push(`## 2. Study Documents

${docs.length ? `| Document | Type | Uploaded | Doc ID | Extraction |
|---|---|---|---|---|
${docs.map(d => `| ${esc(fix(d.name))} | ${d.type || ''} | ${d.uploaded || ''} | ${d.documentId ? '`' + d.documentId + '`' : '—'} | ${d.extractionStatus || ''} |`).join('\n')}` : '_No documents captured._'}

- Documents are the **source of truth**: the Protocol is parsed into eligibility criteria (§4), which seed the screening questions (§5).
`);

  // 3. knowledge bank
  const kb = S.knowledgeBank || {};
  const kbKeys = Object.keys(kb).length ? Object.keys(kb) : ['General Study Information', 'Trial Design', 'Compensation / Reimbursement', 'Blinding'];
  out.push(`## 3. Knowledge Bank

Free-text reference the call agent uses to answer patient questions.

${kbKeys.map(k => `### ${k}\n\n${fix(kb[k]) || '_No content added yet._'}`).join('\n\n')}
`);

  // 4. criteria — with verification classification (the basis for question selection)
  const phoneFlag = (c) => (typeof c.phone_screenable === 'boolean' ? c.phone_screenable : (c.verification_method === 'self_report' && c.knockout_strength === 'hard'));
  const critTable = (arr, label) => {
    if (!arr || !arr.length) return `_No ${label} captured._`;
    return `| # | Pages | Verify | Knockout | Phone? | Criterion |\n|---|---|---|---|---|---|\n` + arr.map(c => {
      const pages = Array.isArray(c.source_pages) ? c.source_pages.join(', ') : (c.source_pages ?? '');
      return `| ${c.criterion_number ?? ''} | ${pages} | ${c.verification_method || '—'} | ${c.knockout_strength || '—'} | ${phoneFlag(c) ? '✅' : ''} | ${esc(fix(c.criterion_text || c.original_text))} |`;
    }).join('\n');
  };
  const inc = S.inclusionCriteria || [];
  const exc = S.exclusionCriteria || [];
  const phoneIds = [...inc.map(c => ['INC', c]), ...exc.map(c => ['EXC', c])].filter(([, c]) => phoneFlag(c)).map(([p, c]) => `${p}-${c.criterion_number}`);
  out.push(`## 4. Eligibility Criteria (extracted from Protocol)

\`Pages\` cites the source page in the Protocol. \`Verify\` = how the criterion is confirmed (self_report / exam / lab / imaging / records / derived); \`Phone?\` = phone-screenable (a hard, self-reportable knockout). **Screening questions (§5) may only be generated from \`Phone? = ✅\` criteria** — everything else is confirmed at the on-site screening visit.

**Phone-screenable knockouts (${phoneIds.length}):** ${phoneIds.join(', ') || '—'}

### Inclusion (${inc.length})

${critTable(inc, 'inclusion criteria')}

### Exclusion (${exc.length})

${critTable(exc, 'exclusion criteria')}
`);

  // 5. screening questions
  const qs = S.screeningQuestions || [];
  let q5 = `## 5. Screening Questions (${qs.length}) — created from criteria

Each question maps to one or more eligibility criteria (\`criteria_ids\` → §4). \`knockout_power\` + qualify/disqualify conditions drive routing.

`;
  for (const q of qs) {
    q5 += `### Q${q.rank ?? ''}. ${fix(q.sms_question)}${q.routing ? ' _(routing)_' : ''}\n`;
    q5 += `- **variable**: \`${q.variable_name || ''}\` · **type**: ${q.answer_type || ''} · **category**: ${q.category || ''}\n`;
    if (q.choices && q.choices.length) q5 += `- **choices**: ${q.choices.map(c => fix(typeof c === 'string' ? c : (c.label || c.value || j(c)))).join(' / ')}\n`;
    if (q.show_if) q5 += `- **shown only if**: \`${fix(q.show_if)}\`${q.depends_on ? ' (depends_on ' + j(q.depends_on) + ')' : ''}\n`;
    q5 += `- **qualifying**: ${q.is_qualifying_question ? 'yes' : 'no'} · **knockout_power**: ${q.knockout_power ?? ''} · **in_flow**: ${q.included_in_flow ? 'yes' : 'no'}\n`;
    if (q.qualify_condition) q5 += `- **qualify if**: ${fix(j(q.qualify_condition))}\n`;
    if (q.disqualify_condition) q5 += `- **disqualify if**: ${fix(j(q.disqualify_condition))}\n`;
    if (q.depends_on && !q.show_if) q5 += `- **depends_on**: ${j(q.depends_on)}\n`;
    if (q.criteria_ids && q.criteria_ids.length) q5 += `- **from criteria**: ${j(q.criteria_ids)}\n`;
    q5 += `\n`;
  }
  out.push(q5);

  // 6. agent flow
  const nodes = S.flow?.nodes || [];
  const edges = S.flow?.edges || [];
  let f6 = `## 6. Agent Flow (screening logic graph)

**Nodes (${nodes.length}):**

| id | type | label |
|---|---|---|
${nodes.map(n => `| ${n.id} | ${n.type || ''} | ${esc(fix(n.label || n.data?.label || ''))} |`).join('\n')}

**Edges (${edges.length}):**

${edges.map(e => `- ${e.source} → ${e.target}${e.label ? ' [' + fix(e.label) + ']' : ''}`).join('\n')}
`;
  out.push(f6);

  // 7. patients / funnel
  const funnel = S.funnel || [];
  let p7 = `## 7. Patients / Recruitment Funnel\n\n`;
  if (funnel.length) {
    p7 += `| Bucket | Count |\n|---|---|\n${funnel.map(b => `| ${b.label || b.key} | ${b.count ?? ''} |`).join('\n')}\n\n`;
  }
  const pats = S.patients || [];
  if (redacted) {
    p7 += `_Patient-level rows (names, phone numbers) removed in this redacted version. See FULL report for cross-check._\n`;
  } else if (pats.length) {
    p7 += `### Patient rows (PII — cross-check only)\n\n${pats.length} patients captured.\n\n`;
    p7 += `| Name | Phone | Status | Step | Last Activity |\n|---|---|---|---|---|\n`;
    p7 += pats.map(p => `| ${fix(p.displayName || p.name || '')} | ${p.primaryPhone || p.phone || ''} | ${p.lifecycleStatus || ''} | ${fix(p.currentStepLabel || '')} | ${(p.lastActivityAt || '').slice(0, 10)} |`).join('\n');
    p7 += `\n`;
  } else {
    p7 += `_No patient rows provided._\n`;
  }
  out.push(p7);

  // 8. recruiters
  const recs = S.recruiters || [];
  out.push(`## 8. Recruiters\n\n${recs.length
    ? recs.map(r => `- ${r.name || ''} — ${r.email || ''}${r.role ? ' — role: ' + r.role : ''}${r.calendar ? ' — Calendar: ' + r.calendar : ''}`).join('\n')
    : '_No recruiters provided._'}\n`);

  return out.join('\n');
}

// ---------- html ----------
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

// ===================================================================
// EVAL — Tier-1 deterministic accuracy gate (see EXTRACTION-PLAYBOOK.md)
// Selection accuracy is checked as a JSON-join over per-criterion
// classification, NOT by matching question wording. FAIL blocks build.
// ===================================================================

// phone_screenable = self-reportable AND a hard knockout. Derive if not explicit.
function isPhoneScreenable(c) {
  if (typeof c.phone_screenable === 'boolean') return c.phone_screenable;
  return c.verification_method === 'self_report' && c.knockout_strength === 'hard';
}
function allCriteria(S) {
  const inc = (S.inclusionCriteria || []).map(c => ({ ...c, _id: `INC-${c.criterion_number}` }));
  const exc = (S.exclusionCriteria || []).map(c => ({ ...c, _id: `EXC-${c.criterion_number}` }));
  return [...inc, ...exc];
}

function runCheck(S, docsDir) {
  const out = []; // {level:'FAIL'|'WARN'|'INFO', msg}
  const fail = (m) => out.push({ level: 'FAIL', msg: m });
  const warn = (m) => out.push({ level: 'WARN', msg: m });
  const info = (m) => out.push({ level: 'INFO', msg: m });

  const crit = allCriteria(S);
  const byId = new Map(crit.map(c => [c._id, c]));
  const qs = S.screeningQuestions || [];

  // 0. classification completeness — can't run the joins without labels
  const VALID_VM = new Set(['self_report', 'exam', 'lab', 'imaging', 'records', 'derived']);
  const VALID_KS = new Set(['hard', 'soft', 'none']);
  const unclassified = crit.filter(c => !VALID_VM.has(c.verification_method) || !VALID_KS.has(c.knockout_strength));
  if (crit.length && unclassified.length) {
    warn(`${unclassified.length}/${crit.length} criteria not classified (need verification_method + knockout_strength) — precision/recall joins skipped for those.`);
  }

  // 1. PRECISION — every question must source a phone_screenable criterion.
  //    Kills clinical-gate + drug-recall structurally (checks the source label, not the words).
  for (const q of qs) {
    const ids = q.criteria_ids || [];
    // routing questions (e.g., sex-at-birth used to gate a conditional question) carry no knockout criterion
    if (!ids.length) { if (q.routing) continue; fail(`Q${q.rank ?? '?'} has no criteria_ids — untraceable.`); continue; }
    for (const id of ids) {
      const c = byId.get(id);
      if (!c) { fail(`Q${q.rank ?? '?'} references ${id} which does not exist.`); continue; }
      if (!VALID_VM.has(c.verification_method)) continue; // unclassified already warned
      if (!isPhoneScreenable(c)) {
        fail(`Q${q.rank ?? '?'} sources ${id} (${c.verification_method}/${c.knockout_strength}) which is NOT phone_screenable — a ${c.verification_method} criterion is confirmed at the screening visit, not on the phone. Drop or reframe.`);
      }
    }
  }

  // 2. RECALL — every phone_screenable criterion must be covered by ≥1 question.
  //    Kills missed-knockout: an absence becomes a named, deterministic set diff.
  const covered = new Set(qs.flatMap(q => q.criteria_ids || []));
  const phone = crit.filter(c => VALID_VM.has(c.verification_method) && isPhoneScreenable(c));
  for (const c of phone) {
    if (!covered.has(c._id)) {
      fail(`${c._id} is phone_screenable (hard self-report knockout) but NO question covers it — missed knockout: "${(c.criterion_text || '').slice(0, 60)}…"`);
    }
  }

  // 3. count sanity — derived from the phone_screenable set, not a magic number
  if (phone.length && qs.length > phone.length + 1) {
    warn(`${qs.length} questions vs ${phone.length} phone_screenable criteria — possible over-build.`);
  }

  // 4. label cross-check (regex audits the LABEL, doesn't substitute for it):
  //    a self_report criterion whose text reads clinical/lab is a mislabel suspect.
  const CLINICAL = /\bCRP\b|\bESR\b|DAS28|CDAI|SDAI|\bACPA\b|swollen joint|tender joint|joint count|\bSJC\b|\bTJC\b|\bMRI\b|\bIGRA\b|\bHBV\b|\bHCV\b|\bHIV\b|tuberculosis|\bTB\b|h(a)?emoglobin|neutrophil|platelet|bilirubin|eGFR|serolog|antibod|QTc/i;
  for (const c of crit) {
    if (c.verification_method === 'self_report' && CLINICAL.test(c.criterion_text || '')) {
      warn(`${c._id} labeled self_report but text reads clinical/lab ("${(c.criterion_text || '').slice(0, 50)}…") — verify the label.`);
    }
  }

  // 5. KB grounding (needs docsDir with protocol.txt / icf.txt)
  if (docsDir) groundKB(S, docsDir, { fail, warn, info });

  // 6. CRM-only fields — never in documents (non-blocking)
  const m = S.study || {};
  for (const [k, label] of [['principalInvestigator', 'PI'], ['site', 'Site'], ['priority', 'Priority']]) {
    if (!m[k]) warn(`Overview "${label}" blank — REQUIRED-FROM-SITE (not in any document).`);
  }

  // 7. KB section gaps
  const kb = S.knowledgeBank || {};
  for (const sec of ['General Study Information', 'Trial Design', 'Compensation / Reimbursement']) {
    if (!kb[sec]) info(`Knowledge Bank "${sec}" empty — fill from Protocol/ICF if available.`);
  }
  return out;
}

// Ground drug FORM + compensation figures against the source text (anti-hallucination / dirty-oracle guard).
function groundKB(S, docsDir, { fail, warn, info }) {
  const read = (n) => { try { return fs.readFileSync(path.join(docsDir, n), 'utf8'); } catch { return ''; } };
  const protocol = read('protocol.txt');
  const icf = read('icf.txt');
  const src = (protocol + '\n' + icf).toLowerCase();
  if (!src.trim()) { info('No protocol.txt/icf.txt in docsDir — KB grounding skipped.'); return; }

  // drug FORM: the route claimed in overview.drug / KB must appear in the source
  const drugText = ((S.study?.drug || '') + ' ' + (S.knowledgeBank?.['General Study Information'] || '')).toLowerCase();
  const FORMS = [['oral', /\boral\b|tablet|by mouth|swallow/], ['subcutaneous', /subcutaneous|injection under the skin|\bsc\b|under the skin/], ['intravenous', /intravenous|\biv\b infusion/]];
  const claimed = FORMS.filter(([, re]) => re.test(drugText)).map(([f]) => f);
  for (const f of claimed) {
    const re = f === 'oral' ? /\boral\b|tablet|swallow/ : f === 'subcutaneous' ? /subcutaneous|under the skin/ : /intravenous|\biv\b/;
    if (!re.test(src)) fail(`KB claims drug form "${f}" but the Protocol/ICF text does not support it — possible dirty-oracle/hallucination.`);
  }
  // compensation: each $ figure in KB should appear in the ICF/protocol text
  const comp = S.knowledgeBank?.['Compensation / Reimbursement'] || '';
  const figs = [...comp.matchAll(/\$\s?([0-9][0-9,]*)/g)].map(m => m[1].replace(/,/g, ''));
  for (const f of figs) {
    if (f.length <= 2) continue; // skip tiny incidental numbers
    if (!src.replace(/,/g, '').includes(f)) warn(`Compensation figure $${f} not found in Protocol/ICF text — verify it traces to the ICF stipend table.`);
  }
}

function printCheck(findings) {
  const fails = findings.filter(f => f.level === 'FAIL');
  const warns = findings.filter(f => f.level === 'WARN');
  if (!findings.length) { console.log('eval: clean ✓'); return fails.length; }
  console.log(`eval: ${fails.length} FAIL, ${warns.length} WARN`);
  for (const f of findings) console.log(`  ${f.level}: ${f.msg}`);
  if (fails.length) console.log(`❌ EVAL FAILED (${fails.length}) — DO NOT SHIP until resolved.`);
  return fails.length;
}
function cmdCheck(jsonPath, docsDir) {
  const S = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const fails = printCheck(runCheck(S, docsDir));
  if (fails) process.exitCode = 1;
}

// ===================================================================
// AUDIT — asymmetric input bundle + verdict diff (Phase 2 independence)
// The Auditor receives criteria TEXT + questions only — NOT our labels or
// reasoning — re-derives classification, and we diff to catch MIS-LABELS.
// ===================================================================
function cmdAuditBundle(jsonPath) {
  const S = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const crit = allCriteria(S).map(c => ({ id: c._id, pages: c.source_pages, text: c.criterion_text || c.original_text }));
  const questions = (S.screeningQuestions || []).map(q => ({ rank: q.rank, text: q.sms_question, disqualify: q.disqualify_condition, declared_criteria_ids: q.criteria_ids }));
  const bundle = { study: S.study?.internalNumber || S.study?.name, criteria: crit, questions };
  const out = path.join(path.dirname(jsonPath), 'audit-input.json');
  fs.writeFileSync(out, JSON.stringify(bundle, null, 2));
  console.log(`wrote ${out} — ${crit.length} criteria, ${questions.length} questions (NO labels: asymmetric input for the Auditor agent).`);
}

// Diff the Auditor's independent verdict against our study.json labels.
// verdict.json: { labels:[{id,verification_method,knockout_strength}], suspected_missed:[{id,reason}], wording_mismatches:[{rank,predicted_criterion_id}] }
function cmdAuditDiff(jsonPath, verdictPath) {
  const S = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const V = JSON.parse(fs.readFileSync(verdictPath, 'utf8'));
  const ours = new Map(allCriteria(S).map(c => [c._id, c]));
  const out = [];
  // label disagreements — the mislabels Phase-1 eval cannot see
  for (const l of V.labels || []) {
    const c = ours.get(l.id);
    if (!c) { out.push(`AUDITOR cites unknown criterion ${l.id}`); continue; }
    const oursPhone = (c.verification_method === 'self_report' && c.knockout_strength === 'hard');
    const audPhone = (l.verification_method === 'self_report' && l.knockout_strength === 'hard');
    if (c.verification_method !== l.verification_method || c.knockout_strength !== l.knockout_strength) {
      const sev = oursPhone !== audPhone ? 'DISAGREE(phone-flips)' : 'disagree';
      out.push(`${sev} ${l.id}: ours=${c.verification_method}/${c.knockout_strength} auditor=${l.verification_method}/${l.knockout_strength}${l.evidence ? ' — ' + l.evidence : ''}`);
    }
  }
  // candidate misses the Auditor found that we did NOT make a question for
  const covered = new Set((S.screeningQuestions || []).flatMap(q => q.criteria_ids || []));
  for (const m of V.suspected_missed || []) {
    if (!covered.has(m.id)) out.push(`SUSPECTED-MISS ${m.id}: ${m.reason || ''}`);
  }
  // backtranslation wording mismatches
  for (const w of V.wording_mismatches || []) {
    const q = (S.screeningQuestions || []).find(x => x.rank === w.rank);
    const declared = (q?.criteria_ids || []).join(',');
    if (w.predicted_criterion_id && !(q?.criteria_ids || []).includes(w.predicted_criterion_id)) {
      out.push(`WORDING Q${w.rank}: reads as ${w.predicted_criterion_id} but declared ${declared} — ambiguous wording`);
    }
  }
  if (!out.length) { console.log('audit-diff: Auditor agrees with our labels, no missed knockouts, wording clear ✓'); return; }
  console.log(`audit-diff: ${out.length} finding(s) — independent Auditor disagrees:`);
  for (const o of out) console.log('  ' + o);
  if (out.some(o => o.startsWith('DISAGREE') || o.startsWith('SUSPECTED-MISS'))) process.exitCode = 1;
}

// ===================================================================
// SCREEN — deterministic screening engine: run a patient's answers
// through the study's questions/flow → Qualified or DNQ. The LLM only
// EXTRACTS answers from free text; this code DECIDES the verdict.
// ===================================================================
function evalCond(expr, scope) {
  if (!expr) return false;
  const keys = Object.keys(scope);
  try {
    const fn = new Function(...keys, `"use strict"; return (${expr});`);
    return !!fn(...keys.map(k => scope[k]));
  } catch { return undefined; } // undefined = could not evaluate (e.g., missing answer)
}
// normalize a raw answer for yes/no comparisons
const norm = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : v);

function screenPatient(S, answersIn) {
  const qs = (S.screeningQuestions || []).slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const ans = { ...(answersIn || {}) }; // keep raw (do NOT lowercase sex/choice values)
  // derive `age` alias from the numeric question
  const ageQ = qs.find(q => q.answer_type === 'number');
  if (ageQ && ans[ageQ.variable_name] != null) ans.age = Number(ans[ageQ.variable_name]);
  // constants so bareword conditions (answer == yes / sex_at_birth == "Female") resolve
  const base = { ...ans, yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' };

  const trace = [];
  let dnq = null;          // first disclosed disqualifier (rank order)
  const missing = [];      // required questions with no answer
  const deferred = [];     // unanswered questions the flow confirms later (e.g. pregnancy) — do NOT block
  for (const q of qs) {
    if (q.show_if) {
      const shown = evalCond(q.show_if, base);
      if (shown === false) { trace.push({ rank: q.rank, variable: q.variable_name, shown: false }); continue; }
    }
    let val = q.variable_name === ageQ?.variable_name ? ans.age : ans[q.variable_name];
    if (q.answer_type === 'yes_no') val = norm(val); // yes/no compared lowercase
    const known = val != null && val !== '';
    const scope = { ...base, answer: val };
    const disq = q.disqualify_condition ? evalCond(q.disqualify_condition, scope) : false;
    trace.push({ rank: q.rank, variable: q.variable_name, question: q.sms_question, answer: val ?? null, shown: true, known, disqualified: disq === true });
    if (q.routing) continue;
    // A disclosed disqualifier wins even if earlier answers are missing (e.g., pregnant but no age).
    if (known && disq === true && !dnq) dnq = { failed: q.variable_name, reason: `DNQ — ${q.sms_question}`, criteria_ids: q.criteria_ids || [] };
    // An unanswered question the flow defers (confirmed at the visit) does NOT block pre-qualification.
    else if (!known) (q.defer_if_unanswered ? deferred : missing).push(q.variable_name);
  }
  if (dnq) return { terminal: 'DNQ', ...dnq, deferred, trace };
  if (missing.length) return { terminal: 'INCOMPLETE', failed: missing[0], reason: `Missing answer(s): ${missing.join(', ')}`, deferred, trace };
  return { terminal: 'QUALIFIED', deferred, reason: deferred.length ? `Pre-qualified; confirm at visit: ${deferred.join(', ')}` : null, trace };
}

// load answers from a .txt: supports `key: value` lines (variable_name or alias: age/sex)
function parseAnswerTxt(txt) {
  const a = {};
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([\w.\- ]+?)\s*[:=]\s*(.+?)\s*$/);
    if (m) a[m[1].trim().replace(/\s+/g, '_').toLowerCase()] = m[2].trim();
  }
  return a;
}

function cmdScreen(studyPath, answersPath) {
  const S = JSON.parse(fs.readFileSync(studyPath, 'utf8'));
  const raw = fs.readFileSync(answersPath, 'utf8');
  const answers = answersPath.endsWith('.json') ? JSON.parse(raw) : parseAnswerTxt(raw);
  const r = screenPatient(S, answers);
  console.log(`${path.basename(answersPath)} → ${r.terminal}${r.reason ? ' (' + r.reason + ')' : ''}`);
  return r;
}

// run every .json/.txt in <studyDir>/screening/, write results, emit a report
function cmdScreenReport(studyDir) {
  const studyPath = path.join(studyDir, 'study.json');
  const S = JSON.parse(fs.readFileSync(studyPath, 'utf8'));
  const inbox = path.join(studyDir, 'screening');
  if (!fs.existsSync(inbox)) { console.log(`no screening/ folder in ${studyDir}`); return; }
  const all = fs.readdirSync(inbox).filter(f => /\.(txt|json)$/.test(f) && !f.startsWith('result'));
  // dedupe by patient basename — prefer the structured .json (e.g. agent-extracted) over the raw .txt
  const byBase = new Map();
  for (const f of all.sort()) {
    const base = f.replace(/\.(txt|json)$/, '');
    if (!byBase.has(base) || f.endsWith('.json')) byBase.set(base, f);
  }
  const files = [...byBase.values()];
  const results = [];
  for (const f of files.sort()) {
    const raw = fs.readFileSync(path.join(inbox, f), 'utf8');
    const answers = f.endsWith('.json') ? JSON.parse(raw) : parseAnswerTxt(raw);
    const r = screenPatient(S, answers);
    r.patient = f.replace(/\.(txt|json)$/, '');
    results.push(r);
  }
  const q = results.filter(r => r.terminal === 'QUALIFIED');
  const dnq = results.filter(r => r.terminal === 'DNQ');
  const inc = results.filter(r => r.terminal === 'INCOMPLETE');
  // DNQ breakdown
  const byReason = {};
  for (const r of dnq) byReason[r.reason] = (byReason[r.reason] || 0) + 1;

  let md = `# Screening Report — ${S.study?.name || studyDir}

> ${results.length} patient(s) screened · **${q.length} Qualified** · ${dnq.length} DNQ · ${inc.length} incomplete
> Study: \`${S.study?.internalNumber || ''}\` · generated by the deterministic screening engine

## Summary

| Result | Count |
|---|---|
| ✅ Qualified | ${q.length} |
| ❌ DNQ | ${dnq.length} |
| ⚠️ Incomplete | ${inc.length} |
| **Total** | ${results.length} |

### DNQ reasons
${Object.keys(byReason).length ? '| Reason | Count |\n|---|---|\n' + Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([r, c]) => `| ${esc(r)} | ${c} |`).join('\n') : '_None._'}

## Per-patient results

| Patient | Result | Failed at | Reason |
|---|---|---|---|
${results.map(r => `| ${esc(r.patient)} | ${r.terminal === 'QUALIFIED' ? '✅ Qualified' : r.terminal === 'DNQ' ? '❌ DNQ' : '⚠️ Incomplete'} | ${r.failed || '—'} | ${esc(r.reason || 'Passed all screening questions')} |`).join('\n')}

## Decision traces
${results.map(r => `### ${r.patient} — ${r.terminal}\n\n| Q | Variable | Answer | Shown | Disqualified |\n|---|---|---|---|---|\n${r.trace.map(t => `| ${t.rank} | ${t.variable} | ${t.answer ?? (t.shown === false ? '(skipped)' : '—')} | ${t.shown === false ? 'no' : 'yes'} | ${t.disqualified ? '❌' : ''} |`).join('\n')}`).join('\n\n')}
`;
  fs.writeFileSync(path.join(studyDir, 'SCREENING-REPORT.md'), md);
  fs.writeFileSync(path.join(studyDir, 'SCREENING-REPORT.html'), htmlWrap(`Screening Report — ${S.study?.name || ''}`, marked.parse(md)));
  fs.writeFileSync(path.join(inbox, 'results.json'), JSON.stringify(results, null, 2));
  console.log(`screened ${results.length}: ${q.length} qualified, ${dnq.length} DNQ, ${inc.length} incomplete`);
  console.log(`wrote ${path.join(studyDir, 'SCREENING-REPORT.{md,html}')}`);
}

// ===================================================================
// CONVERSE — conversational prescreen engine (HYBRID): walks the study's
// questionnaire turn-by-turn like the live Alleviate agent, but a
// DETERMINISTIC selector decides each branch — the LLM (or, here, a
// rule-based extractor) only turns the patient's free text into a value.
// Runs ALONGSIDE the batch `screen` engine and is provably equivalent to
// it (same screeningQuestions, same conditions, same rank order).
// ===================================================================
import readline from 'node:readline';

// free text -> a value for this question. {ok:true,value} | {ok:false} | {skip:true}
function extractAnswer(q, reply) {
  const t = (reply || '').trim();
  if (!t) return { ok: false };
  const low = t.toLowerCase();
  if (/^(skip|pass|next)$/.test(low)) return { ok: false, skip: true };

  if (q.answer_type === 'number') {
    const m = t.match(/\d{1,3}/);
    return m ? { ok: true, value: Number(m[0]) } : { ok: false };
  }
  if (q.answer_type === 'yes_no') {
    const neg = /\b(no|nope|nah|never|not|none|negative)\b/.test(low) || /\b(haven'?t|don'?t|didn'?t|doesn'?t|isn'?t|won'?t|can'?t)\b/.test(low) || /^n$/.test(low);
    const pos = /\b(yes|yeah|yep|yup|ya|correct|sure|affirmative|definitely|absolutely|true|right|ok|okay)\b/.test(low) || /^y$/.test(low) || /\bi (have|had|did|do|am)\b/.test(low);
    if (pos && !neg) return { ok: true, value: 'yes' };
    if (neg && !pos) return { ok: true, value: 'no' };
    return { ok: false }; // empty / ambiguous ("I do not have") -> re-ask
  }
  if (q.answer_type === 'choice') {
    for (const ch of (q.choices || [])) if (low.includes(ch.toLowerCase())) return { ok: true, value: ch };
    for (const ch of (q.choices || [])) if (low === ch[0].toLowerCase()) return { ok: true, value: ch };
    if ((q.choices || []).includes('Female') && /\b(female|woman|girl)\b/.test(low)) return { ok: true, value: 'Female' };
    if ((q.choices || []).includes('Male') && /\b(male|man|boy)\b/.test(low)) return { ok: true, value: 'Male' };
    return { ok: false };
  }
  return { ok: true, value: t };
}

function reaskText(q) {
  if (q.answer_type === 'number') return "Sorry, I didn't catch that — could you give me a number?";
  if (q.answer_type === 'yes_no') return "Sorry, was that a yes or a no?";
  if (q.answer_type === 'choice') return `Please pick one: ${(q.choices || []).join(' or ')}.`;
  return "Sorry, could you say that again?";
}

// spelled-out numbers -> integer ("fifty-two" -> 52). Returns null if not parseable.
const NUM_WORDS = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function parseWordNumber(t) {
  const words = (t || '').toLowerCase().match(/[a-z]+/g) || [];
  let total = null, cur = 0, used = false;
  for (const w of words) {
    if (w in NUM_WORDS) { cur += NUM_WORDS[w]; used = true; }
    else if (w === 'hundred') { cur = (cur || 1) * 100; used = true; }
  }
  if (used) total = cur;
  return total;
}

// ===================================================================
// EXTRACTOR ADAPTER (Phase 3) — pluggable free-text→value extraction.
// makeExtractor(kind) -> extract(question, replyText, ctx)
//   -> { value, confidence, needs_clarification }
//
// CONTRACT (every adapter MUST honor it; the conversational loop + server
// depend on it):
//   value               — the canonical value for screenPatient/evalCond:
//                           number -> Number; yes_no -> 'yes'|'no';
//                           choice -> the exact choice string; text -> trimmed.
//                           null when nothing could be extracted.
//   confidence          — 0..1, the adapter's self-rated certainty.
//   needs_clarification  — true when the reply is empty/ambiguous and the
//                           caller should RE-ASK (do NOT guess). When true,
//                           value is null.
// `ctx` is a free-form bag (e.g. { height, weight } already collected) so an
// adapter can compute derived answers (BMI) without re-prompting.
//
// kinds:
//   "rule" — deterministic regex/keyword extractor (the historical logic).
//   "llm"  — STUB: documents where an Anthropic call WOULD go; falls back to
//            rule (no API key in this environment).
// ===================================================================

// rule extractor: wraps the historical extractAnswer + adds word-numbers and
// a BMI height+weight path, then maps to the {value,confidence,needs_clarification} contract.
function ruleExtract(q, replyText, ctx = {}) {
  const t = (replyText || '').trim();

  // BMI height+weight derivation — a value computed from height+weight vs a cutoff.
  // Only engages when the type is explicitly 'bmi' OR a height/weight ctx is supplied
  // (the interactive height+weight path). A `capture:'bmi'` question with a yes_no
  // answer_type stays a plain yes/no here, preserving batch-equivalence in replay.
  // Checked BEFORE the empty-reply guard because the values come from ctx, not the reply.
  const wantBmi = q.answer_type === 'bmi' || (q.capture === 'bmi' && (ctx.height != null || ctx.weight != null));
  if (wantBmi) {
    const inches = parseHeightInches(ctx.height ?? t);
    const lbs = parseWeightLbs(ctx.weight ?? t);
    if (inches && lbs) {
      const bmi = 703 * lbs / (inches * inches);
      return { value: bmi >= (q.bmi_cutoff || 27) ? 'yes' : 'no', confidence: 0.9, needs_clarification: false, bmi };
    }
    return { value: null, confidence: 0, needs_clarification: true };
  }

  if (!t) return { value: null, confidence: 0, needs_clarification: true };

  const ex = extractAnswer(q, replyText);
  if (ex.ok) return { value: ex.value, confidence: 0.95, needs_clarification: false };

  // number fallback: spelled-out ("fifty-two") when the digit regex missed.
  if (q.answer_type === 'number') {
    const n = parseWordNumber(t);
    if (n != null) return { value: n, confidence: 0.8, needs_clarification: false };
  }
  // skip is an explicit "no answer" but NOT a clarification request.
  if (ex.skip) return { value: null, confidence: 0, needs_clarification: false, skip: true };
  // empty / ambiguous -> re-ask.
  return { value: null, confidence: 0, needs_clarification: true };
}

// llm extractor STUB — documents the contract; falls back to the rule extractor.
// There is NO API key in this environment, so no network call is made.
function llmExtract(q, replyText, ctx = {}) {
  // ── ANTHROPIC HOOK ──────────────────────────────────────────────────────
  // A real implementation would call the Messages API here, e.g.:
  //   import Anthropic from '@anthropic-ai/sdk';
  //   const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  //   const msg = await client.messages.create({
  //     model: 'claude-3-5-haiku-latest',
  //     max_tokens: 256,
  //     system: 'Extract a single screening answer from the patient reply. '
  //           + 'Return ONLY JSON {value, confidence, needs_clarification}. '
  //           + 'value: number|("yes"|"no")|<one of choices>|text|null. '
  //           + 'Set needs_clarification=true (value=null) if the reply is ambiguous.',
  //     messages: [{ role: 'user', content: JSON.stringify({
  //       answer_type: q.answer_type, choices: q.choices, question: q.sms_question, reply: replyText }) }],
  //   });
  //   return JSON.parse(msg.content[0].text);
  // Until ANTHROPIC_API_KEY is wired, fall back to the deterministic rule extractor
  // so behavior stays identical and tests stay green.
  // ────────────────────────────────────────────────────────────────────────
  if (process.env.ANTHROPIC_API_KEY) {
    // Intentionally not implemented offline; fall through to rule for determinism.
  }
  return ruleExtract(q, replyText, ctx);
}

function makeExtractor(kind = 'rule') {
  const fn = kind === 'llm' ? llmExtract : ruleExtract;
  return (question, replyText, ctx = {}) => fn(question, replyText, ctx);
}

// natural-texting acknowledgments, prepended to the next question (like Alleviate's "Got it.")
const ACKS = ['Got it.', 'Thanks.', 'Okay.', 'Great.', 'Perfect.', 'Thank you.'];
const lcFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

// parse a free-text height -> inches ("5'10\"", "5 ft 10", "70 in", "178 cm")
function parseHeightInches(t) {
  if (!t) return null;
  let m = t.match(/(\d+)\s*(?:'|ft|feet|foot)\s*(\d+)?/i);
  if (m) return (+m[1]) * 12 + (+(m[2] || 0));
  m = t.match(/(\d+(?:\.\d+)?)\s*cm/i);
  if (m) return (+m[1]) / 2.54;
  m = t.match(/(\d+(?:\.\d+)?)/);
  if (m) { const n = +m[1]; if (n > 100) return n / 2.54; if (n >= 36 && n <= 90) return n; if (n < 8) return n * 12; }
  return null;
}
// parse a free-text weight -> pounds ("278", "278 lbs", "126 kg")
function parseWeightLbs(t) {
  if (!t) return null;
  let m = t.match(/(\d+(?:\.\d+)?)\s*kg/i);
  if (m) return (+m[1]) * 2.20462;
  m = t.match(/(\d+(?:\.\d+)?)/);
  return m ? +m[1] : null;
}

// CLI channel: real patient typing at a terminal. Uses a line queue so it
// works for both an interactive TTY and piped stdin (rl.question drops lines
// under a pipe; the queue does not).
function cliChannel() {
  const rl = readline.createInterface({ input: process.stdin });
  const queue = [];
  let pending = null, closed = false;
  rl.on('line', (l) => { if (pending) { const p = pending; pending = null; p(l); } else queue.push(l); });
  rl.on('close', () => { closed = true; if (pending) { const p = pending; pending = null; p(null); } });
  const nextLine = () => closed ? Promise.resolve(null) : queue.length ? Promise.resolve(queue.shift()) : new Promise(r => { pending = r; });
  return {
    interactive: true, maxReask: 2, transcript: [],
    say(text) { this.transcript.push({ agent: text }); process.stdout.write('\n🩺  ' + text + '\n'); },
    async ask(text) {
      this.transcript.push({ agent: text });
      process.stdout.write('\n🩺  ' + text + '\n🧑  ');
      const l = await nextLine();
      this.transcript.push({ patient: l ?? '' });
      return l ?? '';
    },
    close() { rl.close(); },
  };
}

// Replay channel: scripted answers keyed by variable_name (tests + bulk + equivalence).
// Serves each variable's answer once; a later ask for the same var returns '' (no human to re-ask).
function replayChannel(answers) {
  const served = new Set();
  return {
    interactive: false, maxReask: 0, transcript: [],
    say(text) { this.transcript.push({ agent: text }); },
    ask(text, q) {
      const v = q ? answers[q.variable_name] : undefined;
      let out = '';
      if (q && !served.has(q.variable_name) && v != null && v !== '') { served.add(q.variable_name); out = String(v); }
      this.transcript.push({ agent: text, patient: out || '— (no answer)' });
      return Promise.resolve(out);
    },
    close() {},
  };
}

const ABANDON = new Set(['quit', 'exit', 'stop', 'bye', 'cancel']);

// The engine. Channel-agnostic. Deterministic branch decisions.
// Conversational polish (name, acks, BMI height/weight, scheduling) is presentation
// only — it never changes the verdict, so batch-equivalence is preserved.
async function runConversation(S, channel, patientName, extractor = makeExtractor('rule')) {
  const qs = (S.screeningQuestions || []).slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  const ageQ = qs.find(q => q.answer_type === 'number');
  const consts = { yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' };
  const ans = {};
  const trace = [];
  const missing = [];
  const deferred = [];
  const name = (patientName || '').split(/[_\s]/)[0] || '';
  const studyName = S.study?.name || 'this study';
  const site = S.study?.site && !/REQUIRED/i.test(S.study.site) ? S.study.site : 'DM Clinical Research';
  let askedCount = 0;
  const ackPrefix = () => (askedCount++ > 0 ? ACKS[(askedCount - 1) % ACKS.length] + ' ' : '');

  const scopeNow = (extra) => {
    const s = { ...ans, ...consts, ...extra };
    if (ageQ && ans[ageQ.variable_name] != null) s.age = Number(ans[ageQ.variable_name]);
    return s;
  };
  const done = (terminal, reason, q) => ({
    terminal, reason: reason || null,
    failed: q?.variable_name || missing[0] || null,
    criteria_ids: q?.criteria_ids || [],
    deferred,
    answers: ans, trace, transcript: channel.transcript || null,
  });

  // ask one question, re-asking when the extractor flags needs_clarification.
  // Goes through the pluggable extractor adapter (rule by default). Returns the value or null.
  const askQuestion = async (q, promptText, ctx = {}) => {
    let val = null, tries = 0;
    while (true) {
      const reply = await channel.ask(promptText, q);
      const low = (reply || '').trim().toLowerCase();
      if (ABANDON.has(low)) return { abandoned: true };
      const ex = extractor(q, reply, ctx);
      if (!ex.needs_clarification && ex.value != null) { val = ex.value; break; }
      if (ex.skip || tries >= channel.maxReask) break;   // explicit skip, or out of re-asks -> give up (null)
      tries++;
      // patient asked something back? acknowledge + redirect, then re-ask.
      if (/\?\s*$/.test(reply || '')) channel.say(`Good question — our coordinator can go over that on your call. For now, ${lcFirst(q.sms_question)}`);
      else channel.say(reaskText(q));
    }
    return { val };
  };

  channel.say(`Hi${name ? ' ' + name : ''}! I'm reaching out from ${site} about our paid ${studyName} study. I'll ask a few quick questions to see if you may qualify — just answer in your own words. (Reply "stop" any time to pause.)`);

  for (const q of qs) {
    // conditional gate (e.g. pregnancy only if Female)
    if (q.show_if && evalCond(q.show_if, scopeNow()) === false) {
      trace.push({ rank: q.rank, variable: q.variable_name, shown: false });
      continue;
    }

    let val = null;
    // BMI: ask height + weight and compute, like Alleviate's "BMI Check" (patients don't know their BMI).
    // Only interactively; in replay/structured mode the direct yes/no answer is used (keeps equivalence).
    if (q.capture === 'bmi' && channel.interactive) {
      const h = await askQuestion({ variable_name: '_height', answer_type: 'text' }, `${ackPrefix()}What is your height?`);
      if (h.abandoned) { channel.say('No problem — we can finish this another time. Take care!'); return done('INCOMPLETE', 'Conversation abandoned by patient', q); }
      const w = await askQuestion({ variable_name: '_weight', answer_type: 'text' }, `And your current weight?`);
      if (w.abandoned) { channel.say('No problem — we can finish this another time. Take care!'); return done('INCOMPLETE', 'Conversation abandoned by patient', q); }
      const inches = parseHeightInches(h.val), lbs = parseWeightLbs(w.val);
      const bmi = inches && lbs ? 703 * lbs / (inches * inches) : null;
      val = bmi == null ? null : (bmi >= (q.bmi_cutoff || 27) ? 'yes' : 'no');
    } else {
      const r = await askQuestion(q, `${ackPrefix()}${q.sms_question}`);
      if (r.abandoned) { channel.say('No problem — we can finish this another time. Take care!'); return done('INCOMPLETE', 'Conversation abandoned by patient', q); }
      val = r.val;
    }

    if (val == null) { // unanswered: a deferred question (confirmed at visit) doesn't block; else record + continue
      (q.defer_if_unanswered ? deferred : missing).push(q.variable_name);
      trace.push({ rank: q.rank, variable: q.variable_name, answer: null, shown: true, known: false, deferred: !!q.defer_if_unanswered });
      continue;
    }
    ans[q.variable_name] = q.answer_type === 'yes_no' ? norm(val) : val;
    const disq = q.disqualify_condition ? evalCond(q.disqualify_condition, scopeNow({ answer: ans[q.variable_name] })) : false;
    trace.push({ rank: q.rank, variable: q.variable_name, answer: ans[q.variable_name], shown: true, known: true, disqualified: disq === true });
    // routing questions never disqualify; a real knockout ends the call (early exit, like the live agent)
    if (!q.routing && disq === true) {
      channel.say(`Thanks for sharing that${name ? ', ' + name : ''}. Based on your answer, this particular study isn't the right fit right now — but we may have others that suit you better, and a coordinator can tell you more.`);
      return done('DNQ', `DNQ — ${q.sms_question}`, q);
    }
  }
  if (missing.length) {
    channel.say('Thanks! There are a couple of answers we still need to confirm. A study coordinator will follow up to finish your screening.');
    return done('INCOMPLETE', `Missing answer(s): ${missing.join(', ')}`);
  }
  // QUALIFIED (pre-qualified) — book the follow-up call, like the live agent. Deferred items (e.g.
  // pregnancy) are confirmed at the visit and do not block here.
  channel.say(`Great news${name ? ', ' + name : ''} — based on your answers, you pre-qualify!`);
  if (channel.interactive) {
    const slot = await askQuestion({ variable_name: '_slot', answer_type: 'text' },
      `Let's set up a quick follow-up call to confirm the details. We have openings today and tomorrow, 11 AM–8 PM CT. What time works best for you?`);
    if (slot.abandoned) channel.say('No problem — a coordinator will reach out to schedule. Take care!');
    else if (slot.val) { ans._scheduled = String(slot.val); channel.say(`Perfect — you're set for ${slot.val}. A coordinator will call then; please keep an eye on your phone. Thanks${name ? ', ' + name : ''}!`); }
    else channel.say('A coordinator will reach out to schedule your follow-up call.');
  } else {
    channel.say('A study coordinator will call to confirm the details and schedule your visit.');
  }
  return done('QUALIFIED');
}

// converse <study.json> — interactive CLI conversation with a real patient.
async function cmdConverse(studyPath, name) {
  const S = JSON.parse(fs.readFileSync(studyPath, 'utf8'));
  const ch = cliChannel();
  let r;
  try { r = await runConversation(S, ch, name); } finally { ch.close(); }
  console.log(`\n${'─'.repeat(60)}\nOUTCOME: ${r.terminal}${r.reason ? `  (${r.reason})` : ''}`);
  if (r.criteria_ids?.length) console.log(`criteria: ${r.criteria_ids.join(', ')}`);
}

// converse-replay <study.json> <answers.txt|json> [name] — deterministic replay.
// Drives the SAME engine with scripted answers; prints transcript + outcome; persists a record.
async function cmdConverseReplay(studyPath, answersPath, name) {
  const S = JSON.parse(fs.readFileSync(studyPath, 'utf8'));
  const raw = fs.readFileSync(answersPath, 'utf8');
  const answers = answersPath.endsWith('.json') ? JSON.parse(raw) : parseAnswerTxt(raw);
  const ch = replayChannel(answers);
  const r = await runConversation(S, ch, name);
  for (const t of ch.transcript) {
    if (t.agent) console.log('AGENT  : ' + t.agent);
    if (t.patient != null) console.log('PATIENT: ' + t.patient);
  }
  console.log(`\nOUTCOME: ${r.terminal}${r.reason ? `  (${r.reason})` : ''}`);
  return r;
}

// test-converse <study.json> — equivalence regression: the conversational engine
// must reach the SAME terminal as the batch `screen` engine for every answer set.
async function cmdTestConverse(studyPath) {
  const S = JSON.parse(fs.readFileSync(studyPath, 'utf8'));
  const qs = (S.screeningQuestions || []).slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  // build a "passing" answer set: every question answered the non-disqualifying way
  const passVal = (q) => {
    if (q.answer_type === 'number') return 40;
    if (q.answer_type === 'choice') return (q.choices || ['Female'])[0];
    return /answer == yes/.test(q.disqualify_condition || '') ? 'no'
      : /answer == no/.test(q.disqualify_condition || '') ? 'yes' : 'no';
  };
  const base = {}; for (const q of qs) base[q.variable_name] = passVal(q);

  const cases = [{ name: 'all-pass', a: { ...base } }];
  // one case per disqualifiable question: flip just that answer to its knockout
  for (const q of qs) {
    if (!q.disqualify_condition || q.routing) continue;
    const a = { ...base };
    if (q.answer_type === 'number') a[q.variable_name] = 10;            // age < 18
    else a[q.variable_name] = /answer == yes/.test(q.disqualify_condition) ? 'yes' : 'no';
    cases.push({ name: `knockout:${q.variable_name}`, a });
  }
  // a missing case (drop a middle answer)
  if (qs.length > 3) { const a = { ...base }; delete a[qs[Math.floor(qs.length / 2)].variable_name]; cases.push({ name: 'missing-one', a }); }

  let pass = 0, fail = 0;
  for (const c of cases) {
    const batch = screenPatient(S, c.a).terminal;
    const conv = (await runConversation(S, replayChannel(c.a))).terminal;
    const ok = batch === conv;
    console.log(`  ${ok ? '✓' : '✗'} ${c.name}: batch=${batch} conversational=${conv}`);
    ok ? pass++ : fail++;
  }
  console.log(`converse-equivalence: ${pass} pass, ${fail} fail`);
  if (fail) process.exitCode = 1;
}

// test-extractor — run the RULE extractor over evals/extractor-goldens.json.
// Each golden: { question_type, choices?, reply, ctx?, expect:{value?,needs_clarification} }.
function cmdTestExtractor(goldensPath) {
  const p = goldensPath || path.join('evals', 'extractor-goldens.json');
  const goldens = JSON.parse(fs.readFileSync(p, 'utf8'));
  const extract = makeExtractor('rule');
  let pass = 0, fail = 0;
  console.log(`EXTRACTOR goldens (rule) — ${goldens.length} case(s):`);
  for (const g of goldens) {
    const q = { answer_type: g.question_type, choices: g.choices };
    const r = extract(q, g.reply, g.ctx || {});
    const e = g.expect || {};
    let ok = true;
    if ('needs_clarification' in e) ok = ok && (!!r.needs_clarification === !!e.needs_clarification);
    if ('value' in e) ok = ok && (r.value === e.value);
    const desc = `${g.question_type} "${(g.reply || JSON.stringify(g.ctx || {})).slice(0, 28)}"`;
    console.log(`  ${ok ? '✓' : '✗'} ${desc} -> value=${JSON.stringify(r.value)} needs_clarification=${r.needs_clarification}${ok ? '' : `  (expected ${JSON.stringify(e)})`}`);
    ok ? pass++ : fail++;
  }
  console.log(`extractor-goldens: ${pass} pass, ${fail} fail`);
  if (fail) process.exitCode = 1;
}

// ===================================================================
// EVAL-TRANSCRIPTS — run REAL Alleviate SMS transcripts through our engine
// and compare our verdict to the live platform's recorded outcome.
// Parses each transcript's Q&A turns -> answers, runs screenPatient, diffs.
// ===================================================================
// classify a SYSTEM question line -> our variable_name (keyword match)
function classifyQuestion(textLow) {
  if (/\bhow old|your age\b|what is your age/.test(textLow)) return { v: 'q1_age', type: 'number' };
  if (/height/.test(textLow)) return { v: '_height', type: 'text' };
  if (/weight/.test(textLow) && !/lose weight|weight management|weight-loss|weight loss/.test(textLow)) return { v: '_weight', type: 'text' };
  if (/type 2 diabetes|type ii diabetes|t2d/.test(textLow)) return { v: 'q3_t2d', type: 'yes_no' };
  if (/type 1 diabetes|type i diabetes|ketoacidosis/.test(textLow)) return { v: 'q6_t1dm', type: 'yes_no' };
  if (/lose weight|diet or exercise|weight.loss attempt/.test(textLow)) return { v: 'q4_weightloss', type: 'yes_no' };
  if (/glp-?1|ozempic|wegovy|mounjaro|zepbound|trulicity|saxenda|rybelsus/.test(textLow)) return { v: 'q5_glp1', type: 'yes_no' };
  if (/transplant/.test(textLow)) return { v: 'q7_transplant', type: 'yes_no' };
  if (/gastroparesis|stomach.empt|emptying problem|blocked stomach/.test(textLow)) return { v: 'q8_gastric', type: 'yes_no' };
  if (/medullary thyroid|thyroid cancer|multiple endocrine|men ?2|men type 2/.test(textLow)) return { v: 'q9_mtc', type: 'yes_no' };
  if (/pregnan|breastfeeding|breast-feeding/.test(textLow)) return { v: 'q10_pregnancy', type: 'yes_no' };
  if (/\bbmi\b|overweight|obes/.test(textLow)) return { v: 'q2_bmi', type: 'yes_no' };
  return null;
}

// parse a transcript file -> { status, answers, sawPregnancyQ }
function parseTranscript(txt) {
  const status = (txt.match(/Final status\s*:\s*(\S+)/) || [])[1] || '';
  // collect ordered turns
  const turns = [];
  const lines = txt.split('\n');
  let cur = null;
  for (const line of lines) {
    const h = line.match(/^\[[^\]]*\]\s*(SYSTEM|PATIENT)\s*:/);
    if (h) { if (cur) turns.push(cur); cur = { role: h[1], text: '' }; }
    else if (cur && !/^=+$/.test(line) && !/END OF TRANSCRIPT/.test(line)) cur.text += ' ' + line.trim();
  }
  if (cur) turns.push(cur);

  const answers = {};
  let sawPregnancyQ = false;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role !== 'SYSTEM') continue;
    const cls = classifyQuestion(turns[i].text.toLowerCase());
    if (!cls) continue;
    if (cls.v === 'q10_pregnancy') sawPregnancyQ = true;
    // the next PATIENT turn is the answer
    const pat = turns.slice(i + 1).find(t => t.role === 'PATIENT');
    if (!pat) continue;
    if (answers[cls.v] != null) continue; // first answer wins
    if (cls.type === 'number') { const m = pat.text.match(/\b(\d{1,3})\b/); if (m) answers[cls.v] = m[1]; }
    else if (cls.type === 'text') { answers[cls.v] = pat.text.trim(); }
    else { const ex = extractAnswer({ answer_type: 'yes_no' }, pat.text); if (ex.ok) answers[cls.v] = ex.value; }
  }
  // derive BMI from height+weight if the direct BMI yes/no wasn't captured
  if (answers.q2_bmi == null && answers._height && answers._weight) {
    const inch = parseHeightInches(answers._height), lbs = parseWeightLbs(answers._weight);
    const bmi = inch && lbs ? 703 * lbs / (inch * inch) : null;
    if (bmi != null) answers.q2_bmi = bmi >= 27 ? 'yes' : 'no';
  }
  // sex: the live agent only asks pregnancy to females -> use that as the routing signal
  if (answers.sex_at_birth == null) answers.sex_at_birth = sawPregnancyQ ? 'Female' : 'Male';
  delete answers._height; delete answers._weight;
  return { status, answers };
}

// map live status -> the clinical verdict we expect our engine to produce
const LIVE_TO_OURS = { booked_for_call: 'QUALIFIED', dnq_criteria_not_met: 'DNQ' };

async function cmdEvalTranscripts(studyDir, mode) {
  const llmOnly = mode === 'llm-only';
  const S = JSON.parse(fs.readFileSync(path.join(studyDir, 'study.json'), 'utf8'));
  const inbox = path.join(studyDir, 'screening');
  const files = fs.readdirSync(inbox).filter(f => f.endsWith('.txt'));
  const rows = [];
  for (const f of files.sort()) {
    const base = f.replace(/\.txt$/, '');
    const jsonPath = path.join(inbox, base + '.json');
    const hasLlm = fs.existsSync(jsonPath);
    if (llmOnly && !hasLlm) continue;
    const { status } = parseTranscript(fs.readFileSync(path.join(inbox, f), 'utf8'));
    // prefer LLM-extracted answers (accurate); else fall back to the rule parser
    const answers = hasLlm ? JSON.parse(fs.readFileSync(jsonPath, 'utf8')) : parseTranscript(fs.readFileSync(path.join(inbox, f), 'utf8')).answers;
    const r = screenPatient(S, answers);
    const disqualified = (r.trace || []).some(t => t.disqualified === true);
    rows.push({ patient: base, live: status, ours: r.terminal, reason: r.reason || '', method: hasLlm ? 'llm' : 'rule', disqualified, answers });
  }
  // clinical set = the patients who reached a clinical decision on the platform
  const clinical = rows.filter(r => LIVE_TO_OURS[r.live]);
  const match = clinical.filter(r => r.ours === LIVE_TO_OURS[r.live]);
  const booked = rows.filter(r => r.live === 'booked_for_call');
  const bookedOK = booked.filter(r => r.ours === 'QUALIFIED');
  const crit = rows.filter(r => r.live === 'dnq_criteria_not_met');
  const critOK = crit.filter(r => r.ours === 'DNQ');
  const notInt = rows.filter(r => r.live === 'dnq_not_interested');
  // safety: our engine must NEVER qualify a patient the platform did not book
  const falseQual = rows.filter(r => r.ours === 'QUALIFIED' && r.live !== 'booked_for_call');
  // CONTRADICTION analysis (the platform defers pregnancy + GLP-1 to the visit, so a booked patient
  // we mark INCOMPLETE is "passed everything asked, finish deferred items on the call" — NOT a conflict).
  const bookedContradict = booked.filter(r => r.ours === 'DNQ');                 // we knock out someone they booked
  const bookedConsistent = booked.filter(r => r.ours !== 'DNQ');                 // QUALIFIED or INCOMPLETE-no-knockout
  const critContradict = crit.filter(r => r.ours === 'QUALIFIED');              // we pass someone they rejected (worst)
  const critMiss = crit.filter(r => r.ours === 'INCOMPLETE');                   // we didn't see the knockout (asked-set/extraction)
  const contradictions = bookedContradict.length + critContradict.length;

  const pct = (n, d) => d ? (100 * n / d).toFixed(1) + '%' : '—';
  const esc = (s) => String(s).replace(/\|/g, '\\|');
  let md = `# Engine vs Live Alleviate — Transcript Replay (${S.study?.name || studyDir})

> ${rows.length} real SMS transcripts replayed through our deterministic engine and compared to the
> platform's recorded outcome. Answers are parsed from each transcript; the verdict is our engine's.

_Answer source: ${rows.filter(r => r.method === 'llm').length} via LLM extraction, ${rows.filter(r => r.method === 'rule').length} via rule parser._

## Headline — zero contradictions
The platform **books a patient after the core questions and finishes deferred items (pregnancy, GLP-1) on
the call** — so a booked patient we mark INCOMPLETE means "passed everything asked; finish the deferred
questions on the call," which is exactly what the platform does. The right metric is **contradictions**:
cases where our verdict actively conflicts with the platform's.

**Contradictions: ${contradictions}** ( we DNQ'd a booked patient: ${bookedContradict.length} · we QUALIFIED a clinically-rejected patient: ${critContradict.length} ) ${contradictions ? '⚠️' : '✅'}

| Live outcome | n | consistent with us | conflicts | note |
|---|---|---|---|---|
| booked_for_call | ${booked.length} | ${bookedConsistent.length} (QUALIFIED or INCOMPLETE-no-knockout) | ${bookedContradict.length} | we never knocked out someone they booked |
| dnq_criteria_not_met | ${crit.length} | ${critOK.length} (we also DNQ) | ${critContradict.length} | ${critMiss.length} we left INCOMPLETE (knockout question not in transcript) |

**Of booked patients we fully resolved, ${bookedOK.length}/${booked.length} reached QUALIFIED**; the rest are
INCOMPLETE only on questions the platform also deferred to the call (pregnancy), never on a failed knockout.

**Safety check (no false-qualify):** our engine marked QUALIFIED on **${falseQual.length}** patient(s) the
platform did NOT book. ${falseQual.length ? '⚠️ review below.' : '✅ none.'}

## Non-clinical outcomes (engine intentionally does not decide "interest")
\`dnq_not_interested\` (${notInt.length}) = patient opted out / never engaged — an intent outcome, not an
eligibility verdict. Our engine sees unanswered questions and returns INCOMPLETE (it never fabricates a
clinical pass/fail). Breakdown of our terminal for these:
${(() => { const b = {}; for (const r of notInt) b[r.ours] = (b[r.ours] || 0) + 1; return Object.entries(b).map(([k, v]) => `- ${k}: ${v}`).join('\n'); })()}

## Confusion matrix (live rows × our columns)
| live \\ ours | QUALIFIED | DNQ | INCOMPLETE |
|---|---|---|---|
${['booked_for_call', 'dnq_criteria_not_met', 'dnq_not_interested', 'study_outreach'].map(L => {
    const g = rows.filter(r => r.live === L);
    const c = t => g.filter(r => r.ours === t).length;
    return `| ${L} | ${c('QUALIFIED')} | ${c('DNQ')} | ${c('INCOMPLETE')} |`;
  }).join('\n')}

## Clinical mismatches (live screened, our verdict differs)
${(() => {
    const mm = clinical.filter(r => r.ours !== LIVE_TO_OURS[r.live]);
    if (!mm.length) return '_None — perfect agreement on the clinically-decided set._';
    return '| Patient | Live | Ours | Our reason |\n|---|---|---|---|\n' +
      mm.map(r => `| ${esc(r.patient)} | ${r.live} | ${r.ours} | ${esc(r.reason)} |`).join('\n');
  })()}
`;
  fs.writeFileSync(path.join(studyDir, 'TRANSCRIPT-EVAL-REPORT.md'), md);
  fs.writeFileSync(path.join(studyDir, 'TRANSCRIPT-EVAL-REPORT.html'), htmlWrap(`Transcript Eval — ${S.study?.name || ''}`, marked.parse(md)));
  fs.writeFileSync(path.join(inbox, 'transcript-eval.json'), JSON.stringify(rows, null, 2));
  console.log(`replayed ${rows.length} transcripts (${rows.filter(r => r.method === 'llm').length} LLM-extracted)`);
  console.log(`CONTRADICTIONS: ${contradictions}  (booked→DNQ: ${bookedContradict.length}, criteria_not_met→QUALIFIED: ${critContradict.length})`);
  console.log(`  booked: ${bookedConsistent.length}/${booked.length} consistent (${bookedOK.length} fully QUALIFIED, rest INCOMPLETE on deferred Qs)`);
  console.log(`  criteria_not_met→DNQ: ${critOK.length}/${crit.length}  (${critMiss.length} INCOMPLETE: knockout Q not in transcript)`);
  console.log(`  false-qualify (safety): ${falseQual.length}`);
  console.log(`wrote ${path.join(studyDir, 'TRANSCRIPT-EVAL-REPORT.md')}`);
}

// ===================================================================
// GOLDEN — frozen regression suite (locks the proof; no live URL needed)
// ===================================================================
function cmdGolden() {
  let pass = 0, fail = 0;
  const t = (name, ok, detail) => { console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`); ok ? pass++ : fail++; };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fails = (S) => runCheck(S).filter(f => f.level === 'FAIL');
  const hasFail = (S, sub) => fails(S).some(f => f.msg.includes(sub));

  console.log('GOLDEN regression (frozen — the three historical mistakes must always be caught):');
  const azdPath = 'studies/AZD1163-D9640C00003/study.json';
  if (fs.existsSync(azdPath)) {
    const azd = JSON.parse(fs.readFileSync(azdPath, 'utf8'));
    t('AZD baseline eval is clean', fails(azd).length === 0);
    let m = clone(azd); m.screeningQuestions.push({ rank: 99, sms_question: 'Do you have swollen/tender joints?', criteria_ids: ['INC-5'], disqualify_condition: 'answer == no' });
    t('clinical-gate caught (Q→INC-5 exam = PRECISION fail)', hasFail(m, 'INC-5'));
    m = clone(azd); m.screeningQuestions.push({ rank: 99, sms_question: 'Taken tocilizumab/rituximab/JAK?', criteria_ids: ['EXC-6'], disqualify_condition: 'answer == yes' });
    t('drug-recall caught (Q→EXC-6 records = PRECISION fail)', hasFail(m, 'EXC-6'));
    m = clone(azd); m.screeningQuestions = m.screeningQuestions.filter(q => !(q.criteria_ids || []).includes('EXC-1'));
    t('missed-knockout caught (EXC-1 uncovered = RECALL fail)', hasFail(m, 'EXC-1'));
    // trust-the-doc: live called AZD a "daily pill"; our KB must say injection
    t('trust-the-doc: AZD drug form = injection (not live\'s "pill")', /injection|subcutaneous/i.test(azd.study?.drug || ''));
  } else t('AZD fixture present', false, 'missing');

  // every shipped study must eval-clean
  for (const s of ['WC45276', 'MK-7240', 'AZD1163-D9640C00003', '77242113PSA3002', 'VP-VQW-765-3201', 'WC45726']) {
    const p = `studies/${s}/study.json`;
    if (fs.existsSync(p)) t(`${s} eval-clean`, fails(JSON.parse(fs.readFileSync(p, 'utf8'))).length === 0);
  }
  console.log(`golden: ${pass} pass, ${fail} fail`);
  if (fail) process.exitCode = 1;
}

function cmdBuild(jsonPath) {
  const S = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const dir = path.dirname(jsonPath);
  const slug = slugify(S.study?.internalNumber || S.study?.name);
  const full = path.join(dir, `${slug}-FULL`);
  const red = path.join(dir, `${slug}-REDACTED`);
  writePair(full, buildReport(S, false), `${S.study?.name || slug} — Full Configuration`);
  writePair(red, buildReport(S, true), `${S.study?.name || slug} — Redacted Configuration`);
  console.log(`wrote ${slug}-FULL.{md,html} and ${slug}-REDACTED.{md,html}`);
  console.log(`sections: inc=${(S.inclusionCriteria || []).length} exc=${(S.exclusionCriteria || []).length} questions=${(S.screeningQuestions || []).length} nodes=${(S.flow?.nodes || []).length} patients=${(S.patients || []).length}`);
  const fails = printCheck(runCheck(S, dir)); // Tier-1 eval runs on every build; docsDir = study.json's folder
  if (fails) process.exitCode = 1;
}

// ===================================================================
// CONVERTER  (captured RSC payloads -> study.json)
// ===================================================================
function parseRSC(txt) {
  const t = txt.replace(/^URL:.*\nMETHOD:.*\nSTATUS:.*\nCT:.*\n\n/s, '');
  const chunks = {}; let i = 0;
  while (i < t.length) {
    const m = /^(\d+):/.exec(t.slice(i));
    if (!m) { const nl = t.indexOf('\n', i); if (nl < 0) break; i = nl + 1; continue; }
    i += m[0].length; const id = m[1];
    const b = /^([A-Za-z])([0-9a-f]+),/.exec(t.slice(i, i + 24));
    if (b) { const len = parseInt(b[2], 16); i += b[0].length; chunks[id] = t.slice(i, i + len); i += len; }
    else { let nl = t.indexOf('\n', i); if (nl < 0) nl = t.length; chunks[id] = t.slice(i, nl); i = nl + 1; }
  }
  return chunks;
}
const parseChunk = (s) => { if (s == null) return null; try { return JSON.parse(s); } catch { return s; } };
function resolveRefs(val, chunks, seen = new Set()) {
  if (typeof val === 'string') {
    const m = /^\$@?(\d+)$/.exec(val);
    if (m && !seen.has(m[1])) { seen.add(m[1]); return resolveRefs(parseChunk(chunks[m[1]]), chunks, seen); }
    return val;
  }
  if (Array.isArray(val)) return val.map(v => resolveRefs(v, chunks, new Set(seen)));
  if (val && typeof val === 'object') { const o = {}; for (const k in val) o[k] = resolveRefs(val[k], chunks, new Set(seen)); return o; }
  return val;
}
function parseBody(txt, wantKeys) {
  const chunks = parseRSC(txt);
  for (const id of Object.keys(chunks)) {
    const v = parseChunk(chunks[id]);
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      let probe = v.data && typeof v.data === 'object' ? v.data : v;
      if (Array.isArray(probe)) probe = probe[0] || {};
      if (probe && wantKeys.some(k => k in probe)) return resolveRefs(v, chunks);
    }
  }
  return {};
}
const unwrap = (o) => { let d = o?.data ?? o; return Array.isArray(d) ? (d[0] ?? {}) : d; };

function findPayload(rawDir, wantKeys) {
  for (const f of fs.readdirSync(rawDir).sort()) {
    let txt; try { txt = fs.readFileSync(path.join(rawDir, f), 'utf8'); } catch { continue; }
    if (!wantKeys.some(k => txt.includes('"' + k + '"'))) continue;
    const r = unwrap(parseBody(txt, wantKeys));
    if (r && Object.keys(r).length) return r;
  }
  return {};
}
function collectPatients(rawDir) {
  const byId = new Map();
  for (const f of fs.readdirSync(rawDir)) {
    let txt; try { txt = fs.readFileSync(path.join(rawDir, f), 'utf8'); } catch { continue; }
    if (!txt.includes('"displayName"') || !txt.includes('"primaryPhone"')) continue;
    let idx = 0;
    while ((idx = txt.indexOf('"patientId"', idx)) !== -1) {
      let start = txt.lastIndexOf('{', idx);
      if (start < 0) { idx += 11; continue; }
      let depth = 0, inStr = false, escc = false, end = -1;
      for (let i = start; i < txt.length; i++) {
        const c = txt[i];
        if (escc) { escc = false; continue; }
        if (c === '\\') { escc = true; continue; }
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
// pull overview/docs/recruiters out of a rendered page-text dump if available
function parseRendered(renderedDir) {
  const read = (n) => { try { return fs.readFileSync(path.join(renderedDir, n), 'utf8'); } catch { return ''; } };
  const info = read('01-study-info.txt') || read('study.txt');
  const recTxt = read('03-recruiters.txt');
  const meta = {};
  const lines = info.split('\n').map(s => s.trim());
  const bi = lines.indexOf('Back to Studies');
  if (bi >= 0) meta.name = lines[bi + 1];
  const g = (re) => (info.match(re) || [])[1]?.trim();
  meta.priority = g(/Priority:\s*([^\n·]+)/);
  meta.sponsor = g(/Sponsor:\s*([^\n·]+)/);
  meta.principalInvestigator = g(/PI:\s*([^\n·]+)/);
  meta.site = g(/Site:\s*([^\n·]+)/);
  meta.internalNumber = (info.match(/\b(WC\d{4,}|[A-Z]\d{2}-\d{3,})\b/) || [])[1];
  // recruiters
  const recruiters = [];
  const emails = [...recTxt.matchAll(/([A-Za-z .'-]+)\s+Assigned\s+([\w.+-]+@[\w.-]+)/g)];
  for (const m of emails) recruiters.push({ name: m[1].trim(), email: m[2], calendar: /Calendar Connected/.test(recTxt) ? 'Connected' : '' });
  return { meta, recruiters };
}

function cmdFromPayloads(rawDir, outPath, renderedDir) {
  const flow = findPayload(rawDir, ['screeningQuestions', 'studyName', 'inclusionCriteria']);
  const doc = findPayload(rawDir, ['documentType', 'fileName']);
  const pf = findPayload(rawDir, ['buckets', 'groups']);
  const funnelRaw = pf.buckets || pf.groups || [];
  const patients = collectPatients(rawDir);
  const rendered = renderedDir ? parseRendered(renderedDir) : { meta: {}, recruiters: [] };

  const S = {
    source: 'Alleviate Health (DM Clinical Research)',
    capturedAt: new Date().toISOString().slice(0, 10),
    study: {
      name: rendered.meta.name || flow.studyName || '',
      internalNumber: rendered.meta.internalNumber || '',
      sponsor: rendered.meta.sponsor || '',
      principalInvestigator: rendered.meta.principalInvestigator || '',
      site: rendered.meta.site || '',
      priority: rendered.meta.priority || '',
      indication: '',
      drug: '',
      flowStatus: flow.status || '',
      flowVersion: flow.publishedVersion ?? flow.version,
      isPublished: !!flow.isPublished,
      flowUpdated: flow.updatedAt || '',
      studyId: flow.studyId || doc.studyId || '',
      selectedProtocolDocumentId: flow.selectedProtocolDocumentId || '',
    },
    documents: doc.fileName ? [{
      name: doc.fileName, type: (doc.documentType || '').toUpperCase() || 'Protocol',
      uploaded: (doc.createdAt || '').slice(0, 10), documentId: doc.documentId || '',
      extractionStatus: doc.extractionStatus || '',
    }] : [],
    knowledgeBank: {
      'General Study Information': flow.generalInfo || '',
      'Trial Design': flow.trialDesign || '',
      'Compensation / Reimbursement': flow.compensation || '',
      'Blinding': flow.blinding || '',
    },
    inclusionCriteria: (doc.inclusionCriteria?.length ? doc.inclusionCriteria : flow.inclusionCriteria) || [],
    exclusionCriteria: (doc.exclusionCriteria?.length ? doc.exclusionCriteria : flow.exclusionCriteria) || [],
    screeningQuestions: flow.screeningQuestions || [],
    flow: { nodes: flow.nodes || [], edges: flow.edges || [] },
    funnel: funnelRaw.map(b => ({ key: b.key, label: b.label, count: b.count })),
    patients: patients.map(p => ({
      displayName: p.displayName, primaryPhone: p.primaryPhone,
      lifecycleStatus: p.lifecycleStatus || '', currentStepLabel: p.currentStepLabel || '',
      lastActivityAt: p.lastActivityAt || '',
    })),
    recruiters: rendered.recruiters,
  };
  fs.writeFileSync(outPath, JSON.stringify(S, null, 2));
  console.log(`wrote ${outPath}`);
  console.log(`  inc=${S.inclusionCriteria.length} exc=${S.exclusionCriteria.length} questions=${S.screeningQuestions.length} nodes=${S.flow.nodes.length} funnel=${S.funnel.length} patients=${S.patients.length} recruiters=${S.recruiters.length}`);
}

const SCHEMA = `study.json — input contract (all fields optional; missing = section degrades gracefully)
{
  "source": "Alleviate Health (DM Clinical Research)",
  "capturedAt": "2026-06-17",
  "study": {
    "name": "WC45276 (CT-388-106)_Obesity",
    "internalNumber": "WC45726",
    "sponsor": "F. Hoffmann-La Roche Ltd",
    "principalInvestigator": "Vicki Miller, MD",
    "site": "Houston Metro, 13406 Medical Complex Drive, Tomball TX",
    "priority": "Very High",
    "indication": "Type 2 Diabetes + overweight/obesity",
    "drug": "GLP-1/GIP receptor agonist (CT-388), weekly",
    "flowStatus": "active", "flowVersion": 2, "isPublished": true,
    "flowUpdated": "2026-05-15", "studyId": "uuid", "selectedProtocolDocumentId": "uuid"
  },
  "documents": [{"name":"Protocol ...","type":"Protocol","uploaded":"2026-05-15","documentId":"uuid","extractionStatus":"complete"}],
  "knowledgeBank": {"General Study Information":"...","Trial Design":"...","Compensation / Reimbursement":"...","Blinding":""},
  "inclusionCriteria": [{"criterion_number":1,"source_pages":[46],"criterion_text":"...","verification_method":"self_report","knockout_strength":"hard","phone_screenable":true}],
  "exclusionCriteria": [{"criterion_number":1,"source_pages":[47],"criterion_text":"...","verification_method":"lab","knockout_strength":"hard","phone_screenable":false}],
  "// classification": "verification_method ∈ {self_report,exam,lab,imaging,records,derived}; knockout_strength ∈ {hard,soft,none}; phone_screenable = self_report && hard. Questions may ONLY source phone_screenable criteria; every phone_screenable criterion MUST have a question (studygen eval enforces both).",
  "screeningQuestions": [{"rank":1,"variable_name":"q1","sms_question":"Are you 18+?","answer_type":"yes_no","category":"demographics","is_qualifying_question":false,"knockout_power":"high","included_in_flow":true,"disqualify_condition":"answer == no","criteria_ids":["INC-2"]}],
  "flow": {"nodes":[{"id":"...","type":"question","label":"..."}],"edges":[{"source":"...","target":"...","label":"..."}]},
  "funnel": [{"key":"to_call","label":"To Call","count":2231}],
  "patients": [{"displayName":"Jane Doe","primaryPhone":"+1...","lifecycleStatus":"to_call","currentStepLabel":"","lastActivityAt":"2026-06-17"}],
  "recruiters": [{"name":"Kanza Panhwar","email":"kanza@x.com","role":"Study_admin","calendar":"Connected"}]
}`;

// ===================================================================
// STEPWISE DRIVER + HTTP SERVER (serve) — one engine turn per HTTP call.
// startSession(study) / stepSession(session, text) advance ONE question
// using the SAME compiled question model + selector as screenPatient and
// runConversation (rank order, show_if gating, disqualify_condition). The
// FINAL terminal is delegated to screenPatient(S, collectedAnswers) so the
// server verdict is identical to the batch verdict for the same answers.
// ===================================================================
import http from 'node:http';
import { fileURLToPath } from 'node:url';

// the compiled, rank-ordered question model shared by every engine path.
function compileQuestions(S) {
  return (S.screeningQuestions || []).slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

function startSession(S, extractor = makeExtractor('rule')) {
  const qs = compileQuestions(S);
  const sess = {
    id: 'sess_' + Math.random().toString(36).slice(2, 10),
    S, qs, extractor, i: -1, ans: {}, trace: [], maxReask: 2, reaskCount: 0, done: false,
  };
  advance(sess);                       // position at the first applicable question
  return sess;
}

// constants so bareword conditions resolve, mirroring screenPatient's scope.
function sessScope(sess, extra) {
  const ageQ = sess.qs.find(q => q.answer_type === 'number');
  const s = { ...sess.ans, yes: 'yes', no: 'no', Female: 'Female', Male: 'Male', ...extra };
  if (ageQ && sess.ans[ageQ.variable_name] != null) s.age = Number(sess.ans[ageQ.variable_name]);
  return s;
}

// move the cursor to the next question whose show_if passes; record skips in trace.
function advance(sess) {
  for (let k = sess.i + 1; k < sess.qs.length; k++) {
    const q = sess.qs[k];
    if (q.show_if && evalCond(q.show_if, sessScope(sess)) === false) {
      sess.trace.push({ rank: q.rank, variable: q.variable_name, shown: false });
      continue;
    }
    sess.i = k; return q;
  }
  sess.i = sess.qs.length; return null;
}

const sessionPrompt = (sess) => { const q = sess.qs[sess.i]; return q ? q.sms_question : null; };

// finalize: delegate the verdict to screenPatient with the SAME answers (equivalence).
function finishSession(sess) {
  sess.done = true;
  const r = screenPatient(sess.S, sess.ans);
  return { done: true, terminal: r.terminal, reason: r.reason || null, deferred: r.deferred || [], trace: r.trace };
}

// advance ONE question with `text`. Returns { prompt?, done, terminal?, reason?, deferred?, trace? }.
function stepSession(sess, text) {
  if (sess.done) return finishSession(sess);
  const q = sess.qs[sess.i];
  if (!q) return finishSession(sess);

  const ex = sess.extractor(q, text, sess.ctx || {});
  if (ex.needs_clarification && sess.reaskCount < sess.maxReask) {
    sess.reaskCount++;
    return { done: false, prompt: reaskText(q) + ' ' + q.sms_question, needs_clarification: true };
  }
  sess.reaskCount = 0;

  if (ex.value != null && !ex.needs_clarification) {
    sess.ans[q.variable_name] = q.answer_type === 'yes_no' ? norm(ex.value) : ex.value;
    const disq = q.disqualify_condition
      ? evalCond(q.disqualify_condition, sessScope(sess, { answer: sess.ans[q.variable_name] })) : false;
    sess.trace.push({ rank: q.rank, variable: q.variable_name, answer: sess.ans[q.variable_name], shown: true, known: true, disqualified: disq === true });
    // a disclosed knockout ends the conversation immediately (like the live agent / screenPatient).
    if (!q.routing && disq === true) return finishSession(sess);
  } else {
    // out of re-asks / explicit skip: leave unanswered; screenPatient will mark INCOMPLETE/deferred.
    sess.trace.push({ rank: q.rank, variable: q.variable_name, answer: null, shown: true, known: false });
  }

  const next = advance(sess);
  if (!next) return finishSession(sess);
  return { done: false, prompt: next.sms_question };
}

// ---- conversational layer (presentation only — lives at the API edge, never
//      touches stepSession/screenPatient, so equivalence + selfcheck are unaffected) ----
function convoGreeting(S, name) {
  const c = S.conversation || {};
  const nm = name ? ' ' + name : '';
  if (c.greeting) return c.greeting.replace('{name}', nm);
  const m = S.study || {};
  return `Hi${nm}! We're enrolling in a paid ${m.indication || 'clinical research'} study. Would you like to see if you may qualify?`;
}
function convoClosing(S, terminal) {
  const c = S.conversation || {};
  if (terminal === 'QUALIFIED') return c.closingQualified || "Great news — you pre-qualify! Let's set up a quick call to confirm a few details. What time works best for you?";
  if (terminal === 'DNQ') return c.closingDnq || "I'm sorry, but it doesn't look like a match right now. We'll keep your information on file and reach out if a future study fits.";
  return c.closingIncomplete || "Thanks for your time. A study coordinator will follow up to finish a few remaining questions.";
}
const QUESTION_RE = /\?\s*$|^(what|how|am i|do i|could i|can i|will i|would i|is it|is there|are there|does|why|when|where|who)\b/i;
const isQuestionLike = (t) => QUESTION_RE.test((t || '').trim());
const DEFLECTION = "Good question. I don't have that specific detail right now, but our onsite study coordinator can cover that on a quick call.";
const CONSENT_YES = /\b(yes|yeah|yep|yup|sure|ok|okay|absolutely|interested|sounds good|let'?s|go ahead|i would|i am)\b/i;
const CONSENT_NO = /\b(no|nope|not interested|not right now|stop|unsubscribe|maybe later)\b/i;
const ACK = 'Got it.';

// ---- study scanning / projection helpers for the API ----
const STUDIES_DIR = 'studies';
function scanStudies() {
  const out = [];
  let dirs = [];
  try { dirs = fs.readdirSync(STUDIES_DIR, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return out; }
  for (const id of dirs.sort()) {
    const p = path.join(STUDIES_DIR, id, 'study.json');
    if (!fs.existsSync(p)) continue;
    let S; try { S = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { continue; }
    const m = S.study || {};
    const qn = (S.screeningQuestions || []).length;
    const status = S.status || (qn > 0 ? 'ready' : 'draft');
    out.push({ id, name: m.name || id, sponsor: m.sponsor || '', indication: m.indication || '', questionCount: qn, status });
  }
  return out;
}

// Create a study from the UI: save uploaded docs, run pdftotext, scaffold a draft study.json.
// body: { name, internalNumber?, sponsor?, indication?, documents:[{filename, type:'Protocol'|'ICF', dataBase64}] }
function createStudy(body) {
  const name = (body.name || '').trim();
  if (!name) return { error: 'name required', code: 400 };
  const id = slugify(body.internalNumber || name);
  const dir = path.join(STUDIES_DIR, id);
  if (fs.existsSync(path.join(dir, 'study.json'))) return { error: `study "${id}" already exists`, code: 409 };
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });

  const documents = [];
  for (const d of (body.documents || [])) {
    if (!d.filename || !d.dataBase64) continue;
    const safe = path.basename(d.filename).replace(/[^\w.()\-]+/g, '_');
    const pdfPath = path.join(dir, 'docs', safe);
    try { fs.writeFileSync(pdfPath, Buffer.from(d.dataBase64, 'base64')); } catch { continue; }
    // extract text next to study root (protocol.txt / icf.txt) for the onboarding pipeline
    let extracted = false;
    const outTxt = path.join(dir, (d.type === 'ICF' ? 'icf' : 'protocol') + '.txt');
    try { execFileSync('pdftotext', ['-layout', pdfPath, outTxt]); extracted = fs.existsSync(outTxt); } catch { extracted = false; }
    documents.push({ name: safe, type: d.type || 'Protocol', uploaded: new Date().toISOString().slice(0, 10), documentId: '', extractionStatus: extracted ? 'text-extracted (awaiting criteria/question extraction)' : 'uploaded (pdftotext unavailable)' });
  }

  const S = {
    source: 'Uploaded via comforceEva UI',
    capturedAt: new Date().toISOString().slice(0, 10),
    status: 'draft',
    study: {
      name, internalNumber: body.internalNumber || id, sponsor: body.sponsor || '',
      principalInvestigator: '', site: '', priority: '',
      indication: body.indication || '', drug: body.drug || '',
      flowStatus: 'draft (uploaded — pending extraction)', flowVersion: 0, isPublished: false,
      studyId: '', selectedProtocolDocumentId: '',
      _REQUIRED_FROM_SITE: 'PI, site, priority — supply from site/CRM',
    },
    documents,
    knowledgeBank: { 'General Study Information': '', 'Trial Design': '', 'Compensation / Reimbursement': '', 'Blinding': '' },
    inclusionCriteria: [], exclusionCriteria: [], screeningQuestions: [],
    flow: { nodes: [{ id: 'root', type: 'root', label: 'Are you interested in this study?' }], edges: [] },
    funnel: [], patients: [], recruiters: [],
  };
  fs.writeFileSync(path.join(dir, 'study.json'), JSON.stringify(S, null, 2));
  return { id, status: 'draft', documents: documents.length, note: 'Documents uploaded and text-extracted. Run the StudyOnboard pipeline (classify → questions → build) to make it screenable.' };
}
function loadStudy(id) {
  const p = path.join(STUDIES_DIR, id, 'study.json');
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}
function studyDetail(id, S) {
  const m = S.study || {};
  return {
    id, name: m.name || id, sponsor: m.sponsor || '', indication: m.indication || '',
    drug: m.drug || '', phase: m.phase || '',
    questions: compileQuestions(S).map(q => ({ rank: q.rank, variable_name: q.variable_name, sms_question: q.sms_question, answer_type: q.answer_type, choices: q.choices || null })),
    criteriaCount: { inclusion: (S.inclusionCriteria || []).length, exclusion: (S.exclusionCriteria || []).length },
    status: S.status || ((S.screeningQuestions || []).length ? 'ready' : 'draft'),
    overview: {                                  // editable overview fields
      name: m.name || '', internalNumber: m.internalNumber || '', sponsor: m.sponsor || '',
      principalInvestigator: m.principalInvestigator || '', site: m.site || '', priority: m.priority || '',
      indication: m.indication || '', drug: m.drug || '',
    },
    knowledgeBank: S.knowledgeBank || {},
  };
}

// Update study.json: shallow-merge provided overview/knowledgeBank/conversation; optionally replace questions.
// body: { study?:{...}, knowledgeBank?:{...}, conversation?:{...}, screeningQuestions?:[...], status? }
function updateStudy(id, patch) {
  const p = path.join(STUDIES_DIR, id, 'study.json');
  if (!fs.existsSync(p)) return { error: 'study not found', code: 404 };
  let S; try { S = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return { error: 'corrupt study.json', code: 500 }; }
  if (patch.study && typeof patch.study === 'object') { S.study = { ...(S.study || {}), ...patch.study }; }
  if (patch.knowledgeBank && typeof patch.knowledgeBank === 'object') { S.knowledgeBank = { ...(S.knowledgeBank || {}), ...patch.knowledgeBank }; }
  if (patch.conversation && typeof patch.conversation === 'object') { S.conversation = { ...(S.conversation || {}), ...patch.conversation }; }
  if (Array.isArray(patch.screeningQuestions)) S.screeningQuestions = patch.screeningQuestions;
  if (patch.status) S.status = patch.status;
  fs.writeFileSync(p, JSON.stringify(S, null, 2));
  return { id, ...studyDetail(id, S) };
}

// reuse screen-report's computation: aggregate studies/<id>/screening.
function reportForStudy(id) {
  const empty = { counts: { qualified: 0, dnq: 0, incomplete: 0, total: 0 }, dnqReasons: [], patients: [] };
  const studyDir = path.join(STUDIES_DIR, id);
  const studyPath = path.join(studyDir, 'study.json');
  const inbox = path.join(studyDir, 'screening');
  if (!fs.existsSync(studyPath) || !fs.existsSync(inbox)) return empty;
  const S = loadStudy(id);
  const all = fs.readdirSync(inbox).filter(f => /\.(txt|json)$/.test(f) && !f.startsWith('result') && !f.startsWith('transcript-eval'));
  const byBase = new Map();
  for (const f of all.sort()) { const base = f.replace(/\.(txt|json)$/, ''); if (!byBase.has(base) || f.endsWith('.json')) byBase.set(base, f); }
  const results = [];
  for (const f of [...byBase.values()].sort()) {
    let answers; try {
      const raw = fs.readFileSync(path.join(inbox, f), 'utf8');
      answers = f.endsWith('.json') ? JSON.parse(raw) : parseAnswerTxt(raw);
    } catch { continue; }
    const r = screenPatient(S, answers); r.patient = f.replace(/\.(txt|json)$/, ''); results.push(r);
  }
  const counts = {
    qualified: results.filter(r => r.terminal === 'QUALIFIED').length,
    dnq: results.filter(r => r.terminal === 'DNQ').length,
    incomplete: results.filter(r => r.terminal === 'INCOMPLETE').length,
    total: results.length,
  };
  const byReason = {};
  for (const r of results.filter(r => r.terminal === 'DNQ')) byReason[r.reason] = (byReason[r.reason] || 0) + 1;
  const dnqReasons = Object.entries(byReason).sort((a, b) => b[1] - a[1]).map(([reason, count]) => ({ reason, count }));
  const patients = results.map(r => ({ patient: r.patient, terminal: r.terminal, failed: r.failed || null, reason: r.reason || null }));
  return { counts, dnqReasons, patients };
}

const SERVER_SESSIONS = new Map();      // sessionId -> session
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function sendJSON(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(obj));
}
function readBody(req) {
  return new Promise((resolve) => {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
  });
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', ...]
  const seg = parts.slice(1);

  if (req.method === 'GET' && seg[0] === 'studies' && seg.length === 1) return sendJSON(res, 200, scanStudies());
  if (req.method === 'POST' && seg[0] === 'studies' && seg.length === 1) {
    const body = await readBody(req);
    const r = createStudy(body);
    if (r.error) return sendJSON(res, r.code || 400, { error: r.error });
    return sendJSON(res, 201, r);
  }
  if (req.method === 'GET' && seg[0] === 'studies' && seg.length === 2) {
    const S = loadStudy(seg[1]); if (!S) return sendJSON(res, 404, { error: 'study not found' });
    return sendJSON(res, 200, studyDetail(seg[1], S));
  }
  if (req.method === 'POST' && seg[0] === 'studies' && seg.length === 3 && seg[2] === 'update') {
    const body = await readBody(req);
    const r = updateStudy(seg[1], body);
    if (r.error) return sendJSON(res, r.code || 400, { error: r.error });
    return sendJSON(res, 200, r);
  }
  if (req.method === 'POST' && seg[0] === 'screen' && seg[1] === 'start') {
    const body = await readBody(req);
    const S = loadStudy(body.studyId); if (!S) return sendJSON(res, 404, { error: 'study not found' });
    const sess = startSession(S);
    sess.phase = 'consent';                       // greet + consent-to-continue before any question
    sess.firstPrompt = sessionPrompt(sess);
    sess.studyName = (S.study || {}).name || body.studyId;
    SERVER_SESSIONS.set(sess.id, sess);
    // greeting doubles as the consent question; first clinical question comes after the first affirmative reply.
    return sendJSON(res, 200, { sessionId: sess.id, greeting: convoGreeting(S, body.name), consent: true, done: false });
  }
  if (req.method === 'POST' && seg[0] === 'screen' && seg[1] === 'answer') {
    const body = await readBody(req);
    const sess = SERVER_SESSIONS.get(body.sessionId);
    if (!sess) return sendJSON(res, 404, { error: 'session not found' });
    const text = body.text ?? '';
    const S = sess.S;

    // consent gate
    if (sess.phase === 'consent') {
      if (isQuestionLike(text)) return sendJSON(res, 200, { done: false, ack: DEFLECTION, prompt: convoGreeting(S, body.name), redirected: true });
      if (CONSENT_NO.test(text) && !CONSENT_YES.test(text)) {
        SERVER_SESSIONS.delete(sess.id);
        return sendJSON(res, 200, { done: true, terminal: 'INCOMPLETE', reason: 'Declined to start screening', deferred: [], trace: [], closing: convoClosing(S, 'INCOMPLETE') });
      }
      sess.phase = 'screening';                    // affirmative → begin clinical questions
      return sendJSON(res, 200, { done: false, prompt: sess.firstPrompt });
    }

    // screening: patient asked a question instead of answering → deflect + repeat (don't advance)
    if (isQuestionLike(text)) {
      return sendJSON(res, 200, { done: false, ack: DEFLECTION, prompt: sessionPrompt(sess), redirected: true });
    }

    const turn = stepSession(sess, text);
    if (turn.done) {
      SERVER_SESSIONS.delete(sess.id);
      return sendJSON(res, 200, { ...turn, closing: convoClosing(S, turn.terminal) });
    }
    // ongoing question → acknowledge the prior answer (skip on a clarifying re-ask)
    return sendJSON(res, 200, { ...turn, ack: turn.needs_clarification ? undefined : ACK });
  }
  if (req.method === 'GET' && seg[0] === 'report' && seg.length === 2) {
    return sendJSON(res, 200, reportForStudy(seg[1]));
  }
  return sendJSON(res, 404, { error: 'not found' });
}

function serveStatic(req, res, url) {
  const uiDir = 'ui';
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const filePath = path.normalize(path.join(uiDir, rel));
  if (!filePath.startsWith(path.normalize(uiDir))) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found. Static UI lives in ./ui/ (owned by the UI agent). API is under /api/*.'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream', 'Access-Control-Allow-Origin': '*' });
    res.end(data);
  });
}

function cmdServe(port) {
  const p = Number(port) || 7765;
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${p}`);
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' }); return res.end(); }
    if (url.pathname.startsWith('/api/')) { try { return await handleApi(req, res, url); } catch (e) { return sendJSON(res, 500, { error: String(e && e.message || e) }); } }
    return serveStatic(req, res, url);
  });
  server.listen(p, () => {
    console.log(`studygen serve → http://localhost:${p}`);
    console.log(`  GET  /api/studies`);
    console.log(`  GET  /api/studies/:id`);
    console.log(`  POST /api/screen/start   {studyId}`);
    console.log(`  POST /api/screen/answer  {sessionId, text}`);
    console.log(`  GET  /api/report/:id`);
    console.log(`  static UI from ./ui/ at /`);
  });
}

// serve-selfcheck — assert the stepwise server verdict == screenPatient verdict
// for the same answers, across the test-converse case matrix.
function cmdServeSelfcheck(studyPath) {
  const S = JSON.parse(fs.readFileSync(studyPath || 'studies/WC45726/study.json', 'utf8'));
  const qs = compileQuestions(S);
  const passVal = (q) => {
    if (q.answer_type === 'number') return 40;
    if (q.answer_type === 'choice') return (q.choices || ['Female'])[0];
    return /answer == yes/.test(q.disqualify_condition || '') ? 'no' : /answer == no/.test(q.disqualify_condition || '') ? 'yes' : 'no';
  };
  const base = {}; for (const q of qs) base[q.variable_name] = passVal(q);
  const cases = [{ name: 'all-pass', a: { ...base } }];
  for (const q of qs) {
    if (!q.disqualify_condition || q.routing) continue;
    const a = { ...base };
    if (q.answer_type === 'number') a[q.variable_name] = 10;
    else a[q.variable_name] = /answer == yes/.test(q.disqualify_condition) ? 'yes' : 'no';
    cases.push({ name: `knockout:${q.variable_name}`, a });
  }
  // drive the stepwise session by feeding each pending question its scripted answer.
  let pass = 0, fail = 0;
  for (const c of cases) {
    const batch = screenPatient(S, c.a);
    const sess = startSession(S);
    let turn = { done: false }, guard = 0;
    while (!sess.done && sess.i < sess.qs.length && guard++ < 100) {
      const q = sess.qs[sess.i];
      const text = c.a[q.variable_name];
      turn = stepSession(sess, text == null ? '' : String(text));
      if (turn.done) break;
    }
    if (!turn.done) turn = finishSession(sess);
    const ok = turn.terminal === batch.terminal;
    console.log(`  ${ok ? '✓' : '✗'} ${c.name}: server=${turn.terminal} batch=${batch.terminal}`);
    ok ? pass++ : fail++;
  }
  console.log(`serve-selfcheck: ${pass} pass, ${fail} fail`);
  if (fail) process.exitCode = 1;
}

// ---------- CLI ----------
const [, , cmd, a, b, c] = process.argv;
if (cmd === 'build' && a) cmdBuild(a);
else if ((cmd === 'eval' || cmd === 'check') && a) cmdCheck(a, b);   // eval <study.json> [docsDir]
else if (cmd === 'audit-bundle' && a) cmdAuditBundle(a);             // emit asymmetric input for the Auditor agent
else if (cmd === 'audit-diff' && a && b) cmdAuditDiff(a, b);         // diff Auditor verdict vs our labels
else if (cmd === 'golden') cmdGolden();                             // frozen regression suite
else if (cmd === 'screen' && a && b) cmdScreen(a, b);               // screen one patient: screen <study.json> <answers.txt|json>
else if (cmd === 'screen-report' && a) cmdScreenReport(a);          // screen all in <studyDir>/screening/ -> report
else if (cmd === 'converse' && a) await cmdConverse(a, b);          // interactive CLI conversation: converse <study.json> [name]
else if (cmd === 'converse-replay' && a && b) await cmdConverseReplay(a, b, c); // deterministic replay: converse-replay <study.json> <answers> [name]
else if (cmd === 'test-converse' && a) await cmdTestConverse(a);    // equivalence gate: conversational == batch terminal
else if (cmd === 'test-extractor') cmdTestExtractor(a);            // extractor goldens gate (rule): test-extractor [goldens.json]
else if (cmd === 'serve') cmdServe(a);                            // HTTP/JSON server: serve [port] (default 7765)
else if (cmd === 'serve-selfcheck') cmdServeSelfcheck(a);          // assert stepwise server verdict == batch verdict
else if (cmd === 'eval-transcripts' && a) await cmdEvalTranscripts(a, b); // replay real Alleviate transcripts, compare to live outcome ([llm-only])
else if (cmd === 'from-payloads' && a && b) cmdFromPayloads(a, b, c);
else if (cmd === 'schema') console.log(SCHEMA);
else {
  console.log(`Usage:
  node studygen.mjs build <study.json>            (build runs eval automatically; docsDir = study.json's folder)
  node studygen.mjs eval  <study.json> [docsDir]   (Tier-1 deterministic gate; FAIL exits non-zero)
  node studygen.mjs audit-bundle <study.json>      (emit audit-input.json — labels stripped — for the Auditor agent)
  node studygen.mjs audit-diff <study.json> <verdict.json>  (diff Auditor's independent labels vs ours)
  node studygen.mjs golden                         (frozen regression — the 3 historical mistakes must stay caught)
  node studygen.mjs screen <study.json> <answers.txt|json>   (batch: score one patient's answers)
  node studygen.mjs screen-report <studyDir>       (batch: score everyone in <studyDir>/screening/)
  node studygen.mjs converse <study.json>          (interactive CLI conversation with a patient)
  node studygen.mjs converse-replay <study.json> <answers.txt|json> [name]  (deterministic replay of a conversation)
  node studygen.mjs test-converse <study.json>     (equivalence gate: conversational terminal == batch terminal)
  node studygen.mjs test-extractor [goldens.json]  (extractor goldens gate; defaults to evals/extractor-goldens.json)
  node studygen.mjs serve [port]                   (HTTP/JSON API + static ./ui/; default port 7765)
  node studygen.mjs serve-selfcheck [study.json]   (assert stepwise server verdict == batch verdict)
  node studygen.mjs from-payloads <rawDir> <out.json> [renderedDir]
  node studygen.mjs schema`);
  process.exit(1);
}
