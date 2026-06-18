// ===================================================================
// POC SPIKE — conversational, deterministic graph-traversal prescreen.
// Proves the HYBRID model: the engine walks a study's flow graph one
// question at a time (like Alleviate), but a deterministic edge-selector
// — not an LLM — decides each branch. The LLM's only job (NOT in this
// spike) is extracting a free-text reply into the question's variable.
//
// This is a throwaway proof. It does NOT touch the production engine
// (studygen.mjs). Run:  node poc/converse.mjs
// ===================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const flow = JSON.parse(fs.readFileSync(path.join(DIR, 'wc45726.flow.json'), 'utf8'));

// --- deterministic condition evaluator (same approach as the real engine) ---
function evalWhen(expr, scope) {
  if (expr === true || expr === 'true') return true;
  if (expr == null || expr === false) return false;
  const keys = Object.keys(scope);
  try { return !!(new Function(...keys, `"use strict"; return (${expr});`))(...keys.map(k => scope[k])); }
  catch { return undefined; } // missing var -> cannot evaluate
}
const norm = v => (typeof v === 'string' ? v.trim().toLowerCase() : v);

// --- the conversational runner ---
// `answers` = the patient's known variable values (in production these arrive
// one turn at a time via the LLM extractor; here we replay a full set).
function converse(flow, answers) {
  const A = { ...answers };
  // numeric question -> `age` alias so "age < 18" resolves
  const ageVar = Object.values(flow.nodes).find(n => n.answer_type === 'number')?.variable;
  if (ageVar && A[ageVar] != null) A.age = Number(A[ageVar]);
  const consts = { yes: 'yes', no: 'no', Female: 'Female', Male: 'Male' };

  const transcript = [], trace = [];
  let id = flow.start, guard = 0;
  while (id && guard++ < 100) {
    const node = flow.nodes[id];
    if (!node) return { terminal: 'ERROR', reason: `missing node ${id}`, transcript, trace };
    if (node.type === 'qualified') return { terminal: 'QUALIFIED', transcript, trace };
    if (node.type === 'dnq') return { terminal: 'DNQ', node: id, reason: node.reason, transcript, trace };

    // read the answer for this node's variable
    let val;
    if (node.type === 'question') {
      val = node.variable === ageVar ? A.age : A[node.variable];
      if (node.answer_type === 'yes_no') val = norm(val);
      transcript.push({ agent: node.prompt, patient: val == null || val === '' ? '— (no answer)' : String(val) });
      // conversational semantics: an unanswered question stalls the screen.
      // (Live, the agent simply asks it; in offline replay = INCOMPLETE here.)
      if (!node.routing && (val == null || val === '')) {
        trace.push({ node: id, answer: null, edge: null });
        return { terminal: 'INCOMPLETE', stoppedAt: id, reason: `No answer to: "${node.prompt}"`, transcript, trace };
      }
      if (node.routing && (val == null || val === '')) {
        trace.push({ node: id, answer: null, edge: null });
        return { terminal: 'INCOMPLETE', stoppedAt: id, reason: `Routing value missing: ${node.variable}`, transcript, trace };
      }
    } else if (node.type === 'root') {
      transcript.push({ agent: node.prompt, patient: 'yes (interested)' });
    }

    // deterministic branch: first edge whose `when` is true wins
    const scope = { ...A, ...consts, answer: val };
    const edge = (node.edges || []).find(e => evalWhen(e.when, scope) === true);
    trace.push({ node: id, answer: val ?? null, edge: edge ? (edge.label || edge.to) : null });
    if (!edge) return { terminal: 'INCOMPLETE', stoppedAt: id, reason: `No branch matched at ${id}`, transcript, trace };
    id = edge.to;
  }
  return { terminal: 'ERROR', reason: 'guard tripped (cycle?)', transcript, trace };
}

// --- pretty print one run ---
function show(name, answers) {
  const r = converse(flow, answers);
  console.log(`\n${'='.repeat(64)}\nPATIENT: ${name}   →   ${r.terminal}${r.reason ? '  (' + r.reason + ')' : ''}\n${'='.repeat(64)}`);
  for (const t of r.transcript) console.log(`  AGENT  : ${t.agent}\n  PATIENT: ${t.patient}`);
  console.log(`  ----\n  PATH: ${r.trace.map(t => t.node + (t.edge ? `─[${t.edge}]→` : '')).join(' ')}`);
  return r;
}

// --- demo patients (inline) covering all three terminals ---
show('Maria (fully eligible female)', {
  q1_age: 54, sex_at_birth: 'Female', q2_bmi: 'yes', q3_t2d: 'yes', q4_weightloss: 'yes',
  q5_glp1: 'no', q6_t1dm: 'no', q7_transplant: 'no', q8_gastric: 'no', q9_mtc: 'no', q10_pregnancy: 'no'
});
show('Dev (early knockout — no T2D)', {
  q1_age: 40, sex_at_birth: 'Male', q2_bmi: 'yes', q3_t2d: 'no'
});
show('Alison (pregnant → DNQ)', {
  q1_age: 33, sex_at_birth: 'Female', q2_bmi: 'yes', q3_t2d: 'yes', q4_weightloss: 'yes',
  q5_glp1: 'no', q6_t1dm: 'no', q7_transplant: 'no', q8_gastric: 'no', q9_mtc: 'no', q10_pregnancy: 'yes'
});

// --- real captured patient from disk (proves tie-in to live data) ---
const albertPath = path.join(DIR, '..', 'studies', 'WC45726', 'screening', 'Albert_Warren.json');
if (fs.existsSync(albertPath)) {
  show('Albert (real transcript extract)', JSON.parse(fs.readFileSync(albertPath, 'utf8')));
}
