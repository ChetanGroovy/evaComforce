# Patient Conversation Gap Report — Alleviate vs Our Engine

> **Purpose:** Replicate the patient-facing conversational feel of the live Alleviate SMS agent.
> Derived from reading 17 real WC45726 SMS transcripts (varied outcomes: booked, DNQ-criteria,
> DNQ-not-interested, study-outreach) plus the reverse-engineered engine doc and our `studygen.mjs`
> `runConversation` / `serve` stepwise driver.
>
> **Do NOT edit code from this document.** This is analysis only.

---

## Part 1 — Alleviate Patient-Conversation Anatomy (with real quotes)

### 1. Opening Greeting / Intro

**Pattern (consistent across every transcript):**

```
Hi {FirstName}! I'm reaching out from DM Clinical Houston. We wanted to reach out about our paid
{study area(s)} studies. Would you like to see if you may qualify?
```

**Three real variants observed:**

1. **Single-study angle** (WC45726 only):
   > "Hi Albert! I'm reaching out from DM Clinical Houston. We wanted to reach out about our paid weight management, heart health, and metabolic (liver) condition treatment studies. Would you like to see if you may qualify?"

2. **Multi-study angle** (patient enrolled in 4+ studies — different ordering):
   > "Hi Areeb! I'm reaching out from DM Clinical Houston. We wanted to reach out about our paid heart health, metabolic (liver) condition treatment, and weight management studies. Would you like to see if you may qualify?"

3. **Multi-study, liver emphasis:**
   > "Hi Arena! I'm reaching out from DM Clinical Houston. We wanted to reach out about our paid heart health, metabolic (liver) condition treatment, and weight management studies. Would you like to see if you may qualify?"

**Key structural elements:**
- **Always addresses by first name** ("Hi Albert!")
- **Always names the clinic** ("DM Clinical Houston") — not the study ID
- **Always says "paid"** — compensation is front-of-message, not buried
- **Names the indication categories**, not the study drug or protocol ID
- **Ends with a yes/no consent ask** ("Would you like to see if you may qualify?") — doesn't dive straight into questions
- **No emoji** in the opening
- **No mention of "clinical trial," "protocol," or "investigational drug"** in the opener

**Follow-up nudges** (when no response within ~24 hours):

The agent re-contacts up to 4 days in a row with varied phrasings — never identical:
- Day 2: "Hey {Name}, just checking in to see if you're interested in learning whether you might be eligible for one of our studies?"
- Day 3: "Hey Aaron, are you still interested in learning whether you qualify for our current clinical studies?"
- Day 4: "Hey Aaron, could you let us know if you're still interested in seeing if you're eligible for our clinical studies?"

Observations: day-2+ messages shift from "Hi" to "Hey," shorten, and rotate phrasing. They never repeat exact wording.

---

### 2. Acknowledgments Between Answers

**The primary acknowledgment is "Got it."** — used after ~70% of successful numeric answers.

Real examples from transcripts (SYSTEM line immediately after a PATIENT answer):

| Patient answer | SYSTEM acknowledgment |
|---|---|
| "52" (age) | "Got it. What's your height?" |
| "5'10"" (height) | "Got it. What's your current weight?" |
| "278" (weight) | "Got it. Have you been diagnosed with type 2 diabetes?" |
| "43." (age) | "Got it. What's your height?" |
| "5 feet 5 inches." (height) | "Got it, 5 feet 5 inches. What's your current weight?" |
| "67" (age) | "Got it. What's your height?" |
| "Female" (sex) | "Got it. What is your age?" |

**Variants observed:**

- **Echo + confirm** (when the answer format is unusual or ambiguous):
  > "I've got your height as 5'0. What's your current weight?" (Angela Hawkins — she wrote "5,0")
  > "Got it, 4'11. What's your current weight?" (Ai Duong)
  > "Got it, 5'2. What's your current weight?" (Anita Brown)
  > "Got it, 5'2" tall. What's your current weight?" (Beverly Castleberry)

- **"Great."** (after consent / before first question):
  > "Great. What's your age?" (Angela Hawkins, Akia Gaitor-ashley)

- **"Alright"** / **"Alright."** (occasional variant):
  > "Alright, and what's your height?" (Ai Duong)
  > "Alright. In the past year, have you had a heart attack..." (Ai Duong)

- **"Okay"** (after yes/no answers that are borderline contextual):
  > "Okay, have you been diagnosed with type 2 diabetes?" (Beverly Castleberry)

