# Agent Flow Graph — SDLC & Production Readiness

Visual study-flow graph on the **Agent Flow** tab. Migrated from a hand-rolled
SVG/absolute-position component to **React Flow (`@xyflow/react` v12)** with
**dagre (`@dagrejs/dagre` v3)** auto-layout.

---

## 1. Requirements

| # | Requirement | Status |
|---|---|---|
| R1 | Render a study flow (`{nodes, edges}`) as a directed graph: root → questions → DNQ knock-outs / Qualified | ✅ |
| R2 | No node overlap regardless of label length or question count | ✅ (dagre, height-aware) |
| R3 | Survive malformed flows — dangling edges after a question is deleted must not crash or orphan the spine | ✅ (`layoutFlow` drops invalid edges) |
| R4 | Pan, zoom, fit-to-view, minimap | ✅ (React Flow built-ins) |
| R5 | Read-only (no node drag / connect / select) — this is a viewer, edits go through the Routing modal | ✅ |
| R6 | Preserve existing node visual language (root pill, Q badge, DNQ pills, green Qualified) | ✅ (custom node types) |
| R7 | Drop-in: same `<AgentFlowGraph flow={...} />` prop contract | ✅ |

## 2. Architecture

```
StudyDetailPage
  └─ <AgentFlowGraph flow={study.flow} />     components/AgentFlowGraph.tsx  (render + interactions)
        ├─ layoutFlow(flow)                    components/flow-layout.ts      (PURE: flow → positioned RF graph)
        └─ flowNodeTypes                        components/FlowNodes.tsx       (custom node visuals)
```

- **`flow-layout.ts`** — pure, no React/DOM. Translates `StudyFlow` → React Flow
  `nodes`/`edges`, estimates each box's height from its label, runs dagre
  (top-to-bottom layered layout) for collision-free positions. This is where all
  the testable logic lives.
- **`FlowNodes.tsx`** — four custom node components (`root`/`question`/`dnq`/
  `qualified`) with hidden handles. Pure presentation.
- **`AgentFlowGraph.tsx`** — thin wrapper: `<ReactFlow>` + `<Background>` +
  `<Controls>` + `<MiniMap>`, `fitView`, read-only flags. ~110 lines (was ~580).

### Why a library
The hand-rolled version reinvented pan/zoom/fit (~300 lines) and did naive
layout — it shipped overlap bugs (tall questions colliding with the next node),
orphan-pile bugs, and edges routed through nodes. dagre solves layout; React
Flow solves interaction. Net: fewer lines, fewer bug classes.

## 3. Testing

| Layer | File | Coverage |
|---|---|---|
| Unit (logic) | `flow-layout.test.ts` | 18 tests — type mapping, height estimate (fixed pills, min clamp, monotonic growth), TB ordering, non-overlap, **dangling-edge drop (both directions)**, orphan placement, label passthrough, determinism |
| Component (smoke) | `AgentFlowGraph.test.tsx` | 3 tests — empty state, non-empty mounts without throw, empty-state absent when populated |

- Runner: **Vitest** + **jsdom** + **@testing-library/react**.
- `src/test/setup.ts` stubs `ResizeObserver`, `DOMMatrixReadOnly`, and
  `getBoundingClientRect` so React Flow mounts under jsdom.
- Heavy assertions live on the **pure** `layoutFlow` (deterministic, no DOM) —
  component tests stay smoke-level to avoid jsdom-layout flakiness.

```bash
pnpm --filter @comforceeva/web test            # run once
pnpm --filter @comforceeva/web test:watch      # watch
pnpm --filter @comforceeva/web test:coverage   # v8 coverage
pnpm --filter @comforceeva/web typecheck:test  # typecheck test files (separate tsconfig)
```

Test files are excluded from the production build tsconfig (`tsconfig.json`) and
typechecked separately via `tsconfig.test.json` (adds vitest/jest-dom types).

## 4. CI

`.github/workflows/web-ci.yml` — on push/PR touching `platform/**`:
typecheck (all packages) → typecheck tests (web) → unit tests → production build.
pnpm 9 + Node 20, frozen lockfile.

## 5. Rollout / Rollback

- **Drop-in** — no API or `study.json` schema change. The prop contract
  (`{ flow: StudyFlow }`) is unchanged; only the renderer was swapped.
- **Rollback** — revert the `AgentFlowGraph.tsx` / `flow-layout.ts` /
  `FlowNodes.tsx` commit and `pnpm install`. No data migration to undo.
- **Bundle impact** — web JS ~64 KB → ~137 KB gzipped (+73 KB for the canvas
  lib). Acceptable for an internal tool; see Follow-ups for code-splitting.

## 6. Production-readiness checklist

- [x] Drop-in prop contract preserved (R7)
- [x] Handles empty / null / undefined flow (no crash)
- [x] Handles malformed flow — dangling edges dropped (R3)
- [x] Deterministic layout (snapshot-stable, no `Math.random`/`Date.now`)
- [x] Read-only viewer (no accidental edits)
- [x] Unit + component tests green (21)
- [x] `typecheck`, `typecheck:test`, production `build` all pass
- [x] CI workflow gating the above
- [ ] Code-split React Flow (lazy-load the Agent Flow tab) — see Follow-ups
- [ ] Visual regression / a11y audit (keyboard nav, ARIA on canvas)

## 7. Follow-ups (non-blocking)

1. **Code-split** — `React.lazy` the Agent Flow tab so the canvas lib loads only
   when the tab opens; trims the main bundle back toward baseline.
2. **DNQ side-routing** — optionally pin DNQ pills to the right of their source
   (dagre rank constraints) to mirror DM Alleviate's exact aesthetic.
3. **A11y** — the canvas is mouse-first; add keyboard pan/zoom + an accessible
   text fallback (ordered list of the flow) for screen readers.
4. **Auto-wire new questions** — when the Routing modal adds a question, default
   its incoming edge so it isn't a momentary orphan.
