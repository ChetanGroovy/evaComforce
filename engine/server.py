"""
Web server — puts the SAME engine behind a simple HTTP API + a UI page.

    python server.py            # then open http://127.0.0.1:8000

Endpoints:
  GET  /api/studies            -> [{id, name}]   (folders under app/studies/)
  POST /api/start  {study_id, name}              -> {session_id, message, state, done}
  POST /api/reply  {session_id, message}         -> {message, state, outcome, done}
  GET  /                       -> the dashboard page

Sessions live in memory (fine for local). No engine logic changes — this only exposes it.
"""
import json
import uuid
from pathlib import Path

import uvicorn
from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from app import config
from app.engine import Engine

WEB = Path(__file__).resolve().parent / "web"
app = FastAPI(title="Comforce Screening Console")

_engines: dict[str, Engine] = {}      # study_id -> Engine (cached)
_sessions: dict[str, tuple] = {}      # session_id -> (engine, session)

DONE_STATES = ("qualified", "dnq", "closed_not_interested")


def _engine(study_id: str) -> Engine:
    if study_id not in _engines:
        _engines[study_id] = Engine(study_id)
    return _engines[study_id]


def _study_name(study_id: str) -> str:
    d = config.STUDIES_DIR / study_id
    try:
        if (d / "study.json").exists():
            return json.load(open(d / "study.json", encoding="utf-8")).get("study", {}).get("name", study_id)
        if (d / "questions.json").exists():
            return json.load(open(d / "questions.json", encoding="utf-8")).get("study_name", study_id)
    except Exception:
        pass
    return study_id


@app.get("/api/studies")
def studies():
    out = []
    for d in sorted(config.STUDIES_DIR.iterdir()):
        if d.is_dir() and ((d / "study.json").exists() or (d / "questions.json").exists()):
            out.append({"id": d.name, "name": _study_name(d.name)})
    return out


@app.get("/api/study/{study_id}")
def study_detail(study_id: str):
    """Normalized study meta + a short summary, for the sidebar."""
    d = config.STUDIES_DIR / study_id
    try:
        if (d / "study.json").exists():
            cfg = json.load(open(d / "study.json", encoding="utf-8"))
            kb = cfg.get("knowledgeBank", {})
            return {"meta": cfg.get("study", {}),
                    "summary": kb.get("General Study Information", "")}
        if (d / "questions.json").exists():
            q = json.load(open(d / "questions.json", encoding="utf-8"))
            kbf = json.load(open(d / "knowledge_bank.json", encoding="utf-8")).get("knowledge_bank", {})
            gi = kbf.get("general_study_information", {})
            return {"meta": {
                "name": q.get("study_name", study_id),
                "internalNumber": q.get("study_id", study_id),
                "sponsor": q.get("sponsor", ""),
                "drug": q.get("investigational_drug", ""),
                "flowStatus": q.get("review_status", ""),
            }, "summary": gi.get("text", "") if isinstance(gi, dict) else ""}
    except Exception as e:
        return {"meta": {"name": study_id}, "summary": "", "error": str(e)}
    return {"meta": {"name": study_id}, "summary": ""}


class StartReq(BaseModel):
    study_id: str
    name: str = "there"


@app.post("/api/start")
def start(req: StartReq):
    eng = _engine(req.study_id)
    s, greeting = eng.start({"name": (req.name or "there").strip()})
    sid = uuid.uuid4().hex
    _sessions[sid] = (eng, s)
    return {"session_id": sid, "message": greeting, "state": s.state, "done": False}


class ReplyReq(BaseModel):
    session_id: str
    message: str


@app.post("/api/reply")
def reply(req: ReplyReq):
    pair = _sessions.get(req.session_id)
    if not pair:
        return {"error": "unknown session"}
    eng, s = pair
    msg = eng.reply(s, req.message)
    return {"message": msg, "state": s.state, "outcome": s.outcome, "done": s.state in DONE_STATES}


@app.get("/")
def index():
    return HTMLResponse((WEB / "index.html").read_text(encoding="utf-8"))


if __name__ == "__main__":
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()
    print(f"Comforce Screening Console -> http://{args.host}:{args.port}")
    uvicorn.run("server:app", host=args.host, port=args.port, reload=False)
