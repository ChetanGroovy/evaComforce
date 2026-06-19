"""
The Engine — ties the LLM voice/ears to the deterministic kernel.

    engine.start(patient)            -> the greeting message to send
    engine.reply(session, text)      -> the next message to send

Phase 1: one study (WC45276). Handles the happy path plus: the patient asking a question back,
unclear replies, opting out, and clarifying bad/ambiguous answers (e.g. weight with no unit).
"""
from __future__ import annotations
from app.kernel.flow import Flow
from app.kernel.session import Session
from app.llm import agent

MAX_RETRIES = 2


class Engine:
    def __init__(self, study_id: str = "WC45276"):
        self.flow = Flow(study_id)

    # ---- turn 0: greeting ----
    def start(self, patient: dict) -> tuple[Session, str]:
        s = Session(patient=patient, state="awaiting_interest")
        s.log("agent", agent.generate_greeting(patient, self.flow.general_info))
        return s, s.history[-1][1]

    # ---- every patient reply ----
    def reply(self, s: Session, text: str) -> str:
        s.log("patient", text)
        if s.state == "awaiting_interest":
            return self._on_interest(s, text)
        if s.state == "screening":
            return self._on_answer(s, text)
        return self._say(s, "Thanks! We've got what we need for now. 💜")

    # ---- reply to the greeting ----
    def _on_interest(self, s: Session, text: str) -> str:
        intent = agent.interpret_interest(text)
        if intent == "yes":
            s.state = "screening"
            q = self.flow.first()
            s.current_q = q["id"]
            return self._say(s, agent.phrase_question(q, s.history, s.patient))
        if intent == "no":
            s.state, s.outcome = "closed_not_interested", "not_interested"
            return self._say(s, "No problem at all — thanks for your time! If you change your mind, "
                                "just reply here. Take care. 💜")
        # they asked a question first → answer it, then invite them to start
        answer = agent.answer_kb(text, self.flow.kb)
        return self._say(s, f"{answer} Would you like to answer a few quick questions to see if you "
                            f"may qualify?")

    # ---- reply during screening ----
    def _on_answer(self, s: Session, text: str) -> str:
        q = self.flow.question(s.current_q)
        parsed = agent.interpret(text, q)
        intent = parsed.get("intent", "answer")

        if intent in ("not_interested", "stop"):
            s.state, s.outcome = "closed_not_interested", "not_interested"
            return self._say(s, "No problem — thanks for your time! Reply here anytime. 💜")

        if intent == "question":
            # answer from the Knowledge Bank, then re-ask the SAME question (don't advance)
            answer = agent.answer_kb(text, self.flow.kb)
            return self._say(s, f"{answer} {agent.phrase_question(q, s.history, s.patient)}")

        if intent == "unclear":
            return self._say(s, "Sorry, I didn't quite catch that — "
                                + agent.phrase_question(q, s.history, s.patient))

        # it's an answer → record, then sanity-check before deciding
        self.flow.record(s, q, parsed.get("value"))
        clarify = self.flow.clarify(q, parsed.get("value"), s)
        if clarify and s.retries.get(s.current_q, 0) < MAX_RETRIES:
            s.retries[s.current_q] = s.retries.get(s.current_q, 0) + 1
            return self._say(s, clarify)

        reason = self.flow.disqualifies(q, parsed.get("value"), s)
        if reason:
            s.state, s.outcome, s.dnq_reason = "dnq", "dnq", reason
            return self._say(s, "Thank you for sharing that. Based on your answers this particular "
                                "study isn't a match right now, but we'll keep you in mind for "
                                "future studies you may fit. 💜")

        nxt = self.flow.next_question(s)
        if nxt:
            s.current_q = nxt["id"]
            return self._say(s, agent.phrase_question(nxt, s.history, s.patient))

        s.state, s.outcome = "qualified", "qualified"
        return self._say(s, agent.phrase_qualified(s.patient, self.flow.name))

    def _say(self, s: Session, msg: str) -> str:
        s.log("agent", msg)
        return msg
