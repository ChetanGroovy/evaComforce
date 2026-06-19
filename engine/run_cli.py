"""
Interactive WhatsApp-style test — YOU play the patient, type replies.

    python run_cli.py
    python run_cli.py "Maria"      # set the patient name

Type your replies at the > prompt. Ctrl+C to quit.
"""
import sys
from app.engine import Engine
from app.llm.client import backend_name


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    name = sys.argv[1] if len(sys.argv) > 1 else "Judith"
    print(f"[backend] {backend_name()}")
    print("(type your replies as the patient; Ctrl+C to quit)\n")

    eng = Engine("WC45276")
    s, greeting = eng.start({"name": name})
    print(f"AGENT : {greeting}")
    while s.state in ("awaiting_interest", "screening"):
        try:
            text = input("YOU   > ").strip()
        except (EOFError, KeyboardInterrupt):
            print()
            break
        if not text:
            continue
        print(f"AGENT : {eng.reply(s, text)}")
    print(f"\n[outcome] {s.outcome}   (BMI: {s.bmi})")


if __name__ == "__main__":
    main()
