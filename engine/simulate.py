"""
Patient-simulation + analysis harness (domain-agnostic).

For each study, it builds synthetic patients FROM THAT STUDY'S OWN questions:
  • 1 "Ideal Qualifier" — answers every gate to pass
  • N patients who each fail exactly ONE gate (so we see every DNQ reason)
The engine asks the questions, the patient answers, and we capture transcripts + outcomes.
Works for any indication (cardiovascular, obesity, vaccine…) — no per-study authoring.

    python simulate.py AZD0780 WC45276     # run these studies
    python simulate.py                     # all studies present
    python simulate.py --llm AZD0780       # use the live LLM backend (slower)

Eligibility is decided by the engine's deterministic kernel; we only feed answers.
"""
import os
import re
import sys
import json
from pathlib import Path

if "--llm" not in sys.argv:                       # fast offline backend by default
    os.environ["LLM_PROVIDER"] = "off"

from app.engine import Engine
from app import config

HERE = Path(__file__).resolve().parent
OUT = HERE / "analysis"
H_M = 1.676                                        # assumed height (5'6") for BMI math


def _pass_num(cond: str) -> str:
    """A numeric answer that PASSES a condition like 'age < 65' or 'age < 18 or age > 80'."""
    lo = hi = None
    for cl in re.split(r"\bor\b", cond):
        m = re.search(r"(<=|<|>=|>)\s*(\d+\.?\d*)", cl)
        if not m:
            continue
        op, n = m.group(1), float(m.group(2))
        if op in ("<", "<="):
            lo = n                                 # to pass, value must be >= n
        else:
            hi = n                                 # to pass, value must be <= n
    if lo is not None and hi is not None:
        return str(int((lo + hi) / 2))
    if lo is not None:
        return str(int(lo + 5))
    if hi is not None:
        return str(int(hi - 5))
    return "45"


def _fail_num(cond: str) -> str:
    for cl in re.split(r"\bor\b", cond):
        m = re.search(r"(<=|<|>=|>)\s*(\d+\.?\d*)", cl)
        if not m:
            continue
        op, n = m.group(1), float(m.group(2))
        return str(int(n - 2)) if op in ("<", "<=") else str(int(n + 2))
    return "0"


def _weight_for_bmi(bmi: float) -> str:
    return f"{int(bmi * H_M * H_M / 0.453592)} lbs"


HUMAN_NAMES = ["Maria", "David", "Susan", "Robert", "Linda", "James", "Karen", "Tom"]


def pass_ans(q: dict, flow) -> str:
    t, cond, pol = q["type"], (q.get("disqualify_if") or "").lower(), q.get("polarity")
    if "sex" in q["text"].lower() or "gender" in q["text"].lower():
        return "Female"
    if t == "height_weight":
        return "5 ft 6" if q["id"] == flow.height_qid else _weight_for_bmi(flow.bmi_gate + 3)
    if t == "number":
        return _pass_num(cond)
    if "answer == no" in cond:   return "yes"      # requirement: a 'no' would DNQ
    if "answer == yes" in cond:  return "no"       # exclusion:   a 'yes' would DNQ
    if pol == "requirement":     return "yes"
    return "no"


def fail_ans(q: dict, flow) -> str:
    t, cond, pol = q["type"], (q.get("disqualify_if") or "").lower(), q.get("polarity")
    if "sex" in q["text"].lower() or "gender" in q["text"].lower():
        return "Female"                            # sex is neutral (no gate) — keep it sensible
    if t == "height_weight":
        return "5 ft 6" if q["id"] == flow.height_qid else _weight_for_bmi(flow.bmi_gate - 5)
    if t == "number":
        return _fail_num(cond)
    if "answer == no" in cond:   return "no"
    if "answer == yes" in cond:  return "yes"
    if pol == "requirement":     return "no"
    return "yes"


def is_gate(q: dict, flow) -> bool:
    if (q.get("disqualify_if") or "").strip() and "used with" not in q.get("disqualify_if", "").lower():
        return True
    return flow.bmi_enabled and q["id"] == flow.weight_qid     # BMI gate sits on the weight question


def _label(q: dict) -> str:
    return q.get("fact") or " ".join(re.findall(r"[A-Za-z0-9']+", q["text"])[:6])


