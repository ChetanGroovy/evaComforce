// Derive the agent-flow graph deterministically from screeningQuestions so it can
// never desync. Add/remove a question -> rebuild -> flow stays correct. The previous
// behaviour (copying an upstream-authored flow verbatim) left dangling edges to
// deleted nodes and orphaned every question whose edge wasn't hand-updated.
//
// Ported verbatim (in behaviour) from studygen.mjs:1256-1294. The returned shape
// matches what studyDetail projects (studies.ts:170-181): nodes {id,type,label},
// edges {source,target,label}.

export interface FlowNode {
  id: string;
  type: string;
  label: string;
}

export interface FlowEdge {
  source: string;
  target: string;
  label: string;
}

export interface Flow {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

interface BranchLabels {
  fail: string;
  pass: string;
  dnq: string;
}

export function deriveFlow(screeningQuestions: any[], studyName: string): Flow {
  const qs = (screeningQuestions || [])
    .filter((q) => q.included_in_flow !== false)
    .slice()
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9));

  const nodes: FlowNode[] = [
    {
      id: 'root',
      type: 'root',
      label: studyName ? `Are you interested in ${studyName}?` : 'Are you interested in this study?',
    },
  ];
  const edges: FlowEdge[] = [];

  // pass/fail edge labels + DNQ label, read off disqualify_condition.
  //
  // branch() is intentionally answer_type-agnostic: it derives polarity SOLELY
  // from the textual disqualify_condition (age<N / ==no / ==yes / fallthrough)
  // and never inspects q.answer_type. A yes_no, choice, or numeric question all
  // flow through the same condition-string matching. This keeps the flow shape
  // a pure function of the disqualify grammar, decoupled from how the answer is
  // collected.
  const branch = (q: any): BranchLabels => {
    const cond = (q.disqualify_condition || '').toLowerCase().trim();
    if (/age\s*<\s*\d+/.test(cond)) {
      const n = (cond.match(/age\s*<\s*(\d+)/) || [])[1] || '18';
      return { fail: `Under ${n}`, pass: `${n} or older`, dnq: `DNQ - Age under ${n}` };
    }
    if (/==\s*no\b/.test(cond)) return { fail: 'No', pass: 'Yes', dnq: `DNQ - ${q.category || q.variable_name}` };
    if (/==\s*yes\b/.test(cond)) return { fail: 'Yes', pass: 'No', dnq: `DNQ - ${q.category || q.variable_name}` };
    return { fail: 'Disqualifies', pass: 'OK', dnq: `DNQ - ${q.category || q.variable_name}` };
  };

  qs.forEach((q, i) => {
    const id = q.variable_name;
    nodes.push({ id, type: 'question', label: q.sms_question || q.variable_name });
    edges.push({
      source: i === 0 ? 'root' : qs[i - 1].variable_name,
      target: id,
      label: i === 0 ? 'Interested' : branch(qs[i - 1]).pass,
    });

    if (q.disqualify_condition) {
      const b = branch(q);
      const dnqId = `dnq_${id}`;
      nodes.push({ id: dnqId, type: 'dnq', label: b.dnq });
      edges.push({ source: id, target: dnqId, label: b.fail });
    }
  });

  nodes.push({ id: 'qualified', type: 'qualified', label: 'Qualified' });
  if (qs.length) {
    edges.push({
      source: qs[qs.length - 1].variable_name,
      target: 'qualified',
      label: branch(qs[qs.length - 1]).pass,
    });
  }

  return { nodes, edges };
}
