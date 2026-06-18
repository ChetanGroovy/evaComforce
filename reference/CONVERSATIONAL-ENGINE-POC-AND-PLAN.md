# Conversational Prescreening Engine — POC + SDLC Plan

**Goal:** bring Alleviate's behavior — a turn-by-turn conversational agent that walks a study's flow
graph and ends at Qualified / a specific DNQ — into *our* engine, **without losing** the things our
engine already gives us that Alleviate's cannot (reproducible verdict, audit trace, protocol
traceability, an explicit INCOMPLETE state).

**This document is for review. No production code has been changed.** A throwaway proof-of-concept
spike lives in `poc/` (isolated from `studygen.mjs`). Build starts only after sign-off.

Background on what Alleviate does: `reference/ALLEVIATE-ENGINE-REVERSE-ENGINEERED.md`.

---

## 1. Decisions taken into this POC

| Decision | Choice | Why |
|---|---|---|
| Architecture | **Hybrid** (LLM extracts the answer → **deterministic code picks the branch**) | Same conversational graph behavior as Alleviate, but verdicts stay reproducible + auditable. Exact-LLM-branch kept as a per-edge *fallback* only (see §3). |
| First channel | **CLI runner**, behind a channel **adapter interface** | Prove the loop in the terminal now; SMS (Twilio) / voice plug into the same core later without touching the decision logic. |
| Flow source | **Reuse `study.json`** (`flow.nodes/edges` + `screeningQuestions`) | One source of truth. We already produce this for every study. The engine *compiles* it into an executable conversational graph. |

> On "exact replication": Alleviate hands branching to the LLM. We deliberately keep branching
> deterministic. The patient experience is identical (same conversational questions, same DNQ reasons);
> only the *decision mechanism* differs — and ours is the regulated-screen-grade version.

---

## 2. The hybrid model

```
            ┌─────────────────────────── per conversation turn ───────────────────────────┐
 graph  →   ask current node.prompt  →   patient free-text reply
                                              │
                                  LLM EXTRACTOR (fuzzy)          ← the only LLM in the loop
                                  "I'm 52" → { q1_age: 52 }
                                              │
                                  DETERMINISTIC EDGE-SELECTOR    ← pure code, no LLM
                                  first edge whose `when` is true wins
                                              │
                                  move to edge.to  →  (repeat, or terminate)
            └──────────────────────────────────────────────────────────────────────────────┘
   terminal:  Qualified   |   DNQ-<specific reason>   |   INCOMPLETE (conversation abandoned)
```

- **LLM does understanding only** — same role it already has in our `screening` agent, but invoked
  one turn at a time instead of over a whole transcript.
- **Code does the decision** — reuses our existing condition evaluator (`disqualify_condition` /
  `show_if` semantics), so the verdict is a pure function of the extracted values + the graph.
- **Every run yields a trace** — the ordered list of (node, answer, edge taken) — so any verdict is
  explainable. Alleviate cannot produce this.

---

## 3. Proposed data model — the *compiled* conversational flow

Production compiles `study.json` → an executable graph. Proposed node/edge schema (see the worked
example `poc/wc45726.flow.json`):

```jsonc
"q1_age": {
  "type": "question",
  "variable": "q1_age",          // NEW: links the flow node to its screeningQuestion
  "answer_type": "number",
  "prompt": "How old are you?",  // the conversational text the agent speaks
  "edges": [
    { "when": "age < 18", "to": "dnq_age", "label": "Under 18" },   // NEW: machine condition
    { "when": "true",     "to": "q_sex",   "label": "18 or older" }
  ]
}
```

Two additions vs the flow we render today:
1. **`node.variable`** — the question node's `variable_name` (links node → screeningQuestion).
   *Today the report-flow node ids do not match variable_names* (e.g. `q_sex` vs `sex_at_birth`,
   `q4_wl` vs `q4_weightloss`). Closing this is Phase-1 work.
2. **`edge.when`** — a machine condition. Today edges carry only a natural-language `label`.
   `when` is derived from the source question's `disqualify_condition` (the DNQ edge) / its negation
   (the pass edge) / routing vars like `sex_at_birth` (forks). The NL `label` is kept for display and
   for the *fallback*: if an edge has no derivable `when`, the engine may defer that single branch to
   the LLM (opt-in, logged as non-deterministic).

Edges are evaluated **in order; first `when==true` wins.** `answer` is bound to the current node's
variable; `age` aliases the numeric question.

---

## 4. POC proof (what `poc/` demonstrates)

`poc/wc45726.flow.json` — the proposed compiled graph for the WC45726 obesity study.
`poc/converse.mjs` — a generic, deterministic conversational interpreter (no LLM; answers replayed).

`node poc/converse.mjs` runs four patients and proves all behaviors:

| Patient | Result | Proves |
|---|---|---|
| Maria (fully eligible, female) | **QUALIFIED** | full traversal incl. Female→pregnancy routing |
| Dev (no type 2 diabetes) | **DNQ — No T2D** | early per-reason knockout, conversation stops |
| Alison (pregnant) | **DNQ — Pregnant…** | sex routing + late knockout |
| **Albert (real extract from disk)** | **INCOMPLETE @ q5_glp1** | ties to live data; **same verdict our batch engine gives**, and demonstrates conversational "unanswered question stalls the screen" |

Each run prints the agent/patient transcript **and** the deterministic path
(`root─[18 or older]→ q_sex─…→ q10_preg─[Not pregnant]→ qualified`). This is the audit trace Alleviate
lacks.

