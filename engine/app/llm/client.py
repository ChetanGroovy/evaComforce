"""
The LLM client — the ONE place we talk to a model.

Three backends, picked by config.LLM_PROVIDER (default "auto"):
  • Gemini       — needs GOOGLE_API_KEY (for production / a powerful API later)
  • Claude Code  — shells out to the local `claude` CLI; NO API key, uses your Claude Code
                   login. Great for free local testing. (Slower: spawns a process per call.)
  • none         — no backend → the agent functions use their offline templated/regex fallback.

Everything goes through here so swapping the backend is a one-line config change; the rest of
the engine never knows or cares which model answered.
"""
from __future__ import annotations
import json
import re
import shutil
import subprocess
from app import config

try:
    from google import genai
    from google.genai import types
except Exception:
    genai = None
    types = None


# ───────────────────────── Gemini (API key) ─────────────────────────

class GeminiClient:
    name = "gemini"

    def __init__(self):
        self.client = genai.Client(api_key=config.GOOGLE_API_KEY)
        self.model = config.GEMINI_MODEL

    def text(self, prompt: str, temperature: float = 0.6) -> str:
        r = self.client.models.generate_content(
            model=self.model, contents=prompt,
            config=types.GenerateContentConfig(temperature=temperature))
        return (r.text or "").strip()

    def json(self, prompt: str, schema: dict, temperature: float = 0.0) -> dict:
        r = self.client.models.generate_content(
            model=self.model, contents=prompt,
            config=types.GenerateContentConfig(
                temperature=temperature, response_mime_type="application/json",
                response_schema=schema))
        return json.loads(r.text)


# ───────────────────────── Claude Code CLI (no key) ─────────────────────────

def _extract_json(s: str) -> str:
    """Pull the first {...} block out of a CLI response (it may wrap it in ```json fences)."""
    m = re.search(r"\{.*\}", s, re.S)
    return m.group(0) if m else s


class ClaudeCodeClient:
    """Uses the installed `claude` CLI in print mode — your Claude Code login, no API key."""
    name = "claude_code"

    def __init__(self, exe: str, model: str):
        self.exe = exe
        self.model = model

    def _run(self, prompt: str, timeout: int = 120) -> str:
        proc = subprocess.run(
            [self.exe, "-p", prompt, "--model", self.model, "--allowedTools", "none"],
            capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=timeout)
        return (proc.stdout or "").strip()

    def text(self, prompt: str, temperature: float = 0.6) -> str:
        return self._run(prompt)

    def json(self, prompt: str, schema: dict, temperature: float = 0.0) -> dict:
        keys = list((schema.get("properties") or {}).keys())
        hint = f"\n\nReturn ONLY a JSON object with keys {keys}. No markdown fences, no prose."
        out = self._run(prompt + hint)
        return json.loads(_extract_json(out))


# ───────────────────────── selection ─────────────────────────

_client = None
_looked = False


def get_client():
    """Pick a backend per config.LLM_PROVIDER. None → offline fallback."""
    global _client, _looked
    if _looked:
        return _client
    _looked = True
    p = config.LLM_PROVIDER

    if p == "off":
        _client = None
        return None

    # Gemini — when forced, or in auto mode if a key is present.
    if p == "gemini" or (p == "auto" and config.GOOGLE_API_KEY):
        if genai is not None and config.GOOGLE_API_KEY:
            try:
                _client = GeminiClient()
                return _client
            except Exception as e:
                print(f"[llm] Gemini init failed ({e}).")

    # Claude Code CLI — when forced, or in auto mode with no key.
    if p in ("claude_code", "auto"):
        exe = shutil.which("claude")
        if exe:
            _client = ClaudeCodeClient(exe, config.CLAUDE_CODE_MODEL)
            return _client
        elif p == "claude_code":
            print("[llm] `claude` CLI not found on PATH.")

    _client = None
    return _client


def backend_name() -> str:
    c = get_client()
    return c.name if c else "offline"


def is_live() -> bool:
    return get_client() is not None
