"""
The deterministic kernel — loads a study and drives screening: next question, clarify a bad
answer, decide disqualification. NO LLM here. Same answers in → same decision out.

It is CONFIG-DRIVEN (works for any study), and reads two on-disk formats:
  • study.json        — the senior's full config (knowledgeBank + screeningQuestions + criteria + flow)
  • questions.json + knowledge_bank.json  — our older two-file format (WC45276)

Nothing is hardcoded to one study. BMI is only computed when a study actually has height/weight
questions (type "height_weight"); a vaccine study with just age + yes/no questions just works.
"""
from __future__ import annotations
import json
import re
from app import config

PLAUSIBLE_BMI = (13.0, 75.0)
PLAUSIBLE_AGE = (14, 110)
PLAUSIBLE_HEIGHT_M = (1.2, 2.3)


def _num(s):
    m = re.search(r"-?\d+(?:\.\d+)?", str(s))
    return float(m.group(0)) if m else None


def _yesno(s):
    t = re.sub(r"[^a-z]", "", str(s).lower())
    if t.startswith("y"):
        return "yes"
    if t.startswith("n"):
        return "no"
    return None


def _height_m(s):
    a = str(s).lower()
    m = re.search(r"(\d)\s*(?:'|’|ft|feet|foot)\s*(\d{1,2})", a)
    if m:
        return (int(m.group(1)) * 12 + int(m.group(2))) * 0.0254, True
    m = re.search(r"(\d{2,3})\s*cm", a)
    if m:
        return float(m.group(1)) / 100, True
    m = re.search(r"\b(1\.[0-9]{1,2})\s*m\b", a)
    if m:
        return float(m.group(1)), True
    return None, False


def _weight_kg(s):
    a = str(s).lower()
    m = re.search(r"(\d{2,3})(?:\.\d+)?\s*(?:kg|kgs|kilo|kilogram)", a)
    if m:
        return float(m.group(1)), True
    m = re.search(r"(\d{2,3})(?:\.\d+)?\s*(?:lb|lbs|pound)", a)
    if m:
        return float(m.group(1)) * 0.453592, True
    n = _num(a)
    return (n, False) if n is not None else (None, False)


def _eval_numeric(cond: str, x) -> bool:
    """True if value x satisfies a numeric DNQ condition like 'age < 65' or 'age < 18 or age > 80'."""
    if x is None:
        return False
    for clause in re.split(r"\bor\b", cond):
        m = re.search(r"(<=|>=|<|>)\s*(-?\d+(?:\.\d+)?)", clause)
        if not m:
            continue
        op, n = m.group(1), float(m.group(2))
        if (op == "<" and x < n) or (op == "<=" and x <= n) or \
           (op == ">" and x > n) or (op == ">=" and x >= n):
            return True
    return False


