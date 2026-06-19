"""
refine.py — turn the senior's raw study.json into an engine-ready REFINED question list.

    python refine.py C4771002

Our LLM reads the study's criteria + the colleague's draft screeningQuestions and writes a
`refinedQuestions` array back into study.json. Each refined question gets:
  • fact      — a canonical shared key (age, prior_cdi, …) → the glue for multi-study reroute
  • text      — a warm, natural human SMS phrasing (meaning kept EXACTLY)
  • polarity  — requirement (a 'no' disqualifies) | exclusion (a 'yes' disqualifies) | neutral
  • disqualify_if, knockout_power, criteria_ids, allowed_exceptions

The engine already prefers `refinedQuestions` over the raw `screeningQuestions`, so after this
runs the engine asks the refined list. Eligibility logic is unchanged — this only structures +
phrases. (Draft — a human should still review before it gates real patients.)
"""
import sys
import json
from app import config
from app.llm.client import get_client, backend_name

SCHEMA = {
    "type": "object",
    "properties": {"questions": {"type": "array", "items": {"type": "object", "properties": {
        "id": {"type": "string"},
        "fact": {"type": "string"},
        "text": {"type": "string"},
        "type": {"type": "string", "enum": ["number", "yes_no", "height_weight", "choice", "text"]},
        "polarity": {"type": "string", "enum": ["requirement", "exclusion", "neutral"]},
        "disqualify_if": {"type": "string"},
        "knockout_power": {"type": "string", "enum": ["high", "medium", "low"]},
        "criteria_ids": {"type": "array", "items": {"type": "string"}},
        "allowed_exceptions": {"type": "string"},
    }, "required": ["id", "fact", "text", "type", "polarity", "disqualify_if", "criteria_ids"]}}},
    "required": ["questions"],
}

PROMPT = """You are refining a clinical-trial pre-screen for a TEXT (SMS/WhatsApp) chatbot.
You're given the study's eligibility criteria and a colleague's draft screening questions.
Produce a REFINED question list the chatbot will ask. For EACH draft question, return:
- id: keep the colleague's variable_name exactly.
- fact: a canonical snake_case key for WHAT it measures, meant to be reused across studies
  (age, bmi, type_2_diabetes, prior_cdi, bowel_resection, immunocompromised, vaccine_anaphylaxis…).
  Same concept across studies MUST get the same fact name.
- text: a warm, natural, human SMS phrasing (<= 25 words). KEEP THE MEDICAL MEANING EXACTLY — do
  not change what is being asked or which answer qualifies.
- type: number | yes_no | height_weight | choice | text.
- polarity: 'requirement' if the study NEEDS a yes (a 'no' disqualifies); 'exclusion' if a 'yes'
  disqualifies; else 'neutral'.
- disqualify_if: keep the colleague's condition verbatim (e.g. 'age < 65', 'answer == no', 'answer == yes').
- knockout_power: high | medium | low (keep the colleague's if given).
- criteria_ids: keep the colleague's mapping.
- allowed_exceptions: a short note of any carve-out the patient should know (e.g. 'an appendix
  removal does not count'), else "".
Keep the SAME questions in the SAME order — do not add, drop, merge, or reorder. Return JSON {questions:[...]}.

CRITERIA:
%s

DRAFT QUESTIONS:
%s
"""


def _criteria_block(cfg: dict) -> str:
    lines = []
    for c in cfg.get("inclusionCriteria", []):
        lines.append(f"INC-{c['criterion_number']}: {c['criterion_text']}")
    for c in cfg.get("exclusionCriteria", []):
        lines.append(f"EXC-{c['criterion_number']}: {c['criterion_text']}")
    return "\n".join(lines)


def main():
    if len(sys.argv) < 2:
        sys.exit("usage: python refine.py <STUDY_ID>")
    sid = sys.argv[1]
    path = config.STUDIES_DIR / sid / "study.json"
    if not path.exists():
        sys.exit(f"no study.json at {path}")

    cfg = json.load(open(path, encoding="utf-8"))
    drafts = cfg.get("screeningQuestions", [])
    if not drafts:
        sys.exit("no screeningQuestions to refine")

    c = get_client()
    if c is None:
        sys.exit(f"no LLM backend available (backend={backend_name()}). "
                 f"Set LLM_PROVIDER / a key, or ensure the claude CLI is installed.")

    print(f"[backend] {backend_name()} — refining {len(drafts)} questions for {sid} …")
    draft_compact = [{k: q.get(k) for k in
                      ("variable_name", "sms_question", "answer_type", "disqualify_condition",
                       "knockout_power", "criteria_ids")} for q in drafts]
    prompt = PROMPT % (_criteria_block(cfg), json.dumps(draft_compact, indent=1))
    refined = c.json(prompt, SCHEMA)["questions"]

    cfg["refinedQuestions"] = refined
    json.dump(cfg, open(path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)

    sys.stdout.reconfigure(encoding="utf-8")
    print(f"wrote {len(refined)} refined questions into {path}\n")
    for q in refined:
        print(f"  {q['id']}  [{q['fact']}]  ({q['polarity']})")
        print(f"      {q['text']}")


if __name__ == "__main__":
    main()