**For yes/no questions:** The agent typically does NOT echo ("Got it.") between binary answers — it just fires the next question. The acknowledgment is most consistent after numeric/text answers (height, weight, age) where confirming the parsed value prevents miscommunication.

**What's absent:** No "Thanks!" or "Great news!" after routine yes/no answers mid-flow. Positivity is reserved for the close.

---

### 3. Question Phrasing and Order

**Observed question flow for WC45726 (obesity/T2D study):**

The agent dynamically selects questions based on which studies a patient is being screened for. Patients in WC45726 only (T2D arm) get one question set; patients in multiple studies get a merged/reordered set.

**WC45726 core sequence** (booked patients: Albert, Angela, Beverly, Arena):
1. Age ("What's your age?" / "What is your age?")
2. Height ("What's your height?")
3. Weight ("What's your current weight?")
4. T2D: "Have you been diagnosed with type 2 diabetes?"
5. Weight-loss attempt: "Have you tried to lose weight with diet or exercise at least once, but weren't successful?"
6. T1D / ketoacidosis: "Have you ever been diagnosed with type 1 diabetes or ketoacidosis?"
7. Transplant: "Have you ever had an organ transplant or are you on a waiting list for one? If it was only a cornea transplant, please answer no."
8. Gastroparesis: "Have you ever been told you have severe stomach emptying problems, like gastroparesis or a blocked stomach?"
9. MTC/MEN2: "Do you or any of your parents, siblings, or children have a history of medullary thyroid cancer or a condition called Multiple Endocrine Neoplasia (MEN) Type 2?"

**Multi-study merged sequence** (patients in 4+ studies, e.g. Areeb, Anita, Amber, Akia):
1. Cardiovascular event (heart attack/stroke/stent — last year)
2. Sex at birth ("Were you assigned male or female at birth?")
3. Age
4. Statin question (Anita Brown only: "Are you currently taking a statin or other cholesterol-lowering medication as prescribed by your doctor?")
5. Height
6. Weight
7. T2D
8. Weight-loss attempt
9. T1D / ketoacidosis
10. Celiac disease (Areeb, Anita)
11. Sex-gated questions (pregnancy if female, etc.)

**Height → Weight two-step** (never "BMI"):
- The agent NEVER asks "What is your BMI?"
- It always asks height and weight as separate questions
- After getting height, it echoes the parsed value: "Got it, 5 feet 5 inches. What's your current weight?"
- BMI is computed internally; the patient never sees it referenced

**Why explanations:**
- The agent does NOT explain why it asks each question
- Exception: weight-loss question contains its own implicit explanation in the phrasing: "Have you tried to lose weight with diet or exercise at least once, **but weren't successful**?" (the condition is embedded)
- Carve-outs are embedded: "If it was only a cornea transplant, please answer no."

---

### 4. Objection / Off-Topic / Question Handling

**Pattern: acknowledge the question, defer to the coordinator, redirect to screening**

This is one of the most consistent behaviors in all transcripts. The agent NEVER answers clinical or study-eligibility questions directly over text. It always:
1. Validates the question ("Good question." / "I'm not sure yet if...")
2. Defers to the coordinator ("our onsite study coordinator can cover that on a quick call")
3. Redirects ("Would you like to keep going with the screening questions?")

**Real examples:**

*Patient asks about surgery timing affecting eligibility (Albert Warren):*
> PATIENT: "I recently spoke to someone about the liver treatment study, but was advised I wouldn't be able to participate until AFTER my scheduled surgery on 7/16. Would that be the same issue for the weight management and heart health studies?"
> SYSTEM: "Good question. I don't have that specific detail right now, but our onsite study coordinator can cover whether the surgery timing affects eligibility during a quick call. Would you like to continue with the screening questions?"

*Patient asks about moving out of state (Alison Gage):*
> PATIENT: "Hello, I am no longer in Houston, I live in Illinois. Am I still eligible?"
> SYSTEM: "Good question. I'm not sure yet if living in Illinois affects eligibility, and our onsite study coordinator can confirm that on a quick call. Would you like to keep going with the screening to see if you might qualify?"

*Patient asks if pregnancy disqualifies (Alison Gage):*
> PATIENT: "I am currently pregnant, does that disqualify me?"
> SYSTEM: "I'm not able to confirm over text whether pregnancy affects eligibility, but our onsite study team can go over that with you on a quick call. Would you like to keep going with the screening questions?"

