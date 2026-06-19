"""
Scripted happy-path demo — no typing needed, no API key needed.

Plays a WC45276 (obesity) screening for a patient who answers in a way that keeps them
eligible, and prints the whole WhatsApp-style thread end to end.

    python demo.py

With a GOOGLE_API_KEY in .env the messages are dynamic (Gemini). Without one, it uses the
offline fallback wording so you can still see the flow work.
"""
import sys
from app.engine import Engine
from app.llm.client import backend_name

# A patient whose answers keep them eligible (age ok, BMI>27, has T2D, tried & failed weight
# loss, and "no" to every exclusion).
PATIENT = {"name": "Judith"}
PATIENT_REPLIES = [
    "Yes I'd like to check",   # interested
    "I'm 54",                  # age
    "5 ft 6",                  # height
    "210 lbs",                 # weight  -> BMI ~33.9
    "yes",                     # type 2 diabetes
    "yeah I've tried so many times",   # failed diet/exercise
    "no",                      # type 1 diabetes
    "no",                      # GLP-1 / injectable
    "no",                      # organ transplant
    "no",                      # gastroparesis
    "no",                      # thyroid / MEN2
    "no",                      # NYHA IV heart failure
    "no",                      # recent cardiac events
]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"[backend] {backend_name()}\n")
    eng = Engine("WC45276")
    s, greeting = eng.start(PATIENT)
    print(f"AGENT  : {greeting}")
    for reply in PATIENT_REPLIES:
        print(f"PATIENT: {reply}")
        msg = eng.reply(s, reply)
        print(f"AGENT  : {msg}")
        if s.state not in ("awaiting_interest", "screening"):
            break
    print(f"\n[outcome] {s.outcome}   (BMI computed: {s.bmi})")


if __name__ == "__main__":
    main()
