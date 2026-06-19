"""One patient's screening conversation state. (Phase 1: lives in memory.)"""
from __future__ import annotations
from dataclasses import dataclass, field


@dataclass
class Session:
    patient: dict                         # {"name": "...", ...}
    state: str = "new"                    # new → awaiting_interest → screening → qualified / dnq / closed_not_interested
    current_q: str | None = None          # id of the question we're waiting on
    answers: dict = field(default_factory=dict)   # question_id -> normalized value
    bmi: float | None = None
    outcome: str | None = None            # "qualified" | "dnq" | "not_interested"
    dnq_reason: str | None = None
    retries: dict = field(default_factory=dict)   # question_id -> times we re-asked for clarity
    history: list = field(default_factory=list)   # [(role, message)]  role = "agent" | "patient"

    def log(self, role: str, message: str):
        self.history.append((role, message))