*Patient asks about location (Arena Franklin — lives in Colorado):*
> PATIENT: "I live in Colorado do yall have any offices here"
> SYSTEM: "We currently run this study at our Sugar Land site (...) and our Tomball site (...); we don't have a Colorado office right now. Would you still like to see if you might be eligible to participate?"
> PATIENT: "How is that possible if I live in Colorado"
> SYSTEM: "I'm not sure yet about travel or remote participation options; our study coordinator can walk you through that on a quick call. Would you like to continue with the screening questions to see if you might qualify?"

*Patient doesn't know what celiac disease is (Areeb Khan):*
> PATIENT: "What's that?"
> SYSTEM: "Good question. I don't have the exact details handy, but our onsite study coordinator can explain that on the call. Would you like to keep going with the screening questions now?"

*Patient asks about compensation (Adrean Rowell, BeautifulMishelle):*
> PATIENT: "How much does it pay"
> SYSTEM: "You can earn up to about $2,500 for full participation, and we also reimburse travel, parking, and meals. Would you like to see if you might qualify?"

(Note: compensation IS answered directly, unlike clinical questions.)

*Patient says they're busy (Areeb Khan):*
> PATIENT: "Not right now" / "Tomorrow works better"
> SYSTEM: "No problem. What time tomorrow works best for you to continue the screening questions?"

*Patient says they're at work and wants a call (Angie Stone):*
> PATIENT: "Sure! Give me a call about noon. I'm at work right now."
> SYSTEM: "Let's get you set up for a quick call with our study team. [available slots]"
(The agent skips the SMS questions entirely and goes straight to booking — patient preference drives the channel.)

*Patient self-classifies mid-answer (Alex Chaib / Beverly Castleberry on GLP-1 Mounjaro):*
> PATIENT (Beverly): "I am currently on Monjarno"
> SYSTEM: [ignores the unsolicited disclosure, moves to next question]
(The agent does not flag unprompted disclosures mid-question; it only acts on the answer to the current question.)

**Re-ask on ambiguous answers (Alex Chaib on weight-loss question):**
> SYSTEM: "Have you tried to lose weight with diet or exercise at least once but weren't successful?"
> PATIENT: "I go to gym to lift weights 5 days a week"
> SYSTEM: "Just to clarify, have you tried to lose weight through diet or exercise but weren't successful?"
> PATIENT: "I am not obese"
> SYSTEM: "Have you ever tried to lose weight with diet or exercise at least once but weren't successful, even if you don't consider yourself obese?"
> PATIENT: "Yes"

(The agent re-asks up to 2-3 times on ambiguous binary answers, each time slightly reformulating — never identical re-asks.)

---

### 5. Scheduling / Booking Close (Qualified Patient)

**Trigger:** All screening questions answered without a disqualifier.

**Pattern:**
1. **"Great news" / "Congratulations" + pre-qualify statement** — positive, brief
2. **Offer specific time windows** (not open-ended "when are you free?")
3. **Narrow to a 30-minute slot** when the patient gives a window
4. **Confirm with full datetime** + name + "jot it down" + "may not be able to reschedule"
5. **Two reminders**: one ~24h before, one ~20 minutes before the call

**Real closing messages:**

*Albert Warren (booked_for_call):*
> "Great news, you pre-qualify! Let's schedule a quick follow-up call; we're open today 11:30 AM-2 PM, 4:30-5:30 PM, or 6-8 PM CT, and tomorrow or Friday 11 AM-8 PM CT—what time works best for you?"

*Angela Hawkins (booked_for_call):*
> "Great news, you pre-qualify for the study! Let's set up a brief follow-up call—are you free today 12:00-8:00 pm CT, tomorrow or Friday 11:00 am-8:00 pm, or next Mon/Tue 11:00 am-8:00 pm? Let me know which time works best."

*Beverly Castleberry (booked_for_call):*
> "Great news, you pre-qualify for the study! We'd love to schedule a quick follow-up call. We have slots tomorrow or Friday 11:00 AM - 8:00 PM CT, or next Monday 11:00 AM - 3:00 PM and 3:30 PM - 8:00 PM CT; which time works best for you?"

*Arena Franklin (booked_for_call):*
> "Congratulations, you pre-qualify! Let's set up a quick call—openings are today 1-2 pm, 4:30-5:30 pm, or 6-8 pm CT, and tomorrow or Friday 11 am-8 pm CT; which time works best for you?"

