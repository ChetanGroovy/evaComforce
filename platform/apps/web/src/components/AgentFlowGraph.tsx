/**
 * AgentFlowGraph — visual "Agent Flow" graph (DM Alleviate study flow view).
 *
 * Built on React Flow (@xyflow/react) + dagre auto-layout. Drop-in: same
 * `{ flow }` prop as before. Layout is computed by the pure `layoutFlow`
 * helper (flow-layout.ts); this component only renders + wires interactions
 * (pan / zoom / fit-view / minimap) which React Flow provides out of the box.
 */

import { useMemo, type JSX } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { StudyFlow } from '../types';
import { layoutFlow, type FlowRFNode } from './flow-layout';
import { flowNodeTypes } from './FlowNodes';

const MINIMAP_COLOR: Record<string, string> = {
  root: 'var(--border-bright)',
  question: 'var(--accent)',
  dnq: 'var(--border)',
  qualified: 'var(--green)',
};

function EmptyState(): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 240,
        gap: 10,
        color: 'var(--text-muted)',
        fontSize: 'var(--fs-base)',
      }}
    >
      <svg width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden="true">
        <circle cx="19" cy="19" r="17" stroke="var(--border)" strokeWidth="2" />
        <path d="M12 19h14M19 12v14" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" />
      </svg>
      No flow configured yet
    </div>
  );
}

export function AgentFlowGraph({ flow }: { flow: StudyFlow }): JSX.Element {
  const isEmpty = !flow || (flow.nodes?.length ?? 0) === 0;

  const { nodes, edges } = useMemo(
    () => (isEmpty ? { nodes: [] as FlowRFNode[], edges: [] } : layoutFlow(flow)),
    [flow, isEmpty],
  );

  if (isEmpty) return <EmptyState />;

  return (
    <div style={{ flex: 1, minHeight: 0, width: '100%' }} data-testid="agent-flow-graph">
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={flowNodeTypes}
          fitView
          fitViewOptions={{ padding: 0.2, maxZoom: 1.1 }}
          minZoom={0.18}
          maxZoom={2.5}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          panOnScroll
          zoomOnScroll
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={26} size={1} color="var(--border-subtle)" />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            nodeColor={(n) => MINIMAP_COLOR[n.type ?? 'question'] ?? 'var(--accent)'}
            maskColor="var(--bg-surface-translucent, rgba(0,0,0,0.05))"
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}
