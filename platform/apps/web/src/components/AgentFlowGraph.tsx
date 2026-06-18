/**
 * AgentFlowGraph — Component A
 * Visual "Agent Flow" graph replicating DM Alleviate's study flow view.
 *
 * Layout strategy:
 *   - Two-pass layout from the root node.
 *   - Pass 1: DFS visits spine nodes (root/question/qualified) in order,
 *     assigning them col=0 and incrementing a spine-row counter. DNQ nodes
 *     are skipped in pass 1.
 *   - Pass 2: each DNQ node gets col = source.col + DNQ_COL_OFFSET and
 *     row = source.row (same height as its question).
 *   - (col, row) → pixel (x, y) = (col * COL_GAP, row * ROW_GAP).
 *
 * Edges: orthogonal elbow connectors in SVG. Edge-label chips are SVG
 * <rect>+<text> pairs sitting at the midpoint of each connector.
 *
 * Pan + Zoom:
 *   - Wrapper div captures wheel events (zooms toward cursor).
 *   - Pointer-down on background starts a pan drag (pointer capture).
 *   - Toolbar: +  −  ⛶ (fit to view), positioned bottom-left.
 *   - Auto-fit to view on mount.
 */

import { useRef, useState, useCallback, useEffect, type JSX } from 'react';
import type { StudyFlow, FlowNode, FlowEdge } from '../types';

// ── Constants ─────────────────────────────────────────────────────────────────

const NODE_W = 190;           // node box width (px)
const NODE_H = 70;            // node box min-height
const COL_GAP = 265;          // horizontal distance between column centres
const ROW_GAP = 112;          // vertical distance between row centres
const DNQ_COL_OFFSET = 1.65;  // DNQ nodes sit this many COL_GAPs to the right of col 0
const TOOLBAR_BTN = 32;       // zoom toolbar button size (px)
const MIN_ZOOM = 0.18;
const MAX_ZOOM = 2.5;
const ZOOM_STEP = 0.15;

// ── Internal types ────────────────────────────────────────────────────────────

interface LayoutNode extends FlowNode {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface LayoutEdge extends FlowEdge {
  x1: number; y1: number;
  x2: number; y2: number;
}

interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  canvasW: number;
  canvasH: number;
  offsetX: number;
  offsetY: number;
}

// ── Layout engine (pure, no React) ────────────────────────────────────────────

function buildLayout(flow: StudyFlow): Layout {
  const { nodes, edges } = flow;

  // Adjacency map: source → edges[]
  const adj = new Map<string, FlowEdge[]>();
  for (const e of edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    adj.get(e.source)!.push(e);
  }

  // Node index
  const nodeMap = new Map<string, FlowNode>();
  for (const n of nodes) nodeMap.set(n.id, n);

  // Position map: id → {col, row}
  const pos = new Map<string, { col: number; row: number }>();
  let spineRow = 0;

  // Pass 1: DFS — only spine nodes (root / question / qualified)
  const visited = new Set<string>();
  function visit(id: string): void {
    if (visited.has(id)) return;
    visited.add(id);
    const node = nodeMap.get(id);
    if (!node) return;
    if (node.type !== 'dnq') {
      pos.set(id, { col: 0, row: spineRow++ });
    }
    for (const e of adj.get(id) ?? []) {
      const child = nodeMap.get(e.target);
      if (child && child.type !== 'dnq') visit(e.target);
    }
  }

  const root = nodes.find((n) => n.type === 'root') ?? nodes[0];
  if (root) visit(root.id);

  // Pass 2: DNQ nodes — placed at (DNQ_COL_OFFSET, source.row)
  // Slot counter handles multiple DNQs from the same source
  const slotCounter = new Map<number, number>(); // sourceRow → next slot index
  for (const e of edges) {
    const tgtNode = nodeMap.get(e.target);
    if (!tgtNode || tgtNode.type !== 'dnq') continue;
    if (pos.has(e.target)) continue; // already placed

    const srcPos = pos.get(e.source);
    if (!srcPos) continue;

    const slot = slotCounter.get(srcPos.row) ?? 0;
    slotCounter.set(srcPos.row, slot + 1);
    pos.set(e.target, { col: DNQ_COL_OFFSET + slot * 0.9, row: srcPos.row });
  }

  // Pass 3: orphan nodes (added but not yet wired into the flow, or unreachable
  // from root) — stack them in a spare column to the far right so they never pile
  // on top of the root node.
  const ORPHAN_COL = DNQ_COL_OFFSET + 3;
  let orphanRow = 0;
  for (const n of nodes) {
    if (pos.has(n.id)) continue;
    pos.set(n.id, { col: ORPHAN_COL, row: orphanRow++ });
  }

  // Build LayoutNodes
  const lNodes: LayoutNode[] = nodes.map((n) => {
    const p = pos.get(n.id) ?? { col: 0, row: 0 };
    return { ...n, x: p.col * COL_GAP, y: p.row * ROW_GAP, w: NODE_W, h: NODE_H };
  });

  const lMap = new Map<string, LayoutNode>();
  for (const ln of lNodes) lMap.set(ln.id, ln);

  // Build LayoutEdges
  const lEdges: LayoutEdge[] = edges.flatMap((e) => {
    const src = lMap.get(e.source);
    const tgt = lMap.get(e.target);
    if (!src || !tgt) return [];
    return [{
      ...e,
      x1: src.x + src.w / 2,
      y1: src.y + src.h,
      x2: tgt.x + tgt.w / 2,
      y2: tgt.y,
    }];
  });

  // Canvas bounds (with 40px padding)
  const PAD = 40;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of lNodes) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w);
    maxY = Math.max(maxY, n.y + n.h);
  }

  return {
    nodes: lNodes,
    edges: lEdges,
    canvasW: maxX - minX + PAD * 2,
    canvasH: maxY - minY + PAD * 2,
    offsetX: -minX + PAD,
    offsetY: -minY + PAD,
  };
}