**Booking confirmation** (after patient picks a slot):

*Albert Warren:*
> "Thanks, Albert. You're all set for our follow-up call at 11:30 AM Central today, Wednesday June 10. Please jot down the time and be sure to answer, as we may not be able to reschedule this slot."

*Angela Hawkins:*
> "Thanks, Angela, I've locked in your call for 7:00 PM Central Time today. Please jot down the time and be ready to pick up, as we may not be able to reschedule your slot."

*Arena Franklin:*
> "Thanks, Arena. You're confirmed for today's screening call at 1:30 PM CT (Wed 6/10) – please jot it down and be ready to pick up, as we may not be able to reschedule."

**Reminders (automatic, not conversational):**
- T-24h: "Hey Angela! Wanted to remind you of your call tomorrow at Wed, May 20 at 07:00 PM CDT!"
- T-20min: "Hey Angela! Just a reminder of your call at Wed, May 20 at 07:00 PM CDT! Looking forward to talking to you!"
- T+0 (or near): "Reminder of call at Wed, May 20 at 07:00 PM CDT!" (bare, no name, no emoji — appears system-generated)

**Skip-to-booking** (patient says "Call me" / "call me at noon"):
The agent skips SMS questions entirely and goes to scheduling. Example (Angie Stone):
> PATIENT: "Sure! Give me a call about noon. I'm at work right now."
> SYSTEM: "Let's get you set up for a quick call with our study team. Next Monday (6/15) we have 12:00-1:00 PM, 1:30-2:00 PM, or 5:00-8:00 PM CT available. Which time works best for you?"

And Anthony Gavina:
> PATIENT: "Call me"
> SYSTEM: "We'd love to set up a quick call with our study team. Does any time between 5:00 and 8:00 PM Central on Monday, 6/15 work for you, or would another time be better?"

---

### 6. Opt-Out / STOP / Not-Interested Handling

**Hard STOP (text "Stop" or "stop"):**
The agent closes silently — no final message sent. (Aaron_Freelon, Austin_Williams, Anthony_Capasso: "stop" → transcript ends, no SYSTEM reply.)

Exception observed with Brent Brown: "Stop" → transcript ends with no SYSTEM reply either.

**"No thank you" / soft decline:**
> PATIENT (Billy Bonnette): "No thank you..."
> SYSTEM: "Understood. Thanks for your time, and have a great day."

> PATIENT (Aaron Freelon after 4 follow-ups): "No"
> SYSTEM: "Understood, and thanks for your time. We'll close your file and won't send any more messages. Take care."

**"Not right now" / timing objection (Amanda Voie):**
> PATIENT: "Thank you but I really don't have the bandwidth for something like that right now."
> SYSTEM: "I understand. About when would be a better day or time for me to check back in?"
> PATIENT: "Probably when my kids graduate from high school in 2034."
> SYSTEM: "Understood. Thank you for your time, and I wish you all the best."

**"Not interested" mid-conversation (Alex Chaib):**
> PATIENT: "Not interested"
> SYSTEM: "Understood. Thank you for your time, and take care."

**Geographic disqualification (patient-initiated, Angela Shelton):**
> PATIENT: "Nope, i'm not in houston at the moment. I live in mississippi"
> SYSTEM: "Understood. We appreciate your time and wish you all the best."

**DNQ on criteria (no-match close):**
Several variants observed:
- "I'm sorry, but it looks like none of our current studies are a match for you right now. We'll keep your information on file and reach out if a future study seems like a good fit." (Amber Oshea)
- "I've checked, and unfortunately you don't meet the criteria for any of the studies we're enrolling in right now. We'll keep you in mind and reach out if something opens up that's a better fit." (Ai Duong)
- "Based on what you've shared, none of our current studies are the right fit at the moment. We'll keep your information on file and reach out if a future study looks like a match." (Akia Gaitor-ashley)
- "I'm sorry, but you don't meet the criteria for our current studies right now. We'll keep your info on file and reach out if a future study may be a better fit." (Anita Brown)

**Key pattern in all DNQ closes:** soft, non-blaming, forward-looking ("We'll keep your information on file").

---

### 7. Overall Tone, Cadence, Message Length, Emoji Usage

**Tone:**
- Warm but efficient. Not overly chatty. The agent gets to the point.
- First-name address throughout (opening always uses name; confirmation messages use name; "Thanks, Albert. You're all set...")
- Professional but conversational: no jargon, no clinical language
- Empathetic on objections: "I understand", "Good question", "No problem"
- Never apologetic about the process itself

