import { describe, it, expect } from 'vitest';
import {
  layoutFlow,
  estimateNodeHeight,
  nodeTypeFor,
  NODE_MIN_H,
  DNQ_H,
  QUALIFIED_H,
} from './flow-layout';
import type { StudyFlow } from '../types';

// A realistic linear screening flow: root → q1 → q2 → qualified, each question
// branching to a DNQ knock-out.
const SAMPLE: StudyFlow = {
  nodes: [
    { id: 'root', type: 'root', label: 'Are you interested in this study?' },
    { id: 'q1_age', type: 'question', label: 'How old are you?' },
    {
      id: 'q2_tx',
      type: 'question',
      label:
        'Have you tried a medication for your psoriatic arthritis that did not control it well enough?',
    },
    { id: 'dnq_age', type: 'dnq', label: 'DNQ - Age under 18' },
    { id: 'dnq_tx', type: 'dnq', label: 'DNQ - treatment_history' },
    { id: 'qualified', type: 'qualified', label: 'Qualified' },
  ],
  edges: [
    { source: 'root', target: 'q1_age', label: 'Interested' },
    { source: 'q1_age', target: 'dnq_age', label: 'Under 18' },
    { source: 'q1_age', target: 'q2_tx', label: '18 or older' },
    { source: 'q2_tx', target: 'dnq_tx', label: 'No' },
    { source: 'q2_tx', target: 'qualified', label: 'Yes' },
  ],
};

describe('estimateNodeHeight', () => {
  it('returns fixed heights for dnq and qualified pills', () => {
    expect(estimateNodeHeight({ id: 'a', type: 'dnq', label: 'DNQ - x' })).toBe(DNQ_H);
    expect(estimateNodeHeight({ id: 'b', type: 'qualified', label: 'Qualified' })).toBe(QUALIFIED_H);
  });

  it('clamps a short question to the minimum box height', () => {
    expect(estimateNodeHeight({ id: 'q', type: 'question', label: 'Hi?' })).toBe(NODE_MIN_H);
  });

  it('grows with label length (long labels exceed the minimum)', () => {
    const longLabel = 'word '.repeat(60);
    const h = estimateNodeHeight({ id: 'q', type: 'question', label: longLabel });
    expect(h).toBeGreaterThan(NODE_MIN_H);
  });

  it('is monotonic — a longer label is never shorter', () => {
    const short = estimateNodeHeight({ id: 'a', type: 'question', label: 'a'.repeat(40) });
    const long = estimateNodeHeight({ id: 'b', type: 'question', label: 'a'.repeat(400) });
    expect(long).toBeGreaterThanOrEqual(short);
  });
});

describe('nodeTypeFor', () => {
  it('passes through known types', () => {
    for (const t of ['root', 'question', 'dnq', 'qualified']) {
      expect(nodeTypeFor(t)).toBe(t);
    }
  });
  it('falls back to question for unknown types', () => {
    expect(nodeTypeFor('mystery')).toBe('question');
    expect(nodeTypeFor('')).toBe('question');
  });
});

