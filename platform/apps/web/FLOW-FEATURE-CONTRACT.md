# Agent Flow + Question Routing — component contract (build to this EXACTLY)

Replicates DM Alleviate's study page: a visual **Agent Flow** graph + an editable **Question Routing** modal.
Two self-contained components. The host page (StudyDetailPage) and App navigation are built separately — you
only build your one component file to the props below. Match Alleviate's look (see the reference screenshots
the user shared: light/airy graph with rounded nodes; blue = question, grey/dark = DNQ, green = Qualified;
white edge-label chips on the connectors).

## Shared data (from src/types.ts — already defined, import these)
```ts
FlowNode  = { id: string; type: string; label: string }   // type: 'root'|'question'|'dnq'|'qualified'
FlowEdge  = { source: string; target: string; label: string }
StudyFlow = { nodes: FlowNode[]; edges: FlowEdge[] }
ScreeningQuestionFull = { rank; variable_name; sms_question; answer_type; choices?; category?;
                          disqualify_condition?; qualify_condition?; show_if?; routing?; criteria_ids?; ... }
StudyDetail = { id; name; ... ; flow?: StudyFlow; screeningQuestions?: ScreeningQuestionFull[] }
```
Node id convention: a question node's `id` == its `variable_name`. Terminals: dnq nodes ids like `dnq_*`,
the qualified node id `qualified`, root id `root`. Edges connect node ids; `edge.label` = the human answer
description (e.g. "Patient is at least 18 years old").

## API (already live)
- `GET  /api/studies/:id` returns `StudyDetail` incl. `flow` + `screeningQuestions`.
- `POST /api/studies/:id/update` accepts `{ screeningQuestions?: [...], flow?: { nodes, edges } }`, persists, returns the updated `StudyDetail`. Use `updateStudy(id, patch)` from `src/api.ts`.

## Styling
Use the existing CSS design tokens (var(--bg-card), --bg-surface, --border, --text-primary/secondary/muted,
--accent, --green, --red, --radius*, --shadow*). Must work in BOTH dark and light theme (no hardcoded hex
except brand gradients). Add component CSS to a co-located block (you may append to src/index.css or use inline
styles with tokens — match how existing components do it, e.g. StudyPicker uses inline styles with var()).

---

## Component A — `src/components/AgentFlowGraph.tsx`  (READ-ONLY visual graph)
```ts
export function AgentFlowGraph({ flow }: { flow: StudyFlow }): JSX.Element
```
- Top-down layered layout starting from the `root` node, following edges. Each node = a rounded box:
  - root: subtle/neutral; question: light-blue fill + blue border; dnq: dark/grey pill with white text
    (e.g. "DNQ - Under 18"); qualified: green pill ("Qualified").
  - Node shows its `label` (the question text / terminal label), wrapped, max ~180px wide.
- Edges: SVG connector lines (orthogonal/elbow preferred) from parent bottom to child top, with the
  `edge.label` rendered as a small white chip near the midpoint.
- **Pan** (drag background) + **zoom** (wheel and +/− buttons) + a "fit to view" / reset button. A small
  toolbar bottom-left (＋ ／ − ／ ⛶) like Alleviate.
- Handle real data: the knockout chain is mostly a vertical spine of questions with DNQ branches off to the
  side and Qualified at the bottom. Lay DNQ terminals to the right of their source question; keep the main
  question spine centered. Don't overlap nodes; compute positions from a simple layered/DFS layout (no
  external graph lib required — plain TS + SVG/divs; if you really want a lib, react-flow is acceptable but
  prefer dependency-free).
- Empty/!flow.nodes → a friendly empty state ("No flow configured yet").
- No external network. Pure presentation from props.

## Component B — `src/components/QuestionRoutingModal.tsx`  (EDIT + DELETE)
```ts
export function QuestionRoutingModal({
  study, open, onClose, onSaved,
}: { study: StudyDetail; open: boolean; onClose: () => void; onSaved: (updated: StudyDetail) => void }): JSX.Element | null
```
Mirror Alleviate's "Question Routing" modal (image 5). Title "Question Routing", subtitle
"Edit question routing, edge labels, and flow destinations." Scrollable list of question cards Q1..Qn:
- Header row: a chip "Q{n}", a **type dropdown** (options: Question, Number, Yes/No, Choice — map to
  `answer_type`: 'choice'|'number'|'yes_no'), an editable **question text** input (`sms_question`), a
  small **"choice"** button (manage choices when answer_type='choice'), and a **delete** (trash) icon that
  removes the whole question.
- Under each: the **paths** (derived from `flow.edges` where `edge.source === question.variable_name`). Each
  path row = an editable **edge-label** input (left) → an arrow → a **destination dropdown** (every other
  question by "Q{k}: {short text}" + every terminal "#{k}: DNQ - {label}" + "Qualified") → a coloured label
  echo of the destination (blue for question, red for DNQ, green for Qualified) + a **delete path** icon.
  A "＋ Add path" link adds a new path row.
- A "＋ Add Question" control at the bottom adds a new blank question (new variable_name like `qN`, rank = max+1).
- **Save**: rebuild and POST via `updateStudy(study.id, { screeningQuestions, flow })`:
  - `screeningQuestions`: the edited list (preserve every original field per question; only override
    sms_question / answer_type / choices / rank; keep variable_name, criteria_ids, disqualify_condition etc.
    Generate disqualify/flow consistency only if you can do so safely — otherwise leave existing condition).
  - `flow.nodes`: one node per question (id=variable_name, type:'question', label:sms_question) + keep all
    existing dnq/qualified/root terminal nodes (don't drop terminals referenced by any path).
  - `flow.edges`: rebuild from all path rows (source=question.variable_name, target=destination id,
    label=edge-label text).
  On success call `onSaved(updatedStudyDetail)` and `onClose()`. Show a saving state + error message on failure.
- Cancel/close (X, backdrop, Esc) discards edits. `open===false` → render null.
- Work entirely from the `study` prop's `flow` + `screeningQuestions`; deep-copy into local state on open so
  edits are cancellable.

## Ground rules
- TypeScript strict, no `any` in props. Import shared types from `../types`. Import `updateStudy` from `../api`.
- Self-contained: A touches only AgentFlowGraph.tsx; B touches only QuestionRoutingModal.tsx (+ optional
  appended CSS clearly marked). Do NOT edit App.tsx, StudyPicker, or each other's files.
- Both must render correctly in dark and light themes.