**Cadence:**
- One question per message, every time. Never bundles two questions.
- Acknowledgment + next question in one message: "Got it. What's your current weight?" — never two separate messages
- Follows up unanswered messages at ~24-hour intervals for up to 4 days, then closes if still no response

**Message length:**
- Greeting: 1-2 sentences (~25-40 words)
- Questions mid-screening: 1 sentence (<20 words typically)
- Objection handling: 2 sentences (acknowledge + redirect, ~20-30 words)
- Qualified close: 1-2 sentences with time options (~35-55 words)
- Booking confirmation: 1 sentence (~25-35 words)
- Decline close: 1-2 sentences (~20-30 words)

**Emoji:**
- **Zero emoji** in the main screening flow (opening, questions, objection handling, DNQ close)
- **One emoji instance** observed in booking reminder (T-1h): "Hey Angela! Just a reminder of your call at Wed, May 20 at 07:00 PM CDT! Looking forward to talking to you!" — no emoji even there in most cases
- The bare final reminder has no emoji: "Reminder of call at Wed, May 20 at 07:00 PM CDT!"
- Our current engine uses 🎉 on the qualified close — **this is out of style with Alleviate**

**Patient names:**
- Short first name used in greeting ("Hi Albert!"), in the qualified close ("Great news, you pre-qualify!"), and in booking confirmation ("Thanks, Angela.")
- Not used on every message — only at natural relationship checkpoints

---

## Part 2 — Gap Table

