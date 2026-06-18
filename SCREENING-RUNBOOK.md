# Patient Screening Harness

Run patients through a study's phone-screening flow → Qualified / DNQ / Incomplete, with a report. The verdict is **deterministic** (a pure function of the answers + the study's questions); an LLM only extracts answers from free text.

## Folder
Drop patient files in `studies/<NAME>/screening/`. One file per patient. Two accepted formats:

**A. Structured** (`<patient>.txt` or `.json`) — `key: value` per line, keyed by question `variable_name`:
```
q1_age: 52
sex_at_birth: Female
q2_bmi: yes
q3_t2d: yes
...
```
**B. Free text** (`<patient>.txt`) — a transcript / call note in plain English. Needs the extraction step (below).

## Commands
```bash
# one patient
node studygen.mjs screen studies/<NAME>/study.json studies/<NAME>/screening/<patient>.txt

# all patients in the folder → SCREENING-REPORT.md/html + screening/results.json
node studygen.mjs screen-report studies/<NAME>
```

## Conversational engine (live, turn-by-turn — alongside batch)
The same verdict logic, but run as a back-and-forth conversation like the live Alleviate agent. **Hybrid:**
the engine asks one question at a time and a *deterministic* selector decides each branch — a rule-based
extractor (yes_no / number / choice) only turns the patient's free text into a value, re-asking on
ambiguous input and skipping gated questions (e.g. pregnancy for males). A disclosed knockout ends the
call early with a polite close; an unanswered question → INCOMPLETE.
```bash
# interactive: talk to a patient at the terminal (free-text replies: "I'm 54", "yeah", "nope")
node studygen.mjs converse studies/<NAME>/study.json

# deterministic replay of a scripted conversation (prints transcript + outcome)
node studygen.mjs converse-replay studies/<NAME>/study.json studies/<NAME>/screening/<patient>.json [name]

# equivalence gate — conversational terminal MUST equal batch `screen` terminal for every answer set
node studygen.mjs test-converse studies/<NAME>/study.json
```
The conversational engine compiles from `screeningQuestions` (same rank order + `disqualify_condition` +
`show_if` as batch), so the two engines are provably equivalent (`test-converse` is green on all studies).
LLM-based extraction (for genuinely free-form replies) is the planned upgrade — see
`reference/CONVERSATIONAL-ENGINE-POC-AND-PLAN.md` (Phase 3).

## Free-text → answers (extraction)
For free-text patients, run the `screening` agent (Sonnet) first — it reads `study.json` + the patient `.txt`, maps the words to each `variable_name`, and writes `<patient>.json` next to it. The report **dedupes by patient name, preferring the `.json`**, so the raw `.txt` is ignored once extracted. The agent never decides eligibility — only the engine does.

**Capture routing/gating vars from context, not just from a direct Q&A.** A `routing` var like `sex_at_birth` gates downstream `show_if` questions (pregnancy shows only `if sex_at_birth == "Female"`). If extraction leaves it blank, the gate can't fire and a male patient falsely lands INCOMPLETE on the pregnancy question. Infer such vars from unambiguous transcript cues (name, pronouns, "his/her surgery") — only when genuinely clear. Still omit vars the transcript truly doesn't address, so the engine reports them INCOMPLETE honestly rather than guessing.

## How the verdict is decided (deterministic)
Questions run in `rank` order:
- A question with `show_if` is **skipped** if its condition is false (e.g., the pregnancy question is skipped for `sex_at_birth == "Male"`).
- `routing` questions (sex_at_birth) collect a value but never disqualify.
- If a question's `disqualify_condition` is true for the patient's answer → **DNQ**, reason = that question.
- A required answer that's missing → **INCOMPLETE**.
- Passed every question → **QUALIFIED**.

## Report
`SCREENING-REPORT.md` + `.html` in the study folder:
- Summary counts (Qualified / DNQ / Incomplete) + DNQ reason breakdown.
- Per-patient result table (patient · result · failed-at · reason).
- Per-patient decision trace (every question, the answer, shown?, disqualified?).

Re-run `screen-report` any time after adding patients; the report regenerates.
