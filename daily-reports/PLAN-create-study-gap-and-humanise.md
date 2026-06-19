# Plan — Close create-study gap + humanise screening questions

Status: **NOT consensus-ready** (5-judge verdict avg **71/100**, 3 revision rounds). Ship sliced, not one-shot.
Generated 2026-06-19 via understand→design→5-judge workflow. Verified facts below.

## The gap (root cause, verified)
- **UI create = draft skeleton, nothing extracts.** `NewStudyModal → POST /api/studies → createStudy()` (apps/api/src/lib/studies.ts:200-294) writes empty criteria/questions + single-root stub flow, runs `pdftotext`, returns note *"Run the StudyOnboard pipeline…"* — **that pipeline does not exist in server code** (studies.ts:292). Every UI-created study lands Draft / 0 Qs / unscreenable.
- **CLI builds the full flow but is disconnected.** `studygen.mjs` `deriveFlow` (1256-1294) + `cmdFromPayloads` build full questions+graph, but only from pre-captured RSC payloads to an arbitrary path — not wired to upload, and the API never triggers it.
- **API/web already render flow+questions** (`studyDetail` projects `S.flow`+`S.screeningQuestions`; `StudyDetailPage` renders `<AgentFlowGraph>`). **Missing piece = an extraction+flow+humanise trigger on create.**
- **Questions are machine-worded.** `sms_question` is the single patient-facing string; no humanisation pass, no deterministic guard that a warm rewrite preserves medical meaning / knockout polarity. Live consumer reads `q.sms_question` at **extractor/src/index.ts:272 (Anthropic SDK, default) AND :380 (claude CLI)** — so humanisation is NOT presentation-only unless frozen at both.

## Design (two parts)
**Part A — close create gap (platform stack):** on create, when `llmBackend()!=='rule'` and `ONBOARD_ON_CREATE!=='off'`, set status `onboarding`, fire `void onboardStudy(id).catch(...)`. `onboardStudy` reads protocol.txt/icf.txt → section-aware truncate → playbook-encoded LLM extraction (exact `disqualify_condition` grammar, gender-gated pregnancy) → `deriveFlow` → **shared humanise core** → write status `needs_review` (**never auto-`ready`**). UI polls, lands on the flow. New `POST /api/studies/:id/onboard` for re-run.

**Part B — humanisation (authoring-time, deterministic gate):** `node studygen.mjs humanise <study.json>` + shared core. Freeze `interpretation_text` at extractor:272 **and** :380. Deterministic `auditHumanise` HARD gate: byte-identical invariants (variable_name, disqualify_condition, criteria_ids, answer_type, bmi_cutoff, choices); carve-out entity+direction check (WC45276 q8 cornea); inverted-framing (WC45276 q4/q5, `answer==no`) → **reject rewrite + persist `review_flag`**. Linter FAILs on unresolved flag; publish gate blocks `ready`.

## 5-judge verdict
| Lens | Score | Ready |
|------|-------|-------|
| Completeness | 78 | ❌ |
| Correctness/risk | 78 | ❌ |
| Patient-safety/playbook | 78 | ❌ |
| Testability | 68 | ❌ |
| Feasibility/sequencing | **52** | ❌ |

## Residual blockers (must fix before coding — all verified true)
1. **Status enum wrong target.** Real type = `z.enum(['draft','ready'])` at **packages/schema/src/index.ts:147** (z.infer source of truth), not studies.ts. Writing `onboarding`/`needs_review` won't typecheck until schema enum widened **and schema package rebuilt** (it ships a dist). Plan still names studies.ts.
2. **Publish gate uncallable.** `runCheck` (studygen.mjs:229) is **not exported** — CLI-only. The TS publish gate must shell-out `node studygen.mjs check <study.json>` (parse exit/FAIL count) or export it. Without this the `needs_review→ready` gate is theater.
3. **Update route is `POST /studies/:id/update`, not PATCH** — plan repeatedly says "PATCH route"; gate the real route.
4. **Badge mislabel window:** `StatusBadge` collapses every non-draft to green "Ready to prescreen" — land the `needs_review`/`onboarding` branches in the SAME change as the status writes, or a needs_review study shows green.
5. **Feasibility:** full A+B in one window is too big; humanisation is patient-facing + needs human sign-off.

## Recommended slicing (my call)
- **Phase 1 (ship now, low risk, demo-able):** Part A behind `ONBOARD_ON_CREATE` flag, status `needs_review`, never auto-`ready`. Fixes the headline "create only makes a draft." Pre-fix blockers #1–#4 first.
- **Phase 2 (gated, do NOT auto-ship to patients):** Part B humanisation with deterministic `auditHumanise` + human sign-off on regenerated medical content.
- **Demo asset:** pre-bake 77242113PSA3002 (currently only q1_age) offline → needs_review → humanise → human sign-off **before** committing; rehearse live upload against it as deterministic fallback (live path no-ops to DRAFT if `llmBackend()==='rule'`).

Full task list (T0–T8, file-level) in workflow output: `tasks/wspyrt279.output`.