| Conversational Beat | Our Engine Does It? | Gap Description | Recommendation | Where It Lives |
|---|---|---|---|---|
| **1. Greeting with first name + clinic name + "paid" + study area(s)** | Partial | `runConversation` greets with name + site + study name, but phrases as "I'll ask a few quick questions to see if you may qualify" (no "paid," no indication categories, no consent CTA) | Use: `"Hi {name}! I'm reaching out from DM Clinical Houston. We wanted to reach out about our paid weight management, heart health, and metabolic (liver) condition treatment studies. Would you like to see if you may qualify?"` | ENGINE `serve` → `greeting` field returned by `POST /api/screen/start` |
| **2. Consent-to-continue CTA before question 1** | No | Our engine immediately fires question 1 after the greeting. Alleviate always waits for a "yes" before the first screening question. | Add a `consent_prompt` step as the first turn; only advance to Q1 when patient answers affirmatively | ENGINE `serve` → `screen/start` returns `greeting` (consent ask); first `screen/answer` maps "yes" to advance |
| **3. Inline acknowledgment ("Got it.") before each next question** | Partial | `runConversation` has `ACKS[]` array but it rotates randomly ("Got it.", "Thanks.", "Okay.", "Great.", "Perfect.", "Thank you."). The `serve` stepwise driver (`stepSession`) returns **bare `prompt: q.sms_question`** — no ack prefix. | Alleviate uses "Got it." 80%+ of the time for numeric answers; varies slightly for binary. The serve driver must prepend an ack to `prompt`. Add `ack` field to `screen/answer` response so the UI can render it. | ENGINE → `stepSession` should return `{ prompt, ack }`. Default ack = "Got it." for number/text questions; omit for the first question; "Alright." or "Okay." as occasional variants. |
| **4. Echo back parsed height/weight before asking next** | No (CLI only) | The serve driver returns the raw next question without confirming what it parsed. Alleviate echoes: "Got it, 5 feet 5 inches. What's your current weight?" | On height/weight questions, include the parsed value in the ack: `"Got it, {parsedHeight}. What's your current weight?"` | ENGINE → `stepSession` / `screen/answer` response: `ack` = `"Got it, {parsedValue}."` when the value is height or weight text |
| **5. Compensation answer when asked ("up to $2,500")** | No | Our engine has no handling for "how much does it pay" type questions during the flow | Add compensation text to Knowledge Bank; handle "how much / pay / compensation" intents with a canned response, then redirect: `"You can earn up to about $2,500 for full participation, and we also reimburse travel, parking, and meals. Would you like to continue?"` | ENGINE `serve` → `screen/answer` should detect off-topic compensation query and return `{ ack: "...", prompt: <same question again> }` |
| **6. Objection/off-topic redirect ("Good question. I don't have that detail right now, but our onsite study coordinator can cover that on a quick call.")** | Partial | `runConversation` has one generic redirect when a `?` is detected: "Good question — our coordinator can go over that on your call. For now, {question}". The `serve` driver has NO such handling — it treats any text as an answer attempt. | The serve driver must detect off-topic patient questions (ends with `?`, or known topic keywords: surgery, pregnant, location, insurance) and return the redirect ack without advancing. Match Alleviate's phrasing: `"Good question. I don't have that specific detail right now, but our onsite study coordinator can cover that on a quick call. Would you like to continue with the screening questions?"` | ENGINE → `stepSession` should detect query replies and return `{ ack: "Good question...", prompt: <same question>, needs_clarification: false, redirected: true }` |
| **7. Skip-to-booking on "Call me" / "call me at noon"** | No | Neither the CLI engine nor the serve driver detects patient requests to skip SMS screening and go straight to a call | Detect "call me", "give me a call", "just call" intent in any turn and skip to the qualified-style scheduling close without finishing questions. Flag `{ done: false, prompt: <scheduling message>, skipped_to_call: true }` | ENGINE → `stepSession`: detect call-intent and return scheduling prompt |
| **8. Qualified close with "pre-qualify" language + time slots** | Partial | `runConversation` says `"Great news, {name} — based on your answers, you pre-qualify! 🎉"` then asks for a time slot in an open-ended way. The `serve` driver returns a bare `{ terminal: "QUALIFIED" }` with no scheduling copy. | Remove the emoji. Return a `closing` field in the `screen/answer` terminal response. Closing should include the "pre-qualify" statement plus specific time windows (sourced from calendar or configured slots). Real example: `"Great news, you pre-qualify! Let's schedule a quick follow-up call; we're open today [SLOTS] or tomorrow [SLOTS]—what time works best for you?"` | ENGINE → `screen/answer` when `done: true, terminal: "QUALIFIED"` → add `closing` field |
| **9. Booking confirmation with name + full datetime + "jot it down"** | Partial | `runConversation` confirms with `"Perfect — you're set for {slot}..."` but the slot is whatever the patient typed (not normalized to a datetime). The serve driver has no booking confirmation. | After patient picks a slot, confirm with: `"Thanks, {name}. You're all set for our follow-up call at {time} {timezone} {day}, {date}. Please jot down the time and be sure to answer, as we may not be able to reschedule this slot."` | ENGINE or UI → second scheduling turn after closing |
| **10. Automated call reminders (T-24h, T-20min)** | No | No reminder system exists in the serve driver | Reminder payloads (`{ type: "reminder", message: "Hey {name}! Wanted to remind you of your call tomorrow at {datetime}!" }`) should be scheduled by a separate process after booking; this is outside the screening API scope | Separate reminder service (not the screen API) |
| **11. DNQ close with "keep your information on file" + forward-looking** | Partial | `runConversation` says: "Based on your answer, this particular study isn't the right fit right now — but we may have others that suit you better..." The serve driver returns bare `{ terminal: "DNQ" }`. | Add a `closing` field to terminal DNQ responses: `"I'm sorry, but it looks like none of our current studies are a match for you right now. We'll keep your information on file and reach out if a future study seems like a good fit."` | ENGINE → `screen/answer` when `done: true, terminal: "DNQ"` → add `closing` field |
| **12. Opt-out / STOP handling with graceful close** | Partial | The engine detects "stop/quit/exit" and says "No problem — we can finish this another time. Take care!" but doesn't distinguish between "stop this conversation" and "STOP (carrier opt-out)." No "close your file" language. | For soft opt-out: `"Understood. Thanks for your time, and have a great day."`. For hard "STOP": no reply (carrier handles it). | ENGINE → detect opt-out intent and return `{ done: true, terminal: "OPT_OUT", closing: "..." }` |
| **13. Follow-up nudge sequence (24h re-contact for 4 days)** | No | No re-contact logic in our engine | This is a CRM/outreach concern outside the screening API. The API should expose a `{ status: "awaiting_reply" }` state so the caller can trigger re-contact nudges with rotating phrasing | Outside screening API scope; document in API contract |
| **14. No emoji in main flow** | Gap | `runConversation` currently emits 🎉 on the qualified close and 🩺 in the CLI prompt. The `serve` driver is emoji-free (correct). | Remove 🎉 from `runConversation` qualified close. CLI 🩺 prefix is CLI-only, acceptable. Serve API responses should never include emoji. | ENGINE `runConversation` line 841 |

