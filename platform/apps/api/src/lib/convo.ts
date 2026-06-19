/**
 * convo.ts — conversational presentation layer.
 *
 * VERDICT-NEUTRAL: every function here is presentation-only. None of these
 * functions call stepSession, screenPatient, or touch session.ans. The engine
 * verdict comes entirely from stepSession → finishSession → screenPatient.
 * The layer wraps that verdict with human-friendly text (greeting, ack, deflection,
 * closing) that can be changed without touching the engine at all.
 *
 * Port of the convoGreeting / convoClosing / consent-gate / ACK / DEFLECTION
 * constants from studygen.mjs — wording is reproduced verbatim.
 */

import type { Study } from './engine-shim.js';
import { llmText } from '@comforceeva/extractor';

const SITE = process.env['SITE_NAME'] ?? 'DM Clinical Houston';
const PERSONA =
  `You are a warm, friendly clinical-trial recruiter texting on behalf of ${SITE}. ` +
  `You text like a kind human on WhatsApp: short messages, plain English, no medical jargon, ` +
  `one question at a time. Never sound robotic.`;

/** Dynamic greeting (LLM) — falls back to the static greeting when no LLM backend. */
export async function dynamicGreeting(S: Study, name?: string): Promise<string> {
  const nm = name ?? 'there';
  const info = (S.knowledgeBank ?? {})['General Study Information'] ?? (S.study?.indication ?? '');
  const out = await llmText(
    `${PERSONA}\n\nWrite the FIRST outreach text to a potential participant named ${nm}.\n` +
    `What the study is about (paraphrase warmly, do NOT copy): "${info}"\n` +
    `Rules: start with "Hi ${nm}!"; say you're reaching out from ${SITE}; one friendly sentence ` +
    `about the paid study; end by asking if they'd like to see if they may qualify. ` +
    `Max ~2 short sentences + the question. Plain text only.`
  );
  return out ?? convoGreeting(S, name);
}

/** Rephrase the next question warmly (LLM) — keeps the medical meaning; falls back to the raw text. */
export async function phraseQuestion(questionText: string, lastReply?: string): Promise<string> {
  if (!questionText) return questionText;
  const out = await llmText(
    `${PERSONA}\n\nAsk the NEXT question below, rephrased warmly and conversationally for a text chat.\n` +
    `- Keep the MEDICAL MEANING EXACTLY THE SAME. Do not change what is being asked.\n` +
    `- You may add a tiny friendly acknowledgement of their last reply ("${lastReply ?? ''}").\n` +
    `- Max 1-2 short sentences. Plain text only.\n\nNext question: "${questionText}"`
  );
  return out ?? questionText;
}

/** Answer a patient's question from the Knowledge Bank (LLM) — falls back to the deflection line. */
export async function kbAnswer(patientText: string, S: Study): Promise<string> {
  const kb = S.knowledgeBank ?? {};
  const info = Object.entries(kb)
    .filter(([, v]) => typeof v === 'string' && v)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
    .slice(0, 2500);
  const out = await llmText(
    `${PERSONA}\n\nThe patient asked: "${patientText}"\n` +
    `Answer briefly and warmly using ONLY the study info below. If it isn't covered, say our ` +
    `coordinator can go over that on a quick call. 1-2 short sentences, plain text.\n\nStudy info:\n${info}`
  );
  return out ?? DEFLECTION;
}

/** greeting (= consent question) shown at the start of a session */
export function convoGreeting(S: Study, name?: string): string {
  const c = S.conversation ?? {};
  const nm = name ? ' ' + name : '';
  if (c.greeting) return c.greeting.replace('{name}', nm);
  const m = S.study ?? {};
  return `Hi${nm}! We're enrolling in a paid ${m.indication ?? 'clinical research'} study. Would you like to see if you may qualify?`;
}

/** closing message shown when the session reaches a terminal state */
export function convoClosing(S: Study, terminal: 'QUALIFIED' | 'DNQ' | 'INCOMPLETE'): string {
  const c = S.conversation ?? {};
  if (terminal === 'QUALIFIED') {
    return (
      c.closingQualified ??
      "Great news — you pre-qualify! Let's set up a quick call to confirm a few details. What time works best for you?"
    );
  }
  if (terminal === 'DNQ') {
    return (
      c.closingDnq ??
      "I'm sorry, but it doesn't look like a match right now. We'll keep your information on file and reach out if a future study fits."
    );
  }
  return (
    c.closingIncomplete ??
    "Thanks for your time. A study coordinator will follow up to finish a few remaining questions."
  );
}

/**
 * Detect question-like patient replies (deflection trigger).
 * Matches sentences ending in "?" or starting with WH-words / modal question openers.
 * Reproduced verbatim from studygen.mjs.
 */
const QUESTION_RE =
  /\?\s*$|^(what|how|am i|do i|could i|can i|will i|would i|is it|is there|are there|does|why|when|where|who)\b/i;

export const isQuestionLike = (t: string): boolean => QUESTION_RE.test((t ?? '').trim());

/**
 * Deflection reply used whenever the patient asks a question during the screening flow.
 * Wording reproduced verbatim from studygen.mjs.
 */
export const DEFLECTION =
  "Good question. I don't have that specific detail right now, but our onsite study coordinator can cover that on a quick call.";

/**
 * Acknowledgment prepended between clinical questions.
 * Wording reproduced verbatim from studygen.mjs.
 */
export const ACK = 'Got it.';

/** Consent gate matchers (reproduced from studygen.mjs) */
export const CONSENT_YES =
  /\b(yes|yeah|yep|yup|sure|ok|okay|absolutely|interested|sounds good|let'?s|go ahead|i would|i am)\b/i;
export const CONSENT_NO =
  /\b(no|nope|not interested|not right now|stop|unsubscribe|maybe later)\b/i;
