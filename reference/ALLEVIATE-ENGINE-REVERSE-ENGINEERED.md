# Alleviate Health — Prescreening Engine, Reverse-Engineered

**Purpose:** document how DM Clinical Research's *Alleviate Health* platform prescreens patients —
data model, runtime behavior, and how it phrases questions — so we can build (and have built) our own
engine deliberately rather than by guesswork. This is the industry-reference / POC doc that precedes
our engine.

**Status:** reverse-engineered from captured platform data. Not official Alleviate documentation.

---

## 1. Sources (how this was derived)

No fresh crawl was run for this doc — it is built from data already captured from the live platform
(`dmclinicalresearch.app.alleviatehealth.care`) in prior sessions:

| Source | What it gave |
|---|---|
| `studies/MK-7240/live/study.live.json` | full rendered study config incl. the flow graph (nodes + edges) |
| `studies/AZD1163-D9640C00003/live/study.live.json` | second study — confirms the model generalizes |
| `studies/MK-7240/live/raw/*.txt` | raw Next.js server-action payloads (the API responses behind the UI) |
| `studies/MK-7240/live/02-agent-flow.txt` | the "Agent Flow" tab rendered to text |
| `studies/*/COMPARISON-docs-vs-live.md` | prior question-by-question diff of our extraction vs live |

To refresh against the *current* live state: `node crawl.mjs <studyUrlOrId> <outDir>` (Playwright login,
creds in `.env`). **Security:** the live app holds PHI; `.env` is gitignored; rotate the captured
credentials after any crawl. A fresh crawl was deliberately **not** run here because the captured data
fully answers the architecture question.

---

## 2. The data model — Alleviate stores ONLY a graph

The decisive finding. The published flow config (raw payload `125.txt`, `flowId … version 11, status active`)
contains:

```json
{ "flowId": "...", "studyId": "...", "version": 11, "status": "active",
  "inclusionCriteria": [],          // EMPTY
  "exclusionCriteria": [],          // EMPTY
  "screeningQuestions": [],         // EMPTY
  "generalInfo": "...", "trialDesign": "...", "compensation": "...",   // Knowledge Bank (free text)
  "nodes": [ ... ], "edges": [ ... ]    // <-- the entire engine lives here
}
```

There is **no structured criteria list, no per-question variable, no condition expression** in what the
engine runs on. Eligibility criteria and "screening questions" exist only as *graph nodes and edge labels*.
The graph IS the prescreening program.

### Node shape
```json
{ "id": "uuid", "type": "root|question|qualified|dnq", "label": "<text>", "position": {x,y} }
```
- `root` — entry node ("Are you interested in this study?")
- `question` — a question the agent asks, in conversational layperson wording
- `qualified` — single terminal success node
- `dnq` — terminal failure node; **one per knockout reason** (not a single bucket), e.g.
  `"DNQ - Age outside eligible range"`, `"DNQ - Cancer in past 5 years"`

(The Agent-Flow UI also shows a "BMI Check" node type in its palette, used when a study screens on BMI;
neither MK-7240 nor AZD1163 instantiated one — both are 1 root + 7 question + 1 qualified + 7 dnq.)

### Edge shape — the key insight
```json
{ "id": "uuid", "source": "<nodeId>", "target": "<nodeId>", "label": "<natural-language predicate>" }
```
**`label` is the only branching signal.** There is no `operator`, no `variable`, no `value`, no
`threshold`, no machine-readable condition. Every branch is a sentence describing a patient state:

| source question | edge label (predicate) | target |
|---|---|---|
| "How old are you?" | "Patient age is outside eligible range (18-80)" | DNQ - Age |
| "How old are you?" | "Patient age is between 18 and 80 years, inclusive" | next question |
| "…back pain for at least 3 months?" | "Patient has had less than 3 months of back pain" | DNQ - Back pain |
| "…back pain for at least 3 months?" | "Patient has had at least 3 months of back pain" | next question |

Even a numeric rule ("18–80") is encoded as English prose, not a comparison. **The LLM enforces it.**

---

## 3. How prescreening runs (inferred runtime)