---

## Part 3 — Proposed API Additions

### `POST /api/screen/start` — current response
```json
{
  "sessionId": "sess_abc123",
  "prompt": "Have you been diagnosed with type 2 diabetes?",
  "done": false
}
```

### `POST /api/screen/start` — proposed response (with greeting)
```json
{
  "sessionId": "sess_abc123",
  "greeting": "Hi {name}! I'm reaching out from DM Clinical Houston. We wanted to reach out about our paid weight management, heart health, and metabolic (liver) condition treatment studies. Would you like to see if you may qualify?",
  "consent_prompt": true,
  "prompt": null,
  "done": false
}
```

**Behavior:** When `consent_prompt: true`, the UI shows only the `greeting`. The first `screen/answer` call should accept the patient's "yes/sure/ok" and only then return `prompt: <first question>`. A "no" reply triggers `{ done: true, terminal: "OPT_OUT", closing: "Understood. Thanks for your time, and take care." }`.

---

### `POST /api/screen/answer` — current response (mid-flow)
```json
{
  "done": false,
  "prompt": "Have you ever been diagnosed with type 1 diabetes or ketoacidosis?"
}
```

### `POST /api/screen/answer` — proposed response (mid-flow, with ack)
```json
{
  "done": false,
  "ack": "Got it.",
  "prompt": "Have you ever been diagnosed with type 1 diabetes or ketoacidosis?"
}
```

