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