Alleviate's call/SMS agent is an **LLM walking the graph**:

```
start at root
repeat:
  ask current node.label (conversational)
  patient answers in free text (call or SMS)
  LLM reads the answer + the out-edges' label predicates
  LLM selects the single out-edge whose predicate the answer satisfies
  move to that edge.target
until current node.type in {qualified, dnq}
emit terminal: Qualified  OR  the specific DNQ reason on the node reached
```

Properties that follow from the model:

- **One LLM does both jobs** — natural-language *understanding* (map the answer to a predicate) **and**
  *branching* (pick the edge). There is no separate deterministic rule layer.
- **First failed knockout ends the screen.** Each question fans out to exactly its pass-edge or its
  DNQ-edge; hitting a `dnq` node terminates with that reason. Questions are linear (each passes to the
  next), so it's a chain with side-exits, not a tree.
- **DNQ is fully attributed.** Because every failure has its own node, the platform always knows *why*
  a patient DNQ'd — good for funnel analytics (the live study showed 14 funnel buckets).
- **Wording lives in the same field the agent speaks.** `node.label` is literally the sentence said to
  the patient. No separate "internal criterion" vs "SMS text" — they are one string.

### What this buys them / costs them
- ✅ Authoring is visual + non-technical: a recruiter drags nodes and writes English edge labels.
- ✅ Handles fuzzy free-text answers natively (the LLM judges intent).
- ❌ **Non-deterministic + unauditable**: the same answer can branch differently run-to-run; there is no
  trace of "which rule fired and why" beyond the LLM's choice. A borderline age ("almost 81") is decided
  by the model, not a `<=` check.
- ❌ No structured data captured by default (criteria/variables empty) → harder to reuse answers, to QA,
  or to prove a verdict.

---

## 4. Question phrasing — how Alleviate writes questions vs how we did

The platform's house style (extracted from MK-7240's 7 live nodes):

1. **Layperson words + consumer brand examples**, never clinical jargon.
   - Live: *"…at least 2 different anti-inflammatory pain medications (like **ibuprofen, Aleve, naproxen, Celebrex**) without much relief?"*
   - Ours (before): *"NSAIDs or a biologic medicine."* → too clinical.
2. **Capture the value, not a yes/no**, when useful downstream.
   - Live age: *"How old are you?"* (numeric) — the 18–80 rule lives on the edges, not the question.
3. **Bake the edge-case carve-out into the question text.**
   - Live: *"Have you had any cancer (except fully treated skin or cervical cancer) in the past 5 years?
     If you only had fully treated skin or cervical cancer, say no."*
4. **One conversational sentence per knockout** — no compound multi-part asks except an explicit
   "any of the following:" list (the disqualifying-diagnoses node lists 6 conditions in one question).
5. **Phone-answerable knockouts only.** Live MK-7240 used **7** questions; our doc-extraction made **11**.
   The 4 we over-built were all *screening-visit* checks — investigational-drug recall, HIV/hep serology,
   active-infection/TB, MRI contraindication — which the platform deliberately omits from the phone screen.

The live 7-question reference set (MK-7240) and the full diff are in
`studies/MK-7240/COMPARISON-docs-vs-live.md`.

---

## 5. Their engine vs ours — architecture comparison