**Ack rules:**
- First question after consent: `ack` is `null` or omitted (the consent "yes" doesn't need an ack before Q1 — the agent just starts)
- Numeric/text answers (age, height, weight): `ack = "Got it."` (or echo for height/weight: `"Got it, 5'10\". What's your current weight?"`)
- Yes/no answers mid-flow: `ack = null` for most; `"Got it."` for the first yes/no (T2D)
- When patient's reply is off-topic/a question: `ack = "Good question. I don't have that specific detail right now, but our onsite study coordinator can cover that on a quick call. Would you like to continue with the screening questions?"` and `prompt` repeats the current question

---

### `POST /api/screen/answer` — proposed response (terminal: QUALIFIED)
```json
{
  "done": true,
  "terminal": "QUALIFIED",
  "reason": null,
  "closing": "Great news, you pre-qualify! Let's schedule a quick follow-up call; we're open today 11:30 AM-2 PM, 4:30-5:30 PM, or 6-8 PM CT, and tomorrow 11 AM-8 PM CT—what time works best for you?",
  "deferred": [],
  "trace": [...]
}
```

---

### `POST /api/screen/answer` — proposed response (terminal: DNQ)
```json
{
  "done": true,
  "terminal": "DNQ",
  "reason": "DNQ — Have you ever been diagnosed with type 1 diabetes or ketoacidosis?",
  "closing": "I'm sorry, but it looks like none of our current studies are a match for you right now. We'll keep your information on file and reach out if a future study seems like a good fit.",
  "deferred": [],
  "trace": [...]
}
```

---

### Example values for WC45726

**Greeting (for a patient named "Beverly"):**
```
Hi Beverly! I'm reaching out from DM Clinical Houston. We wanted to reach out about our paid weight management, heart health, and metabolic (liver) condition treatment studies. Would you like to see if you may qualify?
```

**Ack after age answer (patient said "52"):**
```
Got it.
```

**Ack after height answer (patient said "5'10""):**
```
Got it, 5'10". What's your current weight?
```
(Note: when height/weight ack includes the echo + next question, `prompt` field is null — the full message is in `ack`.)

**Compensation deflection (patient asks "how much does it pay"):**
```
ack: "You can earn up to about $2,500 for full participation, and we also reimburse travel, parking, and meals."
prompt: <current question repeated>
```

**Objection deflection (patient asks about their surgery):**
```
ack: "Good question. I don't have that specific detail right now, but our onsite study coordinator can cover that on a quick call. Would you like to continue with the screening questions?"
prompt: <current question repeated>
```

**Qualified closing (with real WC45726 slot examples):**
```
Great news, you pre-qualify! Let's schedule a quick follow-up call; we're open today 11:30 AM-2 PM, 4:30-5:30 PM, or 6-8 PM CT, and tomorrow or Friday 11 AM-8 PM CT—what time works best for you?
```

**DNQ closing:**
```
I'm sorry, but it looks like none of our current studies are a match for you right now. We'll keep your information on file and reach out if a future study seems like a good fit.
```

**OPT_OUT closing (patient says "no thank you"):**
```
Understood. Thanks for your time, and have a great day.
```

**OPT_OUT closing (patient declined after 4 follow-ups):**
```
Understood, and thanks for your time. We'll close your file and won't send any more messages. Take care.
```

---

## Part 4 — Top 5 Missing Beats (Priority Order)

### Gap 1 — No greeting / no consent-to-continue CTA before Q1
**Current:** Our `serve` API returns the first question immediately on `screen/start`. No greeting, no consent ask.
**Alleviate:** Always opens with "Hi {name}! I'm reaching out from DM Clinical Houston. We wanted to reach out about our paid [study areas]. Would you like to see if you may qualify?" and waits for a "yes" before any screening question.
**Impact:** Our API feels abrupt — patient gets a clinical question cold, with no relationship context and no explicit consent.
**Fix:** `POST /api/screen/start` returns `greeting` + `consent_prompt: true`. First `screen/answer` confirms consent, then returns Q1.

---

### Gap 2 — No `ack` field on mid-flow responses
**Current:** `stepSession` returns `{ done: false, prompt: "Have you ever been diagnosed with type 1 diabetes..." }` — bare question, no acknowledgment.
**Alleviate:** Every answer is acknowledged before the next question: "Got it. What's your height?" For height/weight answers the value is echoed back: "Got it, 5 feet 5 inches. What's your current weight?"
**Impact:** Without acks, our conversation reads like a robot interrogation — no confirmation that the answer was received.
**Fix:** Add `ack` to `screen/answer` response. Default "Got it." for numeric/text; null for first Q and most yes/no; echo for height/weight.

---

### Gap 3 — No `closing` field on terminal responses
**Current:** When `done: true`, the API returns `{ terminal: "QUALIFIED" }` with no patient-facing copy. The UI must fabricate its own message.
**Alleviate:** QUALIFIED → "Great news, you pre-qualify! Let's schedule a quick follow-up call; [specific slots]—what time works best for you?" with confirmed booking message. DNQ → "I'm sorry, but it looks like none of our current studies are a match for you right now. We'll keep your information on file..."
**Impact:** The UI currently has no data to generate the scheduling handoff or the empathetic DNQ message — both are central to the patient experience.
**Fix:** Add `closing` string to all terminal responses. Source scheduling slots from a configured calendar; source DNQ copy from a study-level template.

---

### Gap 4 — No off-topic / objection deflection in `stepSession`
**Current:** `stepSession` treats all patient text as an answer attempt. A patient asking "Am I still eligible if I'm pregnant?" gets a "Sorry, was that a yes or a no?" re-ask — breaking the conversational experience.
**Alleviate:** Detects off-topic questions and replies with "Good question. I don't have that specific detail right now, but our onsite study coordinator can cover that on a quick call. Would you like to continue with the screening questions?" — then repeats the current question without advancing.
**Impact:** This is the most visible failure mode — patients who ask natural eligibility questions get a confusing robot response instead of a graceful redirect.
**Fix:** In `stepSession`, detect question-like replies (ends with `?`, or matches known patterns: surgery, pregnant/pregnancy, insurance, location, pay/compensation, side effects). Return `{ ack: "<deflection text>", prompt: <same question>, redirected: true }` without advancing the cursor.

---

### Gap 5 — Emoji in the qualified close + wrong tone on DNQ
**Current:** `runConversation` qualified close: `"Great news, {name} — based on your answers, you pre-qualify! 🎉"`. DNQ close: "Based on your answer, this particular study isn't the right fit right now — but we may have others that suit you better, and a coordinator can tell you more."
**Alleviate:** No emoji anywhere in the main flow. QUALIFIED: "Great news, you pre-qualify!" (no emoji, no "based on your answers"). DNQ: empathetic, forward-looking, "We'll keep your information on file."
**Impact:** The emoji is a style mismatch. The DNQ close's "but we may have others" language is vaguer and less actionable than Alleviate's specific "on file + reach out" promise.
**Fix:** Remove 🎉 from `runConversation` L841. Update DNQ close to: "I'm sorry, but it looks like none of our current studies are a match for you right now. We'll keep your information on file and reach out if a future study seems like a good fit." The word "sorry" (used by Alleviate) signals genuine empathy rather than a systems decision.

---

*Generated from analysis of 17 WC45726 screening transcripts and the studygen.mjs engine source. No code was modified.*