def build_personas(flow) -> list[dict]:
    base = {q["id"]: pass_ans(q, flow) for q in flow.questions}
    personas = [{"name": "Ideal Qualifier", "intent": "qualify", "answers": dict(base)}]
    gates = [q for q in flow.questions if is_gate(q, flow)]
    # spread up to 4 gates to fail (so we get distinct DNQ reasons)
    pick = gates if len(gates) <= 4 else [gates[round(i * (len(gates) - 1) / 3)] for i in range(4)]
    seen = set()
    for q in pick:
        if q["id"] in seen:
            continue
        seen.add(q["id"])
        ans = dict(base)
        ans[q["id"]] = fail_ans(q, flow)
        personas.append({"name": f"Fails: {_label(q)}", "intent": f"DNQ at {q['id']}", "answers": ans})
    for i, p in enumerate(personas):
        p["pname"] = HUMAN_NAMES[i % len(HUMAN_NAMES)]   # realistic name for the greeting
    return personas


def run_one(flow_engine: Engine, persona: dict) -> dict:
    s, greeting = flow_engine.start({"name": persona.get("pname", persona["name"])})
    transcript = [("agent", greeting)]
    guard = 0
    while s.state in ("awaiting_interest", "screening") and guard < 60:
        guard += 1
        if s.state == "awaiting_interest":
            ans = "Yes, I'd like to check"
        else:
            q = flow_engine.flow.question(s.current_q)
            ans = persona["answers"].get(q["id"], pass_ans(q, flow_engine.flow))
        transcript.append(("patient", ans))
        transcript.append(("agent", flow_engine.reply(s, ans)))
    return {"persona": persona["name"], "intent": persona["intent"], "outcome": s.outcome,
            "dnq_reason": s.dnq_reason, "bmi": s.bmi,
            "questions_answered": sum(1 for r, _ in transcript if r == "patient"),
            "transcript": transcript}


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    studies = args or [d.name for d in sorted(config.STUDIES_DIR.iterdir())
                       if d.is_dir() and ((d / "study.json").exists() or (d / "questions.json").exists())]

    all_results = {}
    for study in studies:
        eng = Engine(study)
        personas = build_personas(eng.flow)
        print(f"\n{study} — {len(personas)} patients, {len(eng.flow.questions)} questions")
        rows = []
        for p in personas:
            r = run_one(Engine(study), p)        # fresh engine/session per patient
            rows.append(r)
            print(f"  {p['name']:32s} -> {r['outcome']}"
                  + (f"  ({r['dnq_reason']})" if r["dnq_reason"] else ""))
        all_results[study] = {"study_name": eng.flow.name, "results": rows}

    OUT.mkdir(exist_ok=True)
    (OUT / "sim_results.json").write_text(json.dumps(all_results, indent=2, ensure_ascii=False), encoding="utf-8")
    write_report(all_results)
    print(f"\nWrote {OUT/'report.md'} and {OUT/'sim_results.json'}")


def write_report(all_results: dict):
    L = ["# Patient Simulation — Study Analysis\n",
         f"Backend: {os.environ.get('LLM_PROVIDER', 'live')} · "
         "patients are auto-built from each study's questions (1 qualifier + one failure per gate).\n"]
    for study, data in all_results.items():
        rows = data["results"]
        q = sum(1 for r in rows if r["outcome"] == "qualified")
        d = sum(1 for r in rows if r["outcome"] == "dnq")
        L.append(f"## {study} — {data['study_name']}\n")
        L.append(f"{q} qualified · {d} DNQ · {len(rows)} patients\n")
        L.append("| Patient | Outcome | Reason / note |")
        L.append("|---|---|---|")
        for r in rows:
            reason = r["dnq_reason"] or ("BMI " + str(r["bmi"]) if r["bmi"] else "")
            L.append(f"| {r['persona']} | **{r['outcome']}** | {reason} |")
        L.append("")
    L.append("## Full transcripts\n")
    for study, data in all_results.items():
        for r in data["results"]:
            L.append(f"### {study} · {r['persona']} → **{r['outcome']}**"
                     + (f" (BMI {r['bmi']})" if r["bmi"] else ""))
            for role, msg in r["transcript"]:
                L.append(f"- {'🧑' if role == 'patient' else '🤖'} {msg}")
            L.append("")
    OUT.mkdir(exist_ok=True)
    (OUT / "report.md").write_text("\n".join(L), encoding="utf-8")


if __name__ == "__main__":
    main()