class Flow:
    def __init__(self, study_id: str):
        d = config.STUDIES_DIR / study_id
        self.study_id = study_id
        self.name = study_id
        self.kb: dict[str, str] = {}          # {section_name: text}
        self.general_info = ""
        self.questions: list[dict] = []        # normalized: id, text, type, disqualify_if, ...
        self.bmi_enabled = False
        self.height_qid = self.weight_qid = None
        self.bmi_gate = 27.0

        if (d / "study.json").exists():
            self._load_study_json(d / "study.json")
        else:
            self._load_legacy(d)
        self._setup_bmi()

    # ---- loaders ----
    def _load_study_json(self, path):
        cfg = json.load(open(path, encoding="utf-8"))
        self.name = cfg.get("study", {}).get("name", self.study_id)
        self.kb = {k: v for k, v in (cfg.get("knowledgeBank") or {}).items() if isinstance(v, str)}
        self.general_info = self.kb.get("General Study Information", "")
        qs = cfg.get("refinedQuestions") or cfg.get("screeningQuestions") or []
        for q in qs:
            if q.get("included_in_flow", True) and not q.get("gender_filter"):
                self.questions.append({
                    "id": q.get("variable_name") or q.get("id"),
                    "fact": q.get("fact"),                       # shared key (multi-study glue)
                    "text": q.get("sms_question") or q.get("text"),
                    "type": q.get("answer_type") or q.get("type", "yes_no"),
                    "polarity": q.get("polarity"),
                    "disqualify_if": q.get("disqualify_condition") or q.get("disqualify_if", ""),
                    "knockout_power": q.get("knockout_power"),
                    "criteria_ids": q.get("criteria_ids", []),
                    "allowed_exceptions": q.get("allowed_exceptions", ""),
                })

    def _load_legacy(self, d):
        doc = json.load(open(d / "questions.json", encoding="utf-8"))
        kbdoc = json.load(open(d / "knowledge_bank.json", encoding="utf-8"))
        self.name = doc.get("study_name", self.study_id)
        kb = kbdoc.get("knowledge_bank", {})
        self.kb = {k: (v.get("text") if isinstance(v, dict) else v) for k, v in kb.items()}
        self.general_info = self.kb.get("general_study_information", "")
        self.derived = doc.get("derived", {})
        for q in doc["questions"]:
            if q.get("tier") == "core" and not q.get("gender_filter"):
                self.questions.append({
                    "id": q["id"], "text": q["text"], "type": q["type"],
                    "disqualify_if": q.get("disqualify_if", ""),
                    "knockout_power": q.get("knockout_power"),
                    "criteria_ids": q.get("from_criteria", []),
                })

    def _setup_bmi(self):
        hw = [q for q in self.questions if q["type"] == "height_weight"]
        if len(hw) >= 2:
            self.bmi_enabled = True
            self.height_qid, self.weight_qid = hw[0]["id"], hw[1]["id"]
            gate = (getattr(self, "derived", {}).get("bmi", {}) or {}).get("disqualify_if", "")
            m = re.search(r"<\s*(\d+(?:\.\d+)?)", gate)
            if m:
                self.bmi_gate = float(m.group(1))

    # ---- info for the greeting / KB answers ----
    def study_info(self) -> dict:
        return {"name": self.name, "general_info": self.general_info}

    # ---- sequencing ----
    def first(self):
        return self.questions[0]

    def question(self, qid):
        return next(q for q in self.questions if q["id"] == qid)

    def next_question(self, session):
        for q in self.questions:
            if q["id"] not in session.answers:
                return q
        return None

    # ---- record + (re)derive BMI when the study uses it ----
    def record(self, session, question, value):
        session.answers[question["id"]] = value
        if self.bmi_enabled and question["id"] in (self.height_qid, self.weight_qid):
            session.bmi = None
            self._compute_bmi(session)

    def _compute_bmi(self, session):
        if self.height_qid not in session.answers or self.weight_qid not in session.answers:
            return
        h, _ = _height_m(session.answers[self.height_qid])
        wk, had_unit = _weight_kg(session.answers[self.weight_qid])
        if not h or wk is None:
            return
        if had_unit:
            session.bmi = round(wk / (h * h), 1)
            return
        raw = _num(session.answers[self.weight_qid])
        opts = [(raw / (h * h), raw), (raw * 0.453592 / (h * h), raw)]
        plausible = [o for o in opts if PLAUSIBLE_BMI[0] <= o[0] <= PLAUSIBLE_BMI[1]]
        session.bmi = round((min(plausible, key=lambda c: abs(c[0] - 30))[0]
                             if plausible else raw / (h * h)), 1)

    # ---- clarify an unparseable / implausible answer ----
    def clarify(self, question, value, session):
        qtype, qid = question["type"], question["id"]
        cond = (question.get("disqualify_if") or "").lower()
        if qtype == "number":
            n = _num(value)
            if n is None:
                return "Sorry, I didn't catch that — could you reply with a number?"
            if "age" in cond and not (PLAUSIBLE_AGE[0] <= n <= PLAUSIBLE_AGE[1]):
                return "Sorry, I didn't catch that — what's your age in years?"
        if qtype == "height_weight" and qid == self.height_qid:
            h, _ = _height_m(value)
            if h is None or not (PLAUSIBLE_HEIGHT_M[0] <= h <= PLAUSIBLE_HEIGHT_M[1]):
                return "Could you share your height? For example \"5 ft 9\" or \"175 cm\"."
        if qtype == "height_weight" and qid == self.weight_qid:
            if session.bmi is None or not (PLAUSIBLE_BMI[0] <= session.bmi <= PLAUSIBLE_BMI[1]):
                session.bmi = None
                return "Thanks! Just to be sure — what's your current weight, in pounds or kilograms?"
        return None

    # ---- the only place eligibility is decided ----
    def disqualifies(self, question, value, session):
        cond = (question.get("disqualify_if") or "").lower().strip()
        if cond == "answer == no" and _yesno(value) == "no":
            return question["text"]
        if cond == "answer == yes" and _yesno(value) == "yes":
            return question["text"]
        if cond and "answer ==" not in cond and re.search(r"\d", cond) and "bmi" not in cond:
            if _eval_numeric(cond, _num(value)):
                return question["text"]
        # BMI gate (only for studies that compute it), fires on the weight question
        if self.bmi_enabled and question["id"] == self.weight_qid and session.bmi is not None:
            if session.bmi < self.bmi_gate:
                return f"BMI {session.bmi} is below {self.bmi_gate}"
        return None