| Dimension | **Alleviate (live)** | **Ours (`studygen.mjs` → `screenPatient`)** |
|---|---|---|
| Core model | LLM-driven graph traversal | structured questionnaire + deterministic rule function |
| What's stored | nodes + NL-predicate edges only | `screeningQuestions[]` w/ `variable_name`, `answer_type`, `disqualify_condition`, `show_if`, `criteria_ids` + classified criteria |
| Who decides eligibility | the LLM (picks the edge) | **pure code** — `evalCond(disqualify_condition)`; LLM only *extracts* answers from free text |
| Branch condition | English sentence ("age outside 18–80") | machine expression (`age < 18`, `answer == no`) |
| Determinism | no — model judgment per run | yes — same answers ⇒ same verdict |
| Auditability | DNQ reason node only | full per-question decision **trace** (shown / known / disqualified) |
| Traceability to protocol | none (criteria empty) | each Q → `criteria_ids` → criterion → protocol page |
| Verdict states | Qualified / DNQ-<reason> | Qualified / DNQ-<reason> / **INCOMPLETE** (a Q wasn't answered) |
| Conditional logic | encoded as graph branches | `show_if` + `routing` (e.g. sex_at_birth gates the pregnancy Q) |
| QA / regression | none exposed | `eval` gate (precision+recall on phone-screenable set) + `golden` 10/10 |
| Authoring | visual, non-technical | doc extraction → classify → `study.json` → linted build |

**The core difference:** Alleviate fuses understanding + decision into one LLM pass over a graph. We
**split** them — LLM does fuzzy free-text → structured answers; a deterministic function decides the
verdict and emits an auditable trace. Ours trades their authoring simplicity for determinism, traceability,
and a third honest state (INCOMPLETE) instead of silently qualifying on a partial screen.

---

## 6. POC — a worked trace through Alleviate's MK-7240 graph

Patient answers: interested ✓, age 52, back pain 8 months, AS diagnosed ✓, tried ibuprofen+naproxen no
relief ✓, no other listed diagnosis, no transplant, no cancer.

```
root  "Are you interested?"            -- "Patient explicitly says interested"        --> Q age
Q     "How old are you?" (52)          -- "age between 18 and 80, inclusive"          --> Q backpain
Q     "back pain >= 3 months?" (8mo)   -- "had at least 3 months of back pain"        --> Q AS
Q     "diagnosed with AS?" (yes)       -- "has diagnosis of AS"                       --> Q meds
Q     "tried >=2 NSAIDs no relief?"    -- "has tried at least 2 pain medications"     --> Q dx
Q     "any of [6 diagnoses]?" (no)     -- "does not have a disqualifying diagnosis"   --> Q transplant
Q     "transplant + anti-rejection?"   -- "does not have transplanted organ…"         --> Q cancer
Q     "cancer in past 5y?" (no)        -- "no cancer history within last 5 years"     --> QUALIFIED
```
Any "no/insufficient" answer instead routes to that question's dedicated `DNQ - <reason>` node and ends.

**Same patient through our engine** (`node studygen.mjs screen <study.json> <answers>`): identical
qualify/deny path, but each step is a coded `disqualify_condition`, the run produces a decision-trace
table, and an unanswered knockout yields **INCOMPLETE** rather than a model guess. (See our live WC45726
run: Albert → INCOMPLETE because the call never asked the GLP-1 question — the platform would have either
asked it or qualified on a partial screen.)

---

## 7. Takeaways for our engine

1. **Keep the split.** Our deterministic decision layer is the right call for a regulated screen —
   reproducible verdicts + audit trace are things Alleviate's single-LLM design cannot give.
2. **Adopt their phrasing discipline** (done): layperson + brand examples, capture values, carve-outs in
   the question text, phone-answerable knockouts only. Already encoded in `EXTRACTION-PLAYBOOK.md`.
3. **Match their DNQ granularity** (done): one reason per knockout — our `criteria_ids` + per-question
   DNQ reason already gives this, plus protocol traceability they lack.
4. **Our INCOMPLETE state is a feature, not a gap.** Alleviate has no notion of "not fully screened";
   it qualified Albert-type patients on partial data. Surfacing INCOMPLETE is stricter and safer.
5. **Optional parity item:** add a `BMI Check`-style derived node (we already compute BMI from
   height/weight in extraction) and an explicit numeric range edge model if we ever want to emit a graph
   that round-trips into Alleviate's flow editor.

---

## Appendix — raw evidence pointers
- Flow config payload: `studies/MK-7240/live/raw/125.txt` (`success:true … flowId … version 11`).
- Edge shape proof (label-only, no condition): same payload, `"edges":[{id,source,target,label}, …]`.
- Empty criteria/questions arrays: same payload (`inclusionCriteria:[]`, `exclusionCriteria:[]`,
  `screeningQuestions:[]`).
- Node/DNQ inventory: `studies/MK-7240/live/02-agent-flow.txt` and `study.live.json` → `flow.nodes`.
</content>
