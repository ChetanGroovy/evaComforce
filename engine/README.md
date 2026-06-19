# Comforce.Engine — V2 conversational screener (Phase 1)

The LLM runtime for the new text-based screening. It turns a study's **question bank**
(generated separately from the protocol) into a real WhatsApp-style conversation:
a dynamic greeting → wait for "yes" → ask the screening questions one at a time →
understand each reply → drive to an outcome.

**Phase 1 scope:** one study (**WC45276**, obesity / type 2 diabetes), happy path. No SMS
sending, no scheduling — this layer only *produces* the messages and *consumes* replies.

## Run it

```bash
python -m venv .venv && .venv\Scripts\activate     # (Windows)
pip install -r requirements.txt
copy .env.example .env          # add your GOOGLE_API_KEY for dynamic messages (optional)

python demo.py                  # scripted happy-path conversation, end to end
python run_cli.py "Judith"      # interactive — you type the patient's replies
```

- **With** a `GOOGLE_API_KEY` → greeting, question phrasing, and answer understanding are
  dynamic (Gemini 2.5 Flash).
- **Without** a key → it still runs using simple fallback wording, so you can see the flow.

## How it's built

| Part | File | Job |
|---|---|---|
| LLM client | `app/llm/client.py` | the one place we call Gemini (text + structured JSON) |
| Agent voice/ears | `app/llm/agent.py` | greeting · phrase question · interpret reply · qualified msg · nudge |
| Kernel (deterministic) | `app/kernel/flow.py` | loads the bank, picks next question, derives BMI, decides disqualification |
| Session | `app/kernel/session.py` | one conversation's state (in memory) |
| Engine | `app/engine.py` | `start()` / `reply()` — ties LLM + kernel into the turn loop |
| Study data | `app/studies/WC45276/` | `questions.json` + `knowledge_bank.json` |

**The rule:** the LLM never decides eligibility — it only phrases messages and turns words
into a clean value. The kernel (`flow.py`) makes every decision, so it's deterministic and
auditable.

## Next parts to add (later phases)

Disambiguation / non-happy paths · Knowledge-Bank answers to patient questions · the no-reply
nudge on a schedule · multi-study portfolio routing (reroute, don't reject) · transport
(SMS/email link) · web chat UI · session persistence (Redis) · `/screen/turn` HTTP API.
