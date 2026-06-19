"""
The agent's "voice and ears" — every place the LLM phrases something or understands a reply.

Each function works two ways:
  • LLM mode  (Gemini key present): dynamic, human, natural — the real thing.
  • offline   (no key):             a simple templated/regex fallback so the engine still runs.

NOTE: none of these decide eligibility. They only phrase messages and turn the patient's
words into a clean value. The deterministic kernel (kernel/flow.py) makes the actual decisions.
"""
from __future__ import annotations
import re
from app.config import SITE_NAME
from app.llm.client import get_client

PERSONA = (
    f"You are a warm, friendly clinical-trial recruiter texting on behalf of {SITE_NAME}. "
    "You text like a kind human on WhatsApp: short messages, plain English, no medical jargon, "
    "one question at a time. Never sound robotic or clinical."
)

# ───────────────────────── 1. GREETING (dynamic first message) ─────────────────────────

def generate_greeting(patient: dict, general_info: str) -> str:
    name = patient.get("name", "there")
    summary = general_info or "a paid clinical research study"
    c = get_client()
    if c:
        prompt = (
            f"{PERSONA}\n\n"
            f"Write the FIRST outreach text to a potential participant named {name}.\n"
            f"What the study is about (paraphrase warmly in your own words, do NOT copy or dump it):\n"
            f"\"{summary}\"\n\n"
            f"Rules:\n"
            f"- Start with 'Hi {name}!'\n"
            f"- Say you're reaching out from {SITE_NAME}.\n"
            f"- One friendly sentence about what the paid study is for (from the summary above).\n"
            f"- End by asking if they'd like to see if they may qualify.\n"
            f"- Max ~2 short sentences + the question. Plain text only."
        )
        return c.text(prompt, temperature=0.7)
    # offline fallback
    return (f"Hi {name}! I'm reaching out from {SITE_NAME} about a paid research study. "
            f"Would you like to see if you may qualify?")


# ───────────────────────── 2. INTEREST (reply to the greeting) ─────────────────────────

_YES = {"yes", "y", "yeah", "yep", "yup", "sure", "ok", "okay", "interested", "i am", "im in",
        "sounds good", "yes please", "definitely", "absolutely", "correct", "i have", "i do"}
_NO = {"no", "n", "nope", "nah", "none", "never", "no thanks", "i dont", "i havent"}
# Only these EXPLICIT phrases mean "opt out" — a bare "no" is a valid answer to a yes/no question.
_OPTOUT = ("not interested", "stop", "unsubscribe", "remove me", "leave me alone",
           "do not contact", "dont contact", "quit", "go away")


def interpret_interest(message: str) -> str:
    """Return 'yes' | 'no' | 'question' | 'unclear' for the reply to the greeting."""
    c = get_client()
    if c:
        schema = {"type": "object", "properties": {
            "intent": {"type": "string", "enum": ["yes", "no", "question", "unclear"]}},
            "required": ["intent"]}
        prompt = (
            "A patient was asked if they'd like to see if they qualify for a paid medical study.\n"
            f"Their reply: \"{message}\"\n"
            "Classify intent: 'yes' (wants to proceed), 'no' (not interested / opt out), "
            "'question' (asked something back first), or 'unclear'."
        )
        try:
            return c.json(prompt, schema)["intent"]
        except Exception:
            pass
    t = re.sub(r"[^a-z ]", "", message.lower()).strip()
    if t in _NO or any(t.startswith(w) for w in _NO):
        return "no"
    if t in _YES or any(w in t for w in _YES):
        return "yes"
    if "?" in message:
        return "question"
    return "unclear"


# ───────────────────────── 3. PHRASE the next question ─────────────────────────

def phrase_question(question: dict, history: list, patient: dict) -> str:
    c = get_client()
    qtext = question["text"]
    if c:
        last_answer = ""
        for role, msg in reversed(history):
            if role == "patient":
                last_answer = msg
                break
        prompt = (
            f"{PERSONA}\n\n"
            f"You're screening {patient.get('name','the patient')}. Ask the NEXT question, "
            f"rephrased warmly and conversationally for a text chat.\n"
            f"- Keep the MEDICAL MEANING EXACTLY THE SAME. Do not change what is being asked.\n"
            f"- You may add a tiny friendly acknowledgement of their last reply (\"{last_answer}\").\n"
            f"- Max ~1-2 short sentences. Plain text only.\n\n"
            f"Next question to ask: \"{qtext}\""
        )
        return c.text(prompt, temperature=0.6)
    return qtext   # offline: just ask the bank's wording


# ───────────────────────── 4. INTERPRET an answer ─────────────────────────

_INTERPRET_SCHEMA = {"type": "object", "properties": {
    "intent": {"type": "string", "enum": ["answer", "question", "not_interested", "unclear", "stop"]},
    "value": {"type": "string"},
    "confidence": {"type": "string", "enum": ["high", "low"]},
}, "required": ["intent", "value", "confidence"]}


