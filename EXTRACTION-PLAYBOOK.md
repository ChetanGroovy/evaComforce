# Study Extraction Playbook (READ BEFORE EXTRACTING)

Hard rules for turning a Protocol/ICF into a study report. Derived from diffing our MK-7240
doc-extraction against the live platform (we shipped 11 questions; live used 7). The linter
(`node studygen.mjs check`) enforces these — but follow them while writing, don't rely on the catch.

## Universal criteria — classify by the MEDICAL FACT, not the protocol's phrasing
Some criteria appear in almost every drug trial. Classify them consistently regardless of whether the protocol writes them as an inclusion ("eligible *if not* pregnant") or an exclusion ("Pregnant → excluded") — the phrasing must not change the label:
- **Pregnancy / breastfeeding** (childbearing potential): `self_report / hard / phone_screenable`. **Gate it by gender with conditional logic, not awkward text.** Add one early routing question — `{variable_name:"sex_at_birth", answer_type:"choice", choices:["Female","Male"], routing:true, criteria_ids:[]}` — then make the pregnancy question conditional: `show_if: "sex_at_birth == \"Female\""`, `depends_on:["sex_at_birth"]`, plain wording ("Are you currently pregnant, breastfeeding, or planning to become pregnant…?"). In the flow, branch at the pregnancy node: Female → pregnancy question; Male → skip to the next node. (`routing` questions are exempt from the criteria_ids requirement in `eval`.) The contraception-*agreement* sub-criterion stays `knockout_strength: none`.
- **Age**: `self_report / hard`, numeric question.
- **Consent / genomics / sample-collection agreements**: `none`.
A real bug found this way: MK-7240 had its pregnancy criterion phrased as a conditional inclusion → mislabeled `records/none` → no question, while 4 other studies asked it. Tier-1 eval can't catch this (it's a *cross-study* inconsistency, not a within-study one) — so apply this policy by hand and spot-check that recurring universal criteria are labeled the same across studies.

## Criterion classification (DO THIS FIRST — it's the accuracy keystone)
Before writing any question, classify **every** criterion in `study.json`:
- `verification_method` ∈ `{self_report, exam, lab, imaging, records, derived}` — how is it actually confirmed?
  - `self_report` = the patient can answer it on a phone call (age, "diagnosed with X", "tried drug Y that failed", pregnancy, transplant, prior cancer).
  - `exam` (joint counts, physical findings), `lab` (CRP, ACPA, HBV, blood counts), `imaging` (MRI, X-ray), `records` (specific drug/dose history, washout windows, advanced-drug recall), `derived` (investigator judgment) = NOT phone-answerable.
- `knockout_strength` ∈ `{hard, soft, none}` — hard = a clear yes/no that decides eligibility; none = consent/contraception-agreement.
- `phone_screenable` = `self_report && hard`.

**Generate screening questions ONLY from `phone_screenable == true` criteria.** This makes the three failure modes structural, not judgment:
- a question sourced from a `lab`/`exam`/`records` criterion = **precision** violation (clinical-gate, drug-recall);
- a `phone_screenable` criterion with no question = **recall** violation (missed knockout).
`node studygen.mjs eval` enforces both as a deterministic JSON-join and **blocks `build` on failure**. Run it; resolve every FAIL.

## Adjudicating Auditor (Tier-2) disagreements
The independent Auditor (`studygen audit-diff`) re-labels every criterion and will disagree often — it biases toward *more* phone questions. Resolve `DISAGREE(phone-flips)` with these rules (do NOT just accept the Auditor):
1. **Self-knowledge limits — reject the flip.** A patient cannot self-report an allergy to a drug they've never taken (the study drug), their own lab/exam values, or a subtype only a clinician assigns (e.g., psoriasis *type*). These stay `lab`/`exam`/`soft`.
2. **Advanced-drug-class recall = `records`, not `self_report`.** "Ever received an IL-23 / JAK / specific biologic" → `records`. The live platform OMITS these from the phone — patients don't reliably recall drug classes; confirmed from charts at screening. Reject Auditor `self_report` flips here.
3. **Common, patient-known facts → accept `self_report`.** Diagnosis of a common condition ("diagnosed with X by a doctor"), common meds by brand (antidepressants, NSAIDs, Humira), pregnancy, organ transplant, prior cancer, recent surgery, smoking. If we under-labeled one of these as `soft`/`records`, the Auditor is right — accept.
4. **Administrative / agreement criteria → `knockout_strength: none`.** Consent, contraception agreements, "willing to comply." Accept the Auditor.
5. **Tie-break toward the TIGHTER set.** Live uses ~7–8 questions. For a borderline-knowable criterion, prefer `soft` (confirm at visit) unless it's a high-yield knockout. Do not balloon the question set to satisfy recall on marginal items.

