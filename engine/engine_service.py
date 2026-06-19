"""
engine_service.py — the Comforce brain, exposed over HTTP.

This is YOUR Python engine (app.engine.Engine) behind a tiny HTTP API so the
comforce_v2 TypeScript server can call it. Python stays the SINGLE source of
truth for the whole conversation: greeting, warm phrasing, Knowledge-Bank
answers, free-text understanding, BMI, the rules, the never-lose handling.

comforce_v2 is only the face — Chetan's React UI + question-generation, plus a
thin proxy (apps/api/src/routes/screen.ts) that forwards screening calls here.
So nothing about the eligibility logic is reimplemented; it lives here, once.

    python engine_service.py              # http://127.0.0.1:7801
    $env:LLM_PROVIDER="off"               # (optional) fast rule/templated mode
    $env:STUDIES_DIR="...\\evaComforce\\studies"   # (optional) shared studies folder

Endpoints (the exact shape comforce_v2's web/src/api.ts already expects):
    POST /screen/start   {studyId, name?}   -> {sessionId, greeting, consent, done}
    POST /screen/answer  {sessionId, text}  -> {done, prompt}  |  terminal payload
    POST /humanize       {studyId}          -> rewrites question wording in study.json
    GET  /health
"""
import json
import os
import uuid

import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app import config
from app.engine import Engine
from app.llm import agent
from app.llm.client import backend_name

app = FastAPI(title="Comforce Engine service (the brain)")

_engines: dict[str, Engine] = {}          # study_id -> Engine (loads the study once)
_sessions: dict[str, tuple] = {}          # sessionId -> (engine, session)
DONE_STATES = ("qualified", "dnq", "closed_not_interested")


def _engine(study_id: str) -> Engine:
    if study_id not in _engines:
        _engines[study_id] = Engine(study_id)
    return _engines[study_id]


def _terminal(outcome: str | None) -> str:
    return {"qualified": "QUALIFIED", "dnq": "DNQ"}.get(outcome or "", "INCOMPLETE")


def _trace(eng: Engine, s) -> list[dict]:
    rows = []
    for i, q in enumerate(eng.flow.questions):
        if q["id"] in s.answers:
            rows.append({"rank": i + 1, "variable": q["id"], "answer": s.answers[q["id"]],
                         "disqualified": s.dnq_qid == q["id"]})
    return rows


# ── screening (runs entirely through OUR engine) ─────────────────────────────
class StartReq(BaseModel):
    studyId: str
    name: str | None = None


@app.post("/screen/start")
def screen_start(req: StartReq):
    try:
        eng = _engine(req.studyId)
    except Exception as e:  # study not found / failed to load
        return JSONResponse({"error": f"study '{req.studyId}' not found: {e}"}, status_code=404)
    s, greeting = eng.start({"name": (req.name or "there").strip() or "there"})
    sid = uuid.uuid4().hex
    _sessions[sid] = (eng, s)
    return {"sessionId": sid, "greeting": greeting, "consent": True, "done": False}


class AnswerReq(BaseModel):
    sessionId: str
    text: str = ""


@app.post("/screen/answer")
def screen_answer(req: AnswerReq):
    pair = _sessions.get(req.sessionId)
    if not pair:
        return JSONResponse({"error": "session not found"}, status_code=404)
    eng, s = pair
    msg = eng.reply(s, req.text)
    if s.state in DONE_STATES:
        _sessions.pop(req.sessionId, None)
        return {"done": True, "terminal": _terminal(s.outcome),
                "reason": s.dnq_reason or msg, "closing": msg, "trace": _trace(eng, s)}
    return {"done": False, "prompt": msg}


# ── humanize generated questions (study-creation pipeline calls this) ────────
# Rewrites ONLY each question's wording (sms_question) into plain, patient-friendly
# language via OUR LLM. Every machine field is preserved, so eligibility is unchanged.
# Idempotent: the true original is stashed once in sms_question_raw and re-humanized
# from it, so re-running never drifts.
class HumanizeReq(BaseModel):
    studyId: str | None = None          # mode A: humanize this study's study.json in place
    questions: list[dict] | None = None  # mode B: humanize a list, return it (no file write)
    dry_run: bool = False                # mode A: preview only, don't write the file


def _humanize_one(q: dict) -> dict:
    raw = q.get("sms_question_raw") or q.get("sms_question") or q.get("text") or ""
    new = agent.humanize_question(
        raw,
        q.get("answer_type") or q.get("type", "yes_no"),
        q.get("choices"),
    )
    q["sms_question_raw"] = raw
    q["sms_question"] = new
    return {"variable_name": q.get("variable_name") or q.get("id"), "before": raw, "after": new}


@app.post("/humanize")
def humanize(req: HumanizeReq):
    # mode A — a study folder: load study.json, rewrite, (optionally) write back
    if req.studyId:
        path = config.STUDIES_DIR / req.studyId / "study.json"
        if not path.exists():
            return JSONResponse({"error": f"study.json not found for '{req.studyId}'"}, status_code=404)
        cfg = json.loads(path.read_text(encoding="utf-8"))
        key = "refinedQuestions" if cfg.get("refinedQuestions") else "screeningQuestions"
        qs = cfg.get(key) or []
        changes = [_humanize_one(q) for q in qs if (q.get("sms_question") or q.get("text"))]
        if not req.dry_run:
            path.write_text(json.dumps(cfg, indent=2, ensure_ascii=False), encoding="utf-8")
        return {"studyId": req.studyId, "count": len(changes), "written": not req.dry_run,
                "backend": backend_name(), "changes": changes}

    # mode B — a raw questions list: return the humanized list, write nothing
    if req.questions is not None:
        out = []
        for q in req.questions:
            q = dict(q)
            _humanize_one(q)
            out.append(q)
        return {"count": len(out), "backend": backend_name(), "questions": out}

    return JSONResponse({"error": "provide either studyId or questions"}, status_code=400)


@app.get("/health")
def health():
    return {"ok": True, "studies_dir": str(config.STUDIES_DIR),
            "llm_provider": config.LLM_PROVIDER}


if __name__ == "__main__":
    port = int(os.getenv("ENGINE_PORT", "7801"))
    print(f"Comforce Engine service (the brain) -> http://127.0.0.1:{port}")
    print(f"  studies from: {config.STUDIES_DIR}")
    print(f"  LLM provider: {config.LLM_PROVIDER}")
    uvicorn.run("engine_service:app", host="127.0.0.1", port=port, reload=False)