def interpret(message: str, question: dict) -> dict:
    """Patient reply → {intent, value, confidence}. value is normalized for the question type."""
    qtype = question.get("type", "yes_no")
    c = get_client()
    if c:
        prompt = (
            "Interpret a patient's text reply to ONE screening question.\n"
            f"Question asked: \"{question['text']}\"\n"
            f"Expected answer type: {qtype}\n"
            f"Patient reply: \"{message}\"\n\n"
            "Return:\n"
            "- intent: 'answer' (they answered), 'question' (asked something back), "
            "'not_interested', 'stop', or 'unclear'.\n"
            "- value (normalized): for yes_no -> 'yes' or 'no'; for number -> just the number; "
            "for height_weight -> exactly what they gave (e.g. '5 ft 6' or '200 lbs').\n"
            "- confidence: 'high' or 'low'."
        )
        try:
            return c.json(prompt, _INTERPRET_SCHEMA)
        except Exception:
            pass
    return _fallback_interpret(message, qtype)


def _fallback_interpret(message: str, qtype: str) -> dict:
    low = message.lower()
    if any(p in low for p in _OPTOUT):            # explicit opt-out only
        return {"intent": "not_interested", "value": "", "confidence": "high"}
    t = re.sub(r"[^a-z ]", "", low).strip()
    words = t.split(" ")
    if qtype == "yes_no":
        if t in _YES or words[0] in _YES:
            return {"intent": "answer", "value": "yes", "confidence": "high"}
        if t in _NO or words[0] in _NO:
            return {"intent": "answer", "value": "no", "confidence": "high"}
        if "?" in message:
            return {"intent": "question", "value": "", "confidence": "high"}
        return {"intent": "unclear", "value": "", "confidence": "low"}
    if "?" in message and not re.search(r"\d", message):
        return {"intent": "question", "value": "", "confidence": "high"}
    # number / height_weight -> keep the raw text, the kernel parses numbers out
    return {"intent": "answer", "value": message.strip(), "confidence": "high"}


# ───────────────────────── 4b. ANSWER a patient's question (from Knowledge Bank) ─────────────────────────

def answer_kb(message: str, kb_sections: dict) -> str:
    """The patient asked something back — answer briefly from the study's Knowledge Bank.
    kb_sections is a flat {section_name: text} dict."""
    parts = [f"{k.replace('_', ' ')}: {v}" for k, v in kb_sections.items() if v]
    kb_text = "\n".join(parts)[:2500]

    c = get_client()
    if c:
        prompt = (
            f"{PERSONA}\n\n"
            f"The patient asked: \"{message}\"\n"
            f"Answer briefly and warmly using ONLY the study info below. If it isn't covered, say "
            f"our coordinator can go over that on a quick call. 1-2 short sentences, plain text.\n\n"
            f"Study info:\n{kb_text}"
        )
        return c.text(prompt, temperature=0.4)

    # offline fallback: handle the common "how much does it pay?" case from the KB
    low = message.lower()
    if any(w in low for w in ("pay", "paid", "compensat", "money", "stipend", "cost")):
        for k, v in kb_sections.items():
            if "compensat" in k.lower() and v:
                return v
    return "Good question — our study coordinator can go over those details on a quick call."


# ───────────────────────── 5. QUALIFIED (closing message) ─────────────────────────

def phrase_qualified(patient: dict, study_name: str) -> str:
    name = patient.get("name", "")
    c = get_client()
    if c:
        prompt = (
            f"{PERSONA}\n\n"
            f"{name} just finished the pre-screen and looks like they MAY qualify for the study. "
            f"Write a short, warm closing text: thank them, say it looks like they may be a good "
            f"fit, and that someone from the team will reach out to set up a quick call to confirm "
            f"and answer questions. Max ~2 short sentences. Plain text only."
        )
        return c.text(prompt, temperature=0.6)
    return (f"Great news{', ' + name if name else ''}! Based on your answers you may be a good fit. "
            f"Someone from our team will reach out soon to set up a quick call. Thank you! 💜")


# ───────────────────────── 6. NUDGE (follow-up if no reply) ─────────────────────────

def generate_nudge(patient: dict, attempt: int = 1) -> str:
    name = patient.get("name", "there")
    c = get_client()
    if c:
        prompt = (
            f"{PERSONA}\n\n"
            f"{name} didn't reply to our earlier text about a paid weight/type 2 diabetes study. "
            f"Write a short, friendly follow-up nudge (attempt #{attempt}) gently asking if they'd "
            f"still like to see if they may qualify. No pressure. Max 1-2 short sentences."
        )
        return c.text(prompt, temperature=0.7)
    return (f"Hi {name}, just following up from {SITE_NAME} — would you still like to see if you "
            f"may qualify for our paid study? Just reply YES and we'll get started.")