Record the adjudication in the criterion's `rationale`. A real label fix (we were wrong) means re-running eval; a defensible disagreement (Auditor over-includes) is noted and dismissed.

## Screening questions
1. **Phone pre-screen only.** Questions = what a patient can answer on a phone call. Target **6–8** tight knockouts. (The count is *derived* from the phone_screenable set, not a magic number.)
2. **Never ask screening-VISIT checks on the phone.** Exclude criteria verified later at the site:
   - Lab / serology: HIV, hepatitis B/C, blood counts (WBC, ANC, platelets), bilirubin, LFTs, ACPA/RF, CRP/ESR.
   - Imaging / cardiac: MRI contraindication, X-ray/radiographic reads, ECG/QTcF.
   - Clinical workups: active infection, TB testing.
   - Recall of a specific investigational drug name (e.g., "have you taken tulisokibart?").
   These belong to the on-site screening, NOT the call.
2a. **Don't gate an INCLUSION on an exam/lab measure the patient can't self-verify** — joint counts
   (SJC/TJC), CRP/ESR, antibody status (ACPA/RF), or activity indices (DAS28/CDAI/SDAI). The patient
   cannot answer these. Use a **function-based proxy** instead (e.g., "does your condition stop you from
   dressing/bathing/eating?" for severity) or leave it to the screening visit. *(AZD1163: we wrongly asked
   "do you have several swollen/tender joints?" — INC-5 needs an exam + CRP. Removed.)*
2b. **Don't disqualify on recall of specific advanced drugs** (tocilizumab, rituximab, JAK inhibitors,
   abatacept…). Patients may not remember; this is confirmed from records at screening. *(AZD1163: removed.)*
2c. **Don't miss a clean exclusion knockout** — e.g., Stage IV / end-stage disease framed as a daily-function
   question is exactly what the platform uses. Scan exclusions for phone-answerable, high-knockout items.
3. **Layperson wording + brand examples.** "anti-inflammatory pain medicines (ibuprofen, Aleve, naproxen,
   Celebrex)" — not "NSAIDs / bDMARD / tsDMARD / subcutaneous monoclonal".
4. **Capture values when useful.** Ask age as "How old are you?" (numeric), not a yes/no range.
5. **Every question links to a criterion** via `criteria_ids` (`INC-n` / `EXC-n`).

## Overview / metadata
6. **CRM-only fields are never in documents:** PI, site + address + phone, priority, recruiters,
   funnel, patients. Mark them **REQUIRED-FROM-SITE** and ask up front. Do not ship blank silently.

## Knowledge Bank
7. Fill General Info, Trial Design, Compensation (from ICF stipend table — do the math), Blinding.
   These the docs CAN provide; leaving them blank when the data exists is a miss.
7a. **State the drug FORM and true duration explicitly** (injection vs pill; total weeks). The live site KB
   can be wrong — for AZD1163 the platform said "daily pill, 7–8 months" when it's actually an SC injection
   over ~57 weeks. Trust the Protocol/ICF over a live KB; if they disagree, flag it.

## Always
8. Output both `.md` and `.html`, Full + Redacted.
9. Run `node studygen.mjs check <study.json>` (build does this automatically) and resolve every WARN
   before sending — or note why it's intentionally left.
10. If the live study is reachable, do a one-shot `crawl.mjs` + compare to catch drift.

See `studies/MK-7240/COMPARISON-docs-vs-live.md` for the worked example.