describe('layoutFlow', () => {
  it('returns empty for empty / null / undefined flow', () => {
    expect(layoutFlow({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
    expect(layoutFlow(null)).toEqual({ nodes: [], edges: [] });
    expect(layoutFlow(undefined)).toEqual({ nodes: [], edges: [] });
  });

  it('maps every node and assigns a custom node type', () => {
    const { nodes } = layoutFlow(SAMPLE);
    expect(nodes).toHaveLength(SAMPLE.nodes.length);
    const typeOf = (id: string) => nodes.find((n) => n.id === id)?.type;
    expect(typeOf('root')).toBe('root');
    expect(typeOf('q1_age')).toBe('question');
    expect(typeOf('dnq_age')).toBe('dnq');
    expect(typeOf('qualified')).toBe('qualified');
  });

  it('carries label + original type into node data', () => {
    const { nodes } = layoutFlow(SAMPLE);
    const q1 = nodes.find((n) => n.id === 'q1_age')!;
    expect(q1.data.label).toBe('How old are you?');
    expect(q1.data.nodeType).toBe('question');
  });

  it('gives every node a finite numeric position', () => {
    const { nodes } = layoutFlow(SAMPLE);
    for (const n of nodes) {
      expect(Number.isFinite(n.position.x)).toBe(true);
      expect(Number.isFinite(n.position.y)).toBe(true);
    }
  });

  it('lays the spine out top-to-bottom (root above q1 above q2 above qualified)', () => {
    const { nodes } = layoutFlow(SAMPLE);
    const y = (id: string) => {
      const n = nodes.find((nn) => nn.id === id);
      expect(n).toBeDefined();
      return n!.position.y;
    };
    expect(y('root')).toBeLessThan(y('q1_age'));
    expect(y('q1_age')).toBeLessThan(y('q2_tx'));
    expect(y('q2_tx')).toBeLessThan(y('qualified'));
  });

  it('produces non-overlapping spine nodes (vertical gap between consecutive)', () => {
    const { nodes } = layoutFlow(SAMPLE);
    const ys = ['root', 'q1_age', 'q2_tx', 'qualified']
      .map((id) => nodes.find((n) => n.id === id))
      .filter((n): n is NonNullable<typeof n> => n != null)
      .map((n) => n.position.y)
      .sort((a, b) => a - b);
    expect(ys).toHaveLength(4);
    for (let i = 1; i < ys.length; i++) {
      expect(ys[i]!).toBeGreaterThan(ys[i - 1]!);
    }
  });

  it('keeps all valid edges with unique ids', () => {
    const { edges } = layoutFlow(SAMPLE);
    expect(edges).toHaveLength(SAMPLE.edges.length);
    const ids = edges.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('passes edge labels through, blanks become undefined', () => {
    const { edges } = layoutFlow({
      nodes: [
        { id: 'a', type: 'root', label: 'A' },
        { id: 'b', type: 'question', label: 'B' },
      ],
      edges: [{ source: 'a', target: 'b', label: '' }],
    });
    expect(edges[0]?.label).toBeUndefined();
  });

  it('drops edges whose target node does not exist (dangling after delete)', () => {
    const broken: StudyFlow = {
      nodes: [
        { id: 'root', type: 'root', label: 'R' },
        { id: 'q1', type: 'question', label: 'Q1' },
      ],
      // q1 -> ghost points at a deleted question
      edges: [
        { source: 'root', target: 'q1', label: 'go' },
        { source: 'q1', target: 'ghost_deleted', label: 'next' },
      ],
    };
    const { edges } = layoutFlow(broken);
    expect(edges).toHaveLength(1);
    expect(edges[0]?.target).toBe('q1');
  });

  it('drops edges whose source node does not exist', () => {
    const broken: StudyFlow = {
      nodes: [{ id: 'q1', type: 'question', label: 'Q1' }],
      edges: [{ source: 'ghost', target: 'q1', label: 'x' }],
    };
    expect(layoutFlow(broken).edges).toHaveLength(0);
  });

  it('still positions orphan nodes (no edges) without throwing', () => {
    const orphans: StudyFlow = {
      nodes: [
        { id: 'root', type: 'root', label: 'R' },
        { id: 'lonely', type: 'question', label: 'unwired' },
      ],
      edges: [],
    };
    const { nodes } = layoutFlow(orphans);
    expect(nodes).toHaveLength(2);
    expect(nodes.every((n) => Number.isFinite(n.position.x))).toBe(true);
  });

  it('is deterministic — same input yields identical positions', () => {
    const a = layoutFlow(SAMPLE);
    const b = layoutFlow(SAMPLE);
    expect(a.nodes.map((n) => n.position)).toEqual(b.nodes.map((n) => n.position));
  });
});
