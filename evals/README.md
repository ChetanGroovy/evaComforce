# Study Onboarding — Eval System

How we get accuracy **without a live URL**. The documents are ground truth for everything except CRM fields (PI/site/priority), so doc-derived content is checkable offline. The dangerous step — collapsing 30–60 criteria into ~7 phone questions — is made checkable by classifying each criterion first.

## Tier 1 — deterministic gate (`studygen.mjs eval`)
Runs inside `build`; FAIL blocks ship (exit 1). It's a JSON-join over per-criterion classification, NOT keyword matching:
- **PRECISION** — every question must source a `phone_screenable` criterion (`self_report && hard`). Sourcing a `lab`/`exam`/`records` criterion FAILs, flagged by source criterion → paraphrase-proof. Kills *clinical-gate* + *drug-recall*.
- **RECALL** — every `phone_screenable` criterion must have ≥1 question, else FAIL with the named criterion. Kills *missed-knockout* (an absence becomes a set diff).
- **KB grounding** — drug FORM and compensation `$` figures must trace to the protocol/ICF text. Catches the dirty-oracle (live KB once called an SC injection a "daily pill").
- **Label cross-check** — a `self_report` criterion whose text reads clinical/lab is flagged as a mislabel suspect.
- CRM blanks → non-blocking WARN.

```
node studygen.mjs eval studies/<NAME>/study.json studies/<NAME>
```

## Tier 2 — adversarial Auditor (independent of the extractor)
Tier 1 trusts the extractor's *labels*. The Auditor re-derives them independently to catch mis-labels.
- `studygen.mjs audit-bundle <study.json>` → writes `audit-input.json` = criteria TEXT + questions only (labels + reasoning stripped → asymmetric input).
- The `studyaudit` agent (Sonnet, decorrelated from the Opus extractor) reads the bundle, re-classifies from scratch, hunts the **dropped set** for missed knockouts, and back-translates each question. Writes `audit-verdict.json`.
- `studygen.mjs audit-diff <study.json> <audit-verdict.json>` → diffs the Auditor's labels vs ours. `DISAGREE(phone-flips)` and `SUSPECTED-MISS` exit non-zero.

The Auditor is engineered against collusion: it never sees our labels, its task is omission-finding over the dropped set (not "score the questions"), it must cite pages, and it runs on a different model.

## Tier 3 — golden regression (`studygen.mjs golden`)
Frozen, no live URL needed:
- The three historical mistakes (AZD joint-count Q → INC-5 exam; drug-recall Q → EXC-6 records; deleted Stage-IV → EXC-1) must always be caught.
- **Trust-the-doc:** AZD's drug form must read "injection," never live's wrong "pill."
- Every shipped study must eval-clean.

```
node studygen.mjs golden
```

## Oracle policy (important)
- **Live platform = ground truth for question SELECTION only.** It is NOT trusted for KB facts — it has been wrong (drug form, duration, compensation).
- **PDFs = ground truth for KB / criteria / drug facts.**
- Only 2 live fixtures exist (MK-7240, AZD1163), both RA — too few to publish a numeric LLM threshold, so the gate is deterministic + categorical, not a tuned score.

## Run order for a new study
1. classify criteria → `study.json`
2. `studygen eval` (Tier 1) — resolve every FAIL
3. `studygen audit-bundle` → run `studyaudit` agent → `studygen audit-diff` (Tier 2) — resolve DISAGREE/SUSPECTED-MISS
4. `studygen golden` (Tier 3) — must stay green
5. `studygen build` — emits reports only after Tier 1 passes
