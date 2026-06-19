/**
 * FlowNodes — custom React Flow node components.
 *
 * Visuals match the previous hand-rolled graph (root / question / dnq /
 * qualified). Each node carries hidden top/bottom handles so React Flow can
 * attach edges; positioning is handled by dagre (see flow-layout.ts).
 */

import { Handle, Position, type NodeProps } from '@xyflow/react';
import type { CSSProperties, JSX } from 'react';
import { NODE_W } from './flow-layout';

// ── Shared box style ────────────────────────────────────────────────────────
const base: CSSProperties = {
  width: NODE_W,
  boxSizing: 'border-box',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  textAlign: 'center',
  padding: '10px 14px',
  fontSize: 'var(--fs-sm)',
  fontWeight: 500,
  lineHeight: 1.4,
  fontFamily: 'var(--font-sans)',
  wordBreak: 'break-word',
  boxShadow: 'var(--shadow-sm)',
  userSelect: 'none',
  cursor: 'default',
  borderRadius: 12,
};

// Hidden handles — present so edges connect, invisible to the user.
const hiddenHandle: CSSProperties = {
  opacity: 0,
  width: 1,
  height: 1,
  minWidth: 0,
  minHeight: 0,
  border: 'none',
  background: 'transparent',
  pointerEvents: 'none',
};

function Badge({ kind }: { kind: 'root' | 'question' }): JSX.Element {
  const isRoot = kind === 'root';
  return (
    <span
      aria-hidden="true"
      style={{
        position: 'absolute',
        top: -9,
        left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 'var(--fs-2xs)',
        fontWeight: 700,
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        padding: '1px 7px',
        borderRadius: 8,
        whiteSpace: 'nowrap',
        background: isRoot ? 'var(--bg-surface)' : 'var(--accent-soft)',
        color: isRoot ? 'var(--text-muted)' : 'var(--accent)',
        border: '1px solid',
        borderColor: isRoot ? 'var(--border)' : 'var(--accent-border)',
      }}
    >
      {isRoot ? 'START' : 'Q'}
    </span>
  );
}

function Handles({ target = true, source = true }: { target?: boolean; source?: boolean }): JSX.Element {
  return (
    <>
      {target && <Handle type="target" position={Position.Top} style={hiddenHandle} isConnectable={false} />}
      {source && <Handle type="source" position={Position.Bottom} style={hiddenHandle} isConnectable={false} />}
    </>
  );
}

type FlowNodeProps = NodeProps & { data: { label: string } };

function RootNode({ data }: FlowNodeProps): JSX.Element {
  return (
    <div
      style={{
        ...base,
        position: 'relative',
        background: 'var(--bg-elevated)',
        border: '1.5px solid var(--border-bright)',
        color: 'var(--text-secondary)',
        fontWeight: 600,
        borderRadius: 20,
      }}
      title={data.label}
    >
      <Badge kind="root" />
      <span style={{ display: 'block', width: '100%' }}>{data.label}</span>
      <Handles target={false} />
    </div>
  );
}

function QuestionNode({ data }: FlowNodeProps): JSX.Element {
  return (
    <div
      style={{
        ...base,
        position: 'relative',
        background: 'var(--accent-soft)',
        border: '1.5px solid var(--accent-border)',
        color: 'var(--text-primary)',
      }}
      title={data.label}
    >
      <Badge kind="question" />
      <span style={{ display: 'block', width: '100%' }}>{data.label}</span>
      <Handles />
    </div>
  );
}

function DnqNode({ data }: FlowNodeProps): JSX.Element {
  return (
    <div
      style={{
        ...base,
        width: 'auto',
        maxWidth: 220,
        position: 'relative',
        background: 'var(--bg-card)',
        border: '1.5px solid var(--border)',
        color: 'var(--text-secondary)',
        fontWeight: 600,
        borderRadius: 999,
        fontSize: 'var(--fs-xs)',
        padding: '7px 16px',
        minHeight: 36,
        height: 36,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
      title={data.label}
    >
      <span
        style={{
          display: 'block',
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {data.label}
      </span>
      <Handles source={false} />
    </div>
  );
}

function QualifiedNode({ data }: FlowNodeProps): JSX.Element {
  return (
    <div
      style={{
        ...base,
        width: 'auto',
        position: 'relative',
        background: 'var(--green-soft)',
        border: '1.5px solid var(--green-border)',
        color: 'var(--green)',
        fontWeight: 700,
        borderRadius: 999,
        padding: '8px 24px',
        minHeight: 38,
        height: 38,
      }}
      title={data.label}
    >
      <span style={{ display: 'block' }}>{data.label}</span>
      <Handles source={false} />
    </div>
  );
}

export const flowNodeTypes = {
  root: RootNode,
  question: QuestionNode,
  dnq: DnqNode,
  qualified: QualifiedNode,
} as const;
