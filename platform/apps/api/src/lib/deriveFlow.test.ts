import { describe, it, expect } from 'vitest';
import { deriveFlow } from './deriveFlow';

// Small inline fixture exercising each branch() polarity:
//   q_age  -> age<18      (age branch)
//   q_no   -> answer == no (inverted-framing knockout)
//   q_yes  -> answer == yes (cornea-style carve-out)
const FIXTURE = [
  { variable_name: 'q_age', rank: 1, sms_question: 'How old are you?', disqualify_condition: 'age < 18' },
  { variable_name: 'q_no', rank: 2, sms_question: 'Can you attend visits?', disqualify_condition: 'answer == no', category: 'Logistics' },
  { variable_name: 'q_yes', rank: 3, sms_question: 'Any organ transplant?', disqualify_condition: 'answer == yes', category: 'Exclusion' },
];

describe('deriveFlow', () => {
  const { nodes, edges } = deriveFlow(FIXTURE, 'Test Study');

  it('emits root + question + dnq + qualified nodes', () => {
    // root + 3 question + 3 dnq + qualified
    expect(nodes).toHaveLength(8);
    expect(nodes[0]).toEqual({ id: 'root', type: 'root', label: 'Are you interested in Test Study?' });
    expect(nodes.filter((n) => n.type === 'question')).toHaveLength(3);
    expect(nodes.filter((n) => n.type === 'dnq')).toHaveLength(3);
    expect(nodes.filter((n) => n.type === 'qualified')).toHaveLength(1);
  });

  it('emits entry + dnq + qualified edges', () => {
    // 3 entry edges + 3 dnq edges + 1 qualified edge
    expect(edges).toHaveLength(7);
  });

  it('labels the age branch with "Under N" fail / "N or older" pass', () => {
    const ageDnqEdge = edges.find((e) => e.target === 'dnq_q_age');
    expect(ageDnqEdge?.label).toBe('Under 18');
    // pass label of q_age is the entry label into the next question (q_no)
    const afterAge = edges.find((e) => e.source === 'q_age' && e.target === 'q_no');
    expect(afterAge?.label).toBe('18 or older');
    const ageDnqNode = nodes.find((n) => n.id === 'dnq_q_age');
    expect(ageDnqNode?.label).toBe('DNQ - Age under 18');
  });

  it('labels the == no branch with "No" fail / "Yes" pass', () => {
    const noDnqEdge = edges.find((e) => e.target === 'dnq_q_no');
    expect(noDnqEdge?.label).toBe('No');
    const afterNo = edges.find((e) => e.source === 'q_no' && e.target === 'q_yes');
    expect(afterNo?.label).toBe('Yes');
  });

  it('labels the == yes branch with "Yes" fail / "No" pass', () => {
    const yesDnqEdge = edges.find((e) => e.target === 'dnq_q_yes');
    expect(yesDnqEdge?.label).toBe('Yes');
    // q_yes is last -> its pass label flows into the qualified node
    const qualifiedEdge = edges.find((e) => e.target === 'qualified');
    expect(qualifiedEdge?.source).toBe('q_yes');
    expect(qualifiedEdge?.label).toBe('No');
  });

  it('labels the first entry edge "Interested" from root', () => {
    const firstEdge = edges.find((e) => e.source === 'root');
    expect(firstEdge?.target).toBe('q_age');
    expect(firstEdge?.label).toBe('Interested');
  });
});
