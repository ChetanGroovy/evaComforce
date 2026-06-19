/**
 * flow-layout — pure flow → React Flow translation + dagre auto-layout.
 *
 * Kept free of React/DOM so it is unit-testable in plain Node (dagre is
 * deterministic). The component layer (AgentFlowGraph) only renders the output.
 *
 *   layoutFlow(studyFlow) → { nodes, edges } positioned for <ReactFlow/>
 *
 * Responsibilities:
 *   - Drop edges whose endpoints don't exist (a destination left dangling after
 *     a question was deleted) — would otherwise crash / orphan the graph.
 *   - Estimate each box's rendered height so dagre stacks without overlap.
 *   - Run dagre (top-to-bottom layered layout) → collision-free positions.
 */

import dagre from '@dagrejs/dagre';
import { MarkerType, type Edge, type Node } from '@xyflow/react';
import type { StudyFlow, FlowNode } from '../types';

// ── Geometry constants (exported for tests) ────────────────────────────────
export const NODE_W = 190; // question/root box width (px)
export const NODE_MIN_H = 70; // question/root min height
export const DNQ_H = 36; // dnq pill height
export const QUALIFIED_H = 38; // qualified pill height

const DAGRE = { rankdir: 'TB', nodesep: 48, ranksep: 64, marginx: 20, marginy: 20 };

// ── Node data carried into the custom React node components ─────────────────
export interface FlowNodeData extends Record<string, unknown> {
  label: string;
  nodeType: string; // original flow type: root | question | dnq | qualified
}
export type FlowRFNode = Node<FlowNodeData>;

/** Registered custom-node keys; anything unknown renders as a question box. */
const KNOWN_TYPES = new Set(['root', 'question', 'dnq', 'qualified']);
export function nodeTypeFor(type: string): string {
  return KNOWN_TYPES.has(type) ? type : 'question';
}

/**
 * Estimate rendered height from the label so dagre reserves the right vertical
 * space. Question/root wrap at NODE_W; dnq/qualified are fixed-size pills.
 */
export function estimateNodeHeight(node: FlowNode): number {
  if (node.type === 'dnq') return DNQ_H;
  if (node.type === 'qualified') return QUALIFIED_H;
  const innerW = NODE_W - 28; // minus 14px horizontal padding each side
  const charW = 6.6; // ~avg glyph width at fs-sm / weight 500
  const charsPerLine = Math.max(1, Math.floor(innerW / charW));
  const label = node.label ?? '';
  const lines = Math.max(1, Math.ceil(label.length / charsPerLine));
  const lineH = 18.2; // 13px * 1.4 line-height
  return Math.max(NODE_MIN_H, Math.round(lines * lineH + 20)); // +10px padding top/bottom
}

export interface LayoutResult {
  nodes: FlowRFNode[];
  edges: Edge[];
}

export function layoutFlow(flow: StudyFlow | null | undefined): LayoutResult {
  const nodes = flow?.nodes ?? [];
  const rawEdges = flow?.edges ?? [];
  if (nodes.length === 0) return { nodes: [], edges: [] };

  // Drop edges pointing at non-existent nodes (defensive — see studies bug).
  const ids = new Set(nodes.map((n) => n.id));
  const validEdges = rawEdges.filter((e) => ids.has(e.source) && ids.has(e.target));

  // Dagre layout
  const g = new dagre.graphlib.Graph();
  g.setGraph(DAGRE);
  g.setDefaultEdgeLabel(() => ({}));

  const dims = new Map<string, { w: number; h: number }>();
  for (const n of nodes) {
    const h = estimateNodeHeight(n);
    dims.set(n.id, { w: NODE_W, h });
    g.setNode(n.id, { width: NODE_W, height: h });
  }
  for (const e of validEdges) g.setEdge(e.source, e.target);
  dagre.layout(g);

  // Dagre returns node centres; React Flow wants top-left.
  const rfNodes: FlowRFNode[] = nodes.map((n) => {
    const p = g.node(n.id);
    const d = dims.get(n.id)!;
    const cx = p?.x ?? 0;
    const cy = p?.y ?? 0;
    return {
      id: n.id,
      type: nodeTypeFor(n.type),
      position: { x: cx - d.w / 2, y: cy - d.h / 2 },
      data: { label: n.label, nodeType: n.type },
      draggable: false,
      connectable: false,
      selectable: false,
    };
  });

  const rfEdges: Edge[] = validEdges.map((e, i) => ({
    id: `${e.source}__${e.target}__${i}`,
    source: e.source,
    target: e.target,
    label: e.label || undefined,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color: 'var(--border-bright)' },
    style: { stroke: 'var(--border-bright)', strokeWidth: 1.5 },
    labelStyle: { fill: 'var(--text-secondary)', fontSize: 10, fontWeight: 500 },
    labelBgPadding: [6, 3],
    labelBgBorderRadius: 9,
    labelBgStyle: { fill: 'var(--bg-card)', stroke: 'var(--border)', strokeWidth: 0.9 },
  }));

  return { nodes: rfNodes, edges: rfEdges };
}
