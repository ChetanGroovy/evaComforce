"""Central config. Reads .env if present (no crash if it isn't)."""
import os
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent          # evaComforce/engine/
# Studies live in the repo's shared studies/ folder (evaComforce/studies), so the
# UI list and the engine read exactly ONE source. Override with STUDIES_DIR if needed.
STUDIES_DIR = Path(os.getenv("STUDIES_DIR", str(ROOT.parent / "studies")))

GOOGLE_API_KEY = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")

# Which LLM backend to use:
#   auto        -> Gemini if a key is set, else the local `claude` CLI, else offline
#   gemini      -> force Gemini (needs GOOGLE_API_KEY)
#   claude_code -> force the local `claude` CLI (no API key; uses your Claude Code login)
#   off         -> no LLM (templated/regex fallback only)
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "auto").strip().lower()
CLAUDE_CODE_MODEL = os.getenv("CLAUDE_CODE_MODEL", "haiku")   # fast + cheap for local testing

# Who the agent says it is in messages.
SITE_NAME = os.getenv("SITE_NAME", "DM Clinical Houston")