### Gaps the POC surfaced (→ become Phase-1 tasks)
1. **node ↔ variable link missing** in today's report flow — must add `node.variable`.
2. **edges have no machine condition** — must derive `edge.when` at compile time.
3. **Conversational vs batch "missing" semantics differ.** Batch lets a disclosed disqualifier win
   over missing answers; conversational stops at the *first* unanswered node. Both reach the right
   terminal type, but the rule must be stated and tested (decide: in live mode a missing answer = "ask
   it"; INCOMPLETE only on abandonment).

---

## 5. Target architecture (build)

```
studygen.mjs
  └─ compileFlow(study.json)         → executable conversational graph (validated)
  └─ ConversationEngine               → core loop; deterministic edge-selector; emits trace
        ├─ Extractor (LLM adapter)    → free-text turn → { variable: value }   (reuses `screening` logic)
        └─ Channel adapter (interface)
              ├─ CLIChannel           (Phase 2 — stdin/stdout)
              ├─ ReplayChannel        (tests — scripted answers, the POC's mode)
              ├─ SmsChannel           (later — Twilio webhook)
              └─ VoiceChannel         (later)
  └─ commands:  converse <study.json>            (interactive CLI)
                converse-replay <study.json> <answers>   (deterministic, for CI)
```

Decision logic stays one module, reused by every channel. Channels only move text in/out.

---

## 6. SDLC plan

> **Design refinement during build (better than the POC proposed):** the executable conversational flow
> is compiled from **`screeningQuestions`** (the authoritative rank-ordered, conditioned list), *not* from
> the report `flow` graph. This makes the node-id↔variable reconciliation unnecessary and guarantees
> equivalence with batch `screen` by construction (same source, same conditions, same order). The report
> `flow` graph stays purely for visualization. `poc/` remains as the original proof.

### Phase 0 — POC & sign-off  ✅ (this document + `poc/`)
Deliverables: reverse-eng doc, POC flow + interpreter, this plan. **Gate: review — approved.**

### Phase 1 — Executable model + equivalence  ✅ DONE
- Conversational model compiled from `screeningQuestions` (rank order + `disqualify_condition` +
  `show_if` + `routing` + `choices`). No flow-graph reconciliation needed (see refinement above).
- `test-converse <study.json>` equivalence gate: conversational terminal == batch `screen` terminal for
  all-pass, every single-knockout, and a missing-answer case. **Green on all 5 studies (0 fail).**
- No behavior change to existing commands; golden still 10/10.

### Phase 2 — Conversation core + CLI + Replay  ✅ DONE
- `runConversation(S, channel)` — deterministic loop, early-exit on disclosed knockout, re-ask on
  ambiguous input, `show_if` gating, INCOMPLETE on unanswered/abandon, full trace + transcript.
- Channels: `cliChannel` (interactive TTY **and** piped stdin via a line queue) + `replayChannel`
  (scripted, for tests/bulk).
- Commands: `converse`, `converse-replay`, `test-converse` (all wired + in usage).
- Rule-based extractor (yes_no / number / choice) with negation-aware yes/no parsing.

### Phase 3 — LLM extractor in the loop  ← NEXT (not built)
- Per-turn extractor adapter wrapping our `screening` agent: free-text reply → variable value, with
  a confidence/needs-clarification signal (re-ask on low confidence).
- **Tests:** golden transcripts → expected extracted values; adversarial/ambiguous replies.
- Determinism preserved: extractor feeds values; branch logic unchanged.

### Phase 4 — Reporting + persistence
- Per-conversation record (answers, transcript, trace, terminal, timestamps) → `screening/`.
- Extend `screen-report` to consume conversational runs; add funnel-by-DNQ-reason (Alleviate parity).

### Phase 5 — Real channel (SMS first, if/when wanted)
- `SmsChannel` over Twilio: inbound webhook → engine turn → outbound reply; session store.
- **Security/compliance gate before any live patient contact:** PHI handling review, consent/TCPA,
  opt-out, audit logging, credential management. (Explicit go/no-go — not automatic.)

### Phase 6 — Hardening
- Resume interrupted conversations; timeouts; multi-study routing (the live agent screens several
  studies in one chat); load/concurrency; observability.

---

## 7. Testing strategy
- **Unit:** `evalWhen` / edge-selector truth tables; compiler derivations.
- **Determinism:** same answers → identical terminal + trace, N runs.
- **Equivalence:** `converse-replay` ≡ batch `screen` across all patients (regression gate, joins the
  existing `golden`).
- **Extractor goldens:** free-text → expected values (incl. ambiguous/curveball replies).
- **Flow validation:** every study compiles to a well-formed graph (in `eval`).
- **Channel contract tests:** Replay/CLI/SMS adapters satisfy one interface.

## 8. Risks & mitigations
| Risk | Mitigation |
|---|---|
| Flow node ids ≠ variable_names | Phase 1 reconciliation + validator fails the build on mismatch |
| LLM mis-extracts an answer | confidence threshold + clarifying re-ask; extractor goldens; branch stays deterministic so errors are localized + visible in trace |
| Conversational vs batch semantics drift | equivalence gate; written missing-answer rule |
| Scope creep into SMS/voice early | adapter interface; channels are last; SMS behind a compliance gate |
| PHI exposure on a live channel | Phase 5 gate: consent/opt-out/audit/creds reviewed before any real contact |

## 9. Open questions for review
1. Approve **hybrid** (deterministic branch) as the default? (Recommended.)
2. Missing-answer rule in live mode = **re-ask** (INCOMPLETE only on abandonment) — agreed?
3. Phase 5 scope: do we target **SMS** as the first real channel, or stop at CLI for now?
4. Should the conversational engine **replace** batch `screen`, or run **alongside** it (batch stays for
   bulk file scoring; conversational for live)? (Recommended: alongside — same core, two entry points.)

---

**Next step on approval:** start Phase 1 (compiler + validator), no user-facing change, fully tested,
then demo `converse-replay` equivalence before Phase 2.