// ── SVG edge path helper ──────────────────────────────────────────────────────

function elbowPath(x1: number, y1: number, x2: number, y2: number): string {
  if (Math.abs(x1 - x2) < 3) {
    return `M${x1} ${y1}L${x2} ${y2}`;
  }
  const mid = (y1 + y2) / 2;
  return `M${x1} ${y1}L${x1} ${mid}L${x2} ${mid}L${x2} ${y2}`;
}

// ── Node styling ──────────────────────────────────────────────────────────────

function nodeStyle(type: string): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: NODE_W,
    minHeight: NODE_H,
    boxSizing: 'border-box',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: '10px 14px',
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1.4,
    fontFamily: 'var(--font-sans)',
    wordBreak: 'break-word',
    boxShadow: 'var(--shadow-sm)',
    userSelect: 'none',
    cursor: 'default',
    borderRadius: 12,
  };

  switch (type) {
    case 'root':
      return {
        ...base,
        background: 'var(--bg-elevated)',
        border: '1.5px solid var(--border-bright)',
        color: 'var(--text-secondary)',
        fontWeight: 600,
        borderRadius: 20,
      };
    case 'question':
      return {
        ...base,
        background: 'rgba(91,142,240,0.12)',
        border: '1.5px solid rgba(91,142,240,0.45)',
        color: 'var(--text-primary)',
      };
    case 'dnq':
      return {
        ...base,
        background: 'var(--bg-card)',
        border: '1.5px solid var(--border)',
        color: 'var(--text-secondary)',
        fontWeight: 600,
        borderRadius: 999,
        fontSize: 11,
        padding: '7px 16px',
        minHeight: 36,
        height: 36,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      };
    case 'qualified':
      return {
        ...base,
        background: 'var(--green-soft)',
        border: '1.5px solid var(--green-border)',
        color: 'var(--green)',
        fontWeight: 700,
        borderRadius: 999,
        padding: '8px 24px',
        minHeight: 38,
        height: 38,
      };
    default:
      return base;
  }
}

// ── Text width estimate for SVG chips ─────────────────────────────────────────

function chipWidth(text: string): number {
  const t = text.length > 28 ? text.slice(0, 26) + '…' : text;
  return Math.max(44, t.length * 5.6);
}

function chipLabel(text: string): string {
  return text.length > 28 ? text.slice(0, 26) + '…' : text;
}

// ── Main component ────────────────────────────────────────────────────────────

