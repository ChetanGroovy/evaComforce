# Study Report Pipeline — Input Contract

Generate the same study config report (md + html, full + redacted) for **any** study, with **no live access**. **You give the Study Documents; I (Claude) extract everything** — replicating what the Alleviate backend does — and the generator builds the reports.

## What I need from you each time (PRIMARY)

Per study, drop into `studies/<NAME>/docs/`:
1. **Protocol PDF** — required. Source of eligibility criteria, drug, sponsor, indication.
2. **ICF PDF** — optional but recommended. Compensation, visit schedule, trial design (Knowledge Bank).

Then I:
- Read the PDFs (page by page).
- Extract **inclusion/exclusion criteria** with source page numbers.
- **Classify each criterion** (`verification_method`, `knockout_strength`, `phone_screenable`) — this is the accuracy keystone; questions may only come from `phone_screenable` criteria.
- Generate **screening questions** from the phone-screenable criteria (each linked back via `criteria_ids`).
- Run `node studygen.mjs eval` — a deterministic gate that FAILS the build if a question sources a non-phone criterion (precision) or a phone-screenable knockout has no question (recall). See `EXTRACTION-PLAYBOOK.md`.
- Write the **Knowledge Bank** (general info / trial design / compensation / blinding).
- Build the **Agent Flow** graph from the qualifying questions.
- Emit `studies/<NAME>/study.json`, then run `studygen build`.

### What documents can vs cannot produce
| Section | From docs? |
|---|---|
| Overview: name, sponsor, drug, indication, protocol # | yes (title page) |
| Overview: PI, site, priority | only if in the document |
| Documents, Knowledge Bank, Criteria, Questions, Flow | yes |
| Patients / funnel / recruiters | NO — runtime CRM data, not in any document |

So a docs-only report = sections 1–6 complete, 7–8 blank. With no patient data present,
FULL and REDACTED come out identical.

## Alternate inputs (not used now, still supported)

- **Filled `study.json`** — `node studygen.mjs build <study.json>` (schema: `node studygen.mjs schema`).
- **Captured network payloads** — `node studygen.mjs from-payloads <rawDir> <out.json> [renderedDir]`.

## Commands

```bash
# build reports from a filled study.json
node studygen.mjs build studies/<NAME>/study.json
#   -> <NAME>-FULL.md / .html   (with PII — gitignored)
#   -> <NAME>-REDACTED.md / .html

# convert captured payloads -> study.json
node studygen.mjs from-payloads <rawDir> studies/<NAME>/study.json [renderedDir]

# print the input schema/template
node studygen.mjs schema
```

## Output (per study)
- `<NAME>-FULL.md` + `.html` — all 8 sections incl. patient names/phones (**PHI — gitignored**)
- `<NAME>-REDACTED.md` + `.html` — same, PII stripped (shareable)

## Report sections
1. Overview (name, sponsor, PI, site, priority, indication, drug, flow status)
2. Study Documents (Protocol / ICF — name, type, id, extraction status)
3. Knowledge Bank (general info, trial design, compensation, blinding)
4. Eligibility Criteria (inclusion / exclusion, with protocol page refs)
5. Screening Questions (mapped to criteria via `criteria_ids`)
6. Agent Flow (nodes + edges)
7. Patients / Funnel (counts; rows only in FULL)
8. Recruiters

## study.json schema
Run `node studygen.mjs schema` for the live template. Reference example:
`studies/WC45276/study.json` (real, filled).

## Notes
- `criteria_ids` on each question links it to `INC-n` / `EXC-n` criteria → the
  traceability chain "question ← criterion ← protocol page".
- Manual-only fields not present in payloads: `indication`, `drug`. Fill in
  `study.json` if you want them in the overview.
- Anything under `studies/` and any `*-FULL.*` file is gitignored (contains PHI).
