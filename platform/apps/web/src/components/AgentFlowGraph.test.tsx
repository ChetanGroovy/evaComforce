import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { AgentFlowGraph } from './AgentFlowGraph';
import type { StudyFlow } from '../types';

afterEach(cleanup);

const FLOW: StudyFlow = {
  nodes: [
    { id: 'root', type: 'root', label: 'Are you interested?' },
    { id: 'q1', type: 'question', label: 'How old are you?' },
    { id: 'qualified', type: 'qualified', label: 'Qualified' },
  ],
  edges: [
    { source: 'root', target: 'q1', label: 'Interested' },
    { source: 'q1', target: 'qualified', label: '18 or older' },
  ],
};

describe('AgentFlowGraph', () => {
  it('renders the empty state when there are no nodes', () => {
    render(<AgentFlowGraph flow={{ nodes: [], edges: [] }} />);
    expect(screen.getByText(/no flow configured yet/i)).toBeInTheDocument();
  });

  it('renders the canvas container for a non-empty flow without throwing', () => {
    render(<AgentFlowGraph flow={FLOW} />);
    expect(screen.getByTestId('agent-flow-graph')).toBeInTheDocument();
  });

  it('does not render the empty state for a non-empty flow', () => {
    render(<AgentFlowGraph flow={FLOW} />);
    expect(screen.queryByText(/no flow configured yet/i)).not.toBeInTheDocument();
  });
});