export function AgentFlowGraph({ flow }: { flow: StudyFlow }): JSX.Element {
  const isEmpty = !flow || flow.nodes.length === 0;

  // Compute layout (cheap; only re-runs when flow changes)
  const layout: Layout = isEmpty
    ? { nodes: [], edges: [], canvasW: 400, canvasH: 300, offsetX: 0, offsetY: 0 }
    : buildLayout(flow);

  // Pan + zoom state
  const [tx, setTx] = useState(40);
  const [ty, setTy] = useState(40);
  const [scale, setScale] = useState(1);

  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const lastPt = useRef({ x: 0, y: 0 });

  const fitToView = useCallback(() => {
    if (!containerRef.current) return;
    const { clientWidth: cw, clientHeight: ch } = containerRef.current;
    const s = Math.max(
      MIN_ZOOM,
      Math.min(MAX_ZOOM, 1.1, (cw - 80) / layout.canvasW, (ch - 80) / layout.canvasH),
    );
    setScale(s);
    setTx((cw - layout.canvasW * s) / 2);
    setTy((ch - layout.canvasH * s) / 2);
  }, [layout.canvasW, layout.canvasH]);

  // Auto-fit on mount / when flow changes
  useEffect(() => {
    fitToView();
  }, [fitToView]);

  // Wheel zoom (cursor-centred). Registered as a NATIVE non-passive listener so
  // preventDefault() is allowed (React's onWheel is passive → console warning).
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setScale((prev) => {
        const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + dir * ZOOM_STEP));
        const f = next / prev;
        setTx((ptx) => mx - (mx - ptx) * f);
        setTy((pty) => my - (my - pty) * f);
        return next;
      });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, []);

  // Pan drag
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('.afg-node, button')) return;
    dragging.current = true;
    lastPt.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    setTx((p) => p + e.clientX - lastPt.current.x);
    setTy((p) => p + e.clientY - lastPt.current.y);
    lastPt.current = { x: e.clientX, y: e.clientY };
  }, []);

  const stopDrag = useCallback(() => { dragging.current = false; }, []);

  const zoomIn  = useCallback(() => setScale((p) => Math.min(MAX_ZOOM, p + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setScale((p) => Math.max(MIN_ZOOM, p - ZOOM_STEP)), []);

  // ── Render ─────────────────────────────────────────────────────────────────

  if (isEmpty) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', minHeight: 240,
        gap: 10, color: 'var(--text-muted)', fontSize: 14,
      }}>
        <svg width="38" height="38" viewBox="0 0 38 38" fill="none" aria-hidden="true">
          <circle cx="19" cy="19" r="17" stroke="var(--border)" strokeWidth="2" />
          <path d="M12 19h14M19 12v14" stroke="var(--border)" strokeWidth="2" strokeLinecap="round" />
        </svg>
        No flow configured yet
      </div>
    );
  }

  const { nodes: lNodes, edges: lEdges, canvasW, canvasH, offsetX, offsetY } = layout;
  const svgW = canvasW;
  const svgH = canvasH;

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={stopDrag}
      onPointerLeave={stopDrag}
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        overflow: 'hidden',
        background: 'var(--bg-surface)',
        borderRadius: 'var(--radius)',
        userSelect: 'none',
        cursor: dragging.current ? 'grabbing' : 'grab',
      }}
    >
      {/* Dot-grid background */}
      <div
        aria-hidden="true"
        style={{
          position: 'absolute', inset: 0, pointerEvents: 'none', opacity: 0.55,
          backgroundImage: 'radial-gradient(circle, var(--border-subtle) 1px, transparent 1px)',
          backgroundSize: '26px 26px',
        }}
      />

      {/* Zoomable / pannable canvas */}
      <div
        style={{
          position: 'absolute',
          transform: `translate(${tx}px,${ty}px) scale(${scale})`,
          transformOrigin: '0 0',
          width: svgW,
          height: svgH,
        }}
      >
        {/* ── SVG: edges + label chips ─────────────────────────────── */}
        <svg
          width={svgW}
          height={svgH}
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none' }}
          aria-hidden="true"
        >
          <defs>
            <marker id="afg-arr" markerWidth="7" markerHeight="7" refX="5" refY="3" orient="auto">
              <path d="M0 0L0 6L7 3z" fill="var(--border-bright)" />
            </marker>
          </defs>

          {lEdges.map((e, i) => {
            const x1 = e.x1 + offsetX;
            const y1 = e.y1 + offsetY;
            const x2 = e.x2 + offsetX;
            const y2 = e.y2 + offsetY;
            const mx = (x1 + x2) / 2;
            const my = (y1 + y2) / 2;
            const d = elbowPath(x1, y1, x2, y2);
            const cw2 = chipWidth(e.label);
            const cl = chipLabel(e.label);

            return (
              <g key={i}>
                <path
                  d={d}
                  fill="none"
                  stroke="var(--border-bright)"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  markerEnd="url(#afg-arr)"
                />
                {e.label && (
                  <>
                    <rect
                      x={mx - cw2 / 2 - 5}
                      y={my - 9}
                      width={cw2 + 10}
                      height={19}
                      rx={9}
                      fill="var(--bg-card)"
                      stroke="var(--border)"
                      strokeWidth="0.9"
                    />
                    <text
                      x={mx}
                      y={my + 4.5}
                      textAnchor="middle"
                      fill="var(--text-secondary)"
                      fontSize="9.5"
                      fontFamily="var(--font-sans)"
                      fontWeight="500"
                    >
                      {cl}
                    </text>
                  </>
                )}
              </g>
            );
          })}
        </svg>

        {/* ── Node divs ────────────────────────────────────────────── */}
        {lNodes.map((n) => (
          <div
            key={n.id}
            className="afg-node"
            title={n.label}
            style={{
              ...nodeStyle(n.type),
              left: n.x + offsetX,
              top: n.y + offsetY,
            }}
          >
            {/* Small badge above question / root nodes */}
            {(n.type === 'question' || n.type === 'root') && (
              <span
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  top: -9,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: 8.5,
                  fontWeight: 700,
                  textTransform: 'uppercase' as const,
                  letterSpacing: 0.5,
                  padding: '1px 7px',
                  borderRadius: 8,
                  whiteSpace: 'nowrap',
                  background: n.type === 'root'
                    ? 'var(--bg-surface)'
                    : 'rgba(91,142,240,0.18)',
                  color: n.type === 'root'
                    ? 'var(--text-muted)'
                    : 'var(--accent)',
                  border: '1px solid',
                  borderColor: n.type === 'root'
                    ? 'var(--border)'
                    : 'rgba(91,142,240,0.28)',
                }}
              >
                {n.type === 'root' ? 'START' : 'Q'}
              </span>
            )}
            <span style={{ display: 'block', width: '100%' }}>
              {n.label}
            </span>
          </div>
        ))}
      </div>

      {/* ── Zoom toolbar (bottom-left) ────────────────────────────────── */}
      <div
        style={{
          position: 'absolute', bottom: 16, left: 16,
          display: 'flex', flexDirection: 'column', gap: 4, zIndex: 20,
        }}
      >
        {(
          [
            { key: '+',  label: '+',  title: 'Zoom in',    fn: zoomIn  },
            { key: '-',  label: '−', title: 'Zoom out', fn: zoomOut },
            { key: 'fit', label: '⛶', title: 'Fit to view', fn: fitToView },
          ] as const
        ).map(({ key, label, title, fn }) => (
          <button
            key={key}
            title={title}
            onClick={fn}
            style={{
              width: TOOLBAR_BTN,
              height: TOOLBAR_BTN,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
              fontSize: key === 'fit' ? 13 : 17,
              lineHeight: 1,
              fontWeight: 400,
              cursor: 'pointer',
              boxShadow: 'var(--shadow-xs)',
              fontFamily: 'var(--font-sans)',
              padding: 0,
              transition: 'background 0.1s, color 0.1s',
            }}
            onMouseEnter={(ev) => {
              ev.currentTarget.style.background = 'var(--bg-elevated)';
              ev.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(ev) => {
              ev.currentTarget.style.background = 'var(--bg-card)';
              ev.currentTarget.style.color = 'var(--text-secondary)';
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Zoom % indicator (bottom-right) ──────────────────────────── */}
      <div
        style={{
          position: 'absolute', bottom: 18, right: 16, zIndex: 20,
          fontSize: 10, fontWeight: 600,
          color: 'var(--text-faint)',
          fontFamily: 'var(--font-mono)',
          userSelect: 'none',
        }}
      >
        {Math.round(scale * 100)}%
      </div>
    </div>
  );
}
