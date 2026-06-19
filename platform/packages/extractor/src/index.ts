// @comforceeva/extractor — free-text answer extraction adapter
// Rule-based and LLM extractors. LLM backend selection (mirrors the Python engine's local
// behaviour): ANTHROPIC_API_KEY -> Anthropic Haiku SDK; else the local `claude` CLI
// (Claude Code, NO api key); else the rule extractor. So with no keys it "just works" via the
// developer's Claude Code login, identical to running locally.

import { execFile, spawnSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Run the local `claude` CLI with the prompt piped via STDIN rather than argv.
 * A protocol can be ~350KB; passing it as a single `-p <prompt>` argv element
 * blows the Linux MAX_ARG_STRLEN (128KB) ceiling → `spawn E2BIG`. STDIN has no
 * such limit. `claude -p` with no prompt argument reads the prompt from stdin.
 */
function claudeStdin(prompt: string, model: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('claude', ['-p', '--model', model, '--allowedTools', 'none'], {
      timeout: 180000,
    });
    let out = '';
    let err = '';
    const cap = 4 * 1024 * 1024;
    child.stdout.on('data', (d) => {
      out += d;
      if (out.length > cap) child.kill();
    });
    child.stderr.on('data', (d) => {
      err += d;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${err.slice(0, 300)}`))
    );
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------------------
// Local type definitions (mirrors @comforceeva/schema ScreeningQuestion)
// ---------------------------------------------------------------------------
export interface ScreeningQuestion {
  rank?: number;
  variable_name: string;
  sms_question: string;
  // Presentation-vs-interpretation split: humanised display copy lives in
  // sms_question, but interpretation MUST read the frozen machine string so
  // humanisation can never flip a verdict. interpretation_text is the canonical
  // machine wording; sms_question_machine is the pre-humanise fallback.
  interpretation_text?: string;
  sms_question_machine?: string;
  answer_type: 'yes_no' | 'number' | 'choice' | 'bmi' | 'text';
  choices?: string[];
  routing?: boolean;
  show_if?: string;
  disqualify_condition?: string;
  qualify_condition?: string;
  depends_on?: string[];
  criteria_ids?: string[];
  is_qualifying_question?: boolean;
  knockout_power?: string;
  included_in_flow?: boolean;
  capture?: string;
  bmi_cutoff?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Public contract types
// ---------------------------------------------------------------------------
export interface ExtractorResult {
  value: unknown;
  confidence: number;
  needs_clarification: boolean;
  skip?: boolean;
  bmi?: number;
}

export type ExtractorKind = 'rule' | 'llm';

export type ExtractorFn = (
  q: ScreeningQuestion,
  replyText: string,
  ctx?: Record<string, unknown>
) => ExtractorResult | Promise<ExtractorResult>;

// ---------------------------------------------------------------------------
// Spelled-out number parser  ("fifty-two" → 52)
// ---------------------------------------------------------------------------
const NUM_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};

export function parseWordNumber(t: string): number | null {
  const words = (t || '').toLowerCase().match(/[a-z]+/g) ?? [];
  let total: number | null = null;
  let cur = 0;
  let used = false;
  for (const w of words) {
    if (w in NUM_WORDS) {
      const v = NUM_WORDS[w];
      if (v !== undefined) { cur += v; used = true; }
    } else if (w === 'hundred') {
      cur = (cur || 1) * 100;
      used = true;
    }
  }
  if (used) total = cur;
  return total;
}

// ---------------------------------------------------------------------------
// Height / weight parsers (for BMI derivation)
// ---------------------------------------------------------------------------

// Parses a free-text height string to inches.
// Handles: "5'10\"", "5 ft 10", "70 in", "178 cm", plain numbers.
export function parseHeightInches(t: string | undefined | null): number | null {
  if (!t) return null;
  // feet + optional inches: 5'10", 5 ft 10, 5 feet 10
  let m = t.match(/(\d+)\s*(?:'|ft|feet|foot)\s*(\d+)?/i);
  if (m) return (+m[1]!) * 12 + (+(m[2] ?? 0));
  // centimeters
  m = t.match(/(\d+(?:\.\d+)?)\s*cm/i);
  if (m) return (+m[1]!) / 2.54;
  // plain number heuristic
  m = t.match(/(\d+(?:\.\d+)?)/);
  if (m) {
    const n = +m[1]!;
    if (n > 100) return n / 2.54;   // probably cm
    if (n >= 36 && n <= 90) return n; // probably inches
    if (n < 8) return n * 12;        // probably feet
  }
  return null;
}

// Parses a free-text weight string to pounds.
// Handles: "278 lbs", "126 kg", plain numbers.
export function parseWeightLbs(t: string | undefined | null): number | null {
  if (!t) return null;
  // explicit unit first
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:lb|lbs|pound|pounds)/i);
  if (m) return +m[1]!;
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:kg|kgs|kilo|kilogram|kilograms)/i);
  if (m) return (+m[1]!) * 2.20462;
  // no unit: take the LAST number (height usually comes first, e.g. "5 ft 6, 210")
  const nums = t.match(/\d+(?:\.\d+)?/g);
  return nums && nums.length > 0 ? +nums[nums.length - 1]! : null;
}

// ---------------------------------------------------------------------------
// Core extractAnswer helper (ported verbatim from studygen.mjs)
// ---------------------------------------------------------------------------
interface ExtractRaw {
  ok: boolean;
  value?: unknown;
  skip?: boolean;
}

function extractAnswer(q: ScreeningQuestion, reply: string): ExtractRaw {
  const t = (reply || '').trim();
  if (!t) return { ok: false };
  const low = t.toLowerCase();

  // Skip command
  if (/^(skip|pass|next)$/.test(low)) return { ok: false, skip: true };

  if (q.answer_type === 'number') {
    const m = t.match(/\d{1,3}/);
    return m ? { ok: true, value: Number(m[0]) } : { ok: false };
  }

  if (q.answer_type === 'yes_no') {
    const neg =
      /\b(no|nope|nah|never|not|none|negative)\b/.test(low) ||
      /\b(haven'?t|don'?t|didn'?t|doesn'?t|isn'?t|won'?t|can'?t)\b/.test(low) ||
      /^n$/.test(low);
    const pos =
      /\b(yes|yeah|yep|yup|ya|correct|sure|affirmative|definitely|absolutely|true|right|ok|okay)\b/.test(low) ||
      /^y$/.test(low) ||
      /\bi (have|had|did|do|am)\b/.test(low);

    if (pos && !neg) return { ok: true, value: 'yes' };
    if (neg && !pos) return { ok: true, value: 'no' };
    return { ok: false }; // ambiguous
  }

  if (q.answer_type === 'choice') {
    const choices = q.choices ?? [];
    // exact substring match
    for (const ch of choices) {
      if (low.includes(ch.toLowerCase())) return { ok: true, value: ch };
    }
    // first-character match
    for (const ch of choices) {
      const first = ch[0];
      if (first !== undefined && low === first.toLowerCase()) return { ok: true, value: ch };
    }
    // gender-specific patterns
    if (choices.includes('Female') && /\b(female|woman|girl)\b/.test(low)) return { ok: true, value: 'Female' };
    if (choices.includes('Male') && /\b(male|man|boy)\b/.test(low)) return { ok: true, value: 'Male' };
    return { ok: false };
  }

  // text / fallthrough
  return { ok: true, value: t };
}

// ---------------------------------------------------------------------------
// Rule extractor (deterministic)
// ---------------------------------------------------------------------------
export function ruleExtract(
  q: ScreeningQuestion,
  replyText: string,
  ctx: Record<string, unknown> = {}
): ExtractorResult {
  const t = (replyText || '').trim();

  // BMI derivation — engages when answer_type === 'bmi' OR capture === 'bmi' with ctx height/weight.
  // Checked BEFORE the empty-reply guard because the values come from ctx, not the reply.
  const wantBmi =
    q.answer_type === 'bmi' ||
    (q.capture === 'bmi' && (ctx['height'] != null || ctx['weight'] != null));

  if (wantBmi) {
    const heightSrc = ctx['height'] != null ? String(ctx['height']) : t;
    const weightSrc = ctx['weight'] != null ? String(ctx['weight']) : t;
    const inches = parseHeightInches(heightSrc);
    const lbs = parseWeightLbs(weightSrc);
    if (inches && lbs) {
      const bmi = 703 * lbs / (inches * inches);
      const cutoff = q.bmi_cutoff ?? 27;
      return {
        value: bmi >= cutoff ? 'yes' : 'no',
        confidence: 0.9,
        needs_clarification: false,
        bmi,
      };
    }
    return { value: null, confidence: 0, needs_clarification: true };
  }

  if (!t) return { value: null, confidence: 0, needs_clarification: true };

  const ex = extractAnswer(q, replyText);

  if (ex.ok) {
    return { value: ex.value, confidence: 0.95, needs_clarification: false };
  }

  // Number fallback: spelled-out words ("fifty-two") when the digit regex missed.
  if (q.answer_type === 'number') {
    const n = parseWordNumber(t);
    if (n !== null) return { value: n, confidence: 0.8, needs_clarification: false };
  }

  // Explicit skip — not a clarification request.
  if (ex.skip === true) {
    return { value: null, confidence: 0, needs_clarification: false, skip: true };
  }

  // Empty / ambiguous → re-ask.
  return { value: null, confidence: 0, needs_clarification: true };
}

// ---------------------------------------------------------------------------
// LLM extractor — Anthropic Haiku via tool_use; falls back to rule when
// ANTHROPIC_API_KEY is unset or on timeout/parse error.
// ---------------------------------------------------------------------------
async function llmExtract(
  q: ScreeningQuestion,
  replyText: string,
  ctx: Record<string, unknown> = {}
): Promise<ExtractorResult> {
  if (!process.env['ANTHROPIC_API_KEY']) {
    return ruleExtract(q, replyText, ctx);
  }

  try {
    // Dynamic import so the package still works (type-check passes) without
    // the SDK installed at compile time.
    const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as unknown as {
      default: new (opts: { apiKey: string }) => {
        messages: {
          create: (params: Record<string, unknown>) => Promise<{
            content: Array<{
              type: string;
              name?: string;
              input?: unknown;
            }>;
          }>;
        };
      };
    };

    const apiKey = process.env['ANTHROPIC_API_KEY']!;
    const client = new Anthropic({ apiKey });

    const systemPrompt = 'You are extracting a single screening answer from a patient\'s free-text reply.';

    const interpretationText = q.interpretation_text ?? q.sms_question_machine ?? q.sms_question;
    const questionPrefix = `Question type: ${q.answer_type}. Question: "${interpretationText}".${q.choices ? ` Choices: ${q.choices.join(', ')}.` : ''}`;

    const apiCall = client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' },
        },
      ],
      tools: [
        {
          name: 'extract_answer',
          description: 'Extract the patient answer from free text.',
          input_schema: {
            type: 'object',
            properties: {
              value: {
                description:
                  'The extracted value: number for number questions, "yes" or "no" for yes_no, one of the choices for choice, or null if cannot extract.',
              },
              confidence: {
                type: 'number',
                description: 'Confidence score from 0 to 1.',
              },
              needs_clarification: {
                type: 'boolean',
                description:
                  'True if the reply is ambiguous or empty and the patient should be re-asked.',
              },
            },
            required: ['confidence', 'needs_clarification'],
          },
        },
      ],
      tool_choice: { type: 'auto' },
      messages: [
        {
          role: 'user',
          content: `${questionPrefix}\n\nPatient reply: "${replyText}"`,
        },
      ],
    });

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), 5000)
    );

    const msg = await Promise.race([apiCall, timeout]);

    // Find the tool_use block
    const toolBlock = msg.content.find((b) => b.type === 'tool_use' && b.name === 'extract_answer');
    if (!toolBlock || toolBlock.input == null) {
      return ruleExtract(q, replyText, ctx);
    }

    const parsed = toolBlock.input as Record<string, unknown>;
    return {
      value: parsed['value'] ?? null,
      confidence: typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 0,
      needs_clarification:
        typeof parsed['needs_clarification'] === 'boolean' ? parsed['needs_clarification'] : true,
    };
  } catch {
    // timeout, parse error, network error → fall back to rule
    return ruleExtract(q, replyText, ctx);
  }
}

// ---------------------------------------------------------------------------
// Claude Code (local `claude` CLI) extractor — NO api key needed.
// Mirrors the Python ClaudeCodeClient: spawn `claude -p "<prompt>" --model haiku
// --allowedTools none`, parse the JSON it prints. Falls back to rule on any error.
// ---------------------------------------------------------------------------
let _cliChecked = false;
let _cliOk = false;

export function claudeCliAvailable(): boolean {
  if (_cliChecked) return _cliOk;
  _cliChecked = true;
  try {
    const r = spawnSync('claude', ['--version'], { timeout: 10000, encoding: 'utf8' });
    _cliOk = r.status === 0;
  } catch {
    _cliOk = false;
  }
  return _cliOk;
}

function firstJsonObject(s: string): string {
  const m = s.match(/\{[\s\S]*\}/); // tolerate ```json fences / surrounding prose
  return m ? m[0] : s;
}

async function claudeCodeExtract(
  q: ScreeningQuestion,
  replyText: string,
  ctx: Record<string, unknown> = {}
): Promise<ExtractorResult> {
  // BMI must be computed deterministically from height+weight — the LLM can't do that.
  if (q.answer_type === 'bmi') return ruleExtract(q, replyText, ctx);
  try {
    const model = process.env['CLAUDE_CODE_MODEL'] ?? 'haiku';
    const choices = q.choices ? ` Choices: ${q.choices.join(', ')}.` : '';
    const interpretationText = q.interpretation_text ?? q.sms_question_machine ?? q.sms_question;
    const prompt =
      `Interpret a patient's text reply to ONE clinical screening question.\n` +
      `Question: "${interpretationText}" (expected answer type: ${q.answer_type}).${choices}\n` +
      `Patient reply: "${replyText}"\n\n` +
      `Return ONLY a JSON object (no markdown, no prose) with keys: ` +
      `"value" ("yes" or "no" for yes_no; the number for number; one of the choices for choice; ` +
      `null if it cannot be determined), "confidence" (0 to 1), ` +
      `"needs_clarification" (true if the reply is ambiguous or empty).`;

    const { stdout } = await execFileAsync(
      'claude',
      ['-p', prompt, '--model', model, '--allowedTools', 'none'],
      { timeout: 120000, maxBuffer: 1024 * 1024 }
    );
    const parsed = JSON.parse(firstJsonObject(String(stdout).trim())) as Record<string, unknown>;

    let value = parsed['value'] ?? null;
    if (q.answer_type === 'number' && value != null) value = Number(value);
    if (q.answer_type === 'yes_no' && typeof value === 'string') value = value.trim().toLowerCase();

    return {
      value,
      confidence: typeof parsed['confidence'] === 'number' ? parsed['confidence'] : 0.9,
      needs_clarification:
        typeof parsed['needs_clarification'] === 'boolean'
          ? parsed['needs_clarification']
          : value == null,
    };
  } catch {
    return ruleExtract(q, replyText, ctx); // CLI missing / timeout / bad JSON → deterministic fallback
  }
}

// ---------------------------------------------------------------------------
// Factory — `llm` auto-selects the backend exactly like the Python engine does
// locally: api key > local Claude Code CLI > rule. `LLM_PROVIDER` can force one.
// ---------------------------------------------------------------------------
export function makeExtractor(kind: ExtractorKind = 'rule'): ExtractorFn {
  const rule: ExtractorFn = (q, t, ctx = {}) => ruleExtract(q, t, ctx);
  if (kind === 'rule') return rule;

  const provider = (process.env['LLM_PROVIDER'] ?? 'auto').toLowerCase();
  if (provider === 'off' || provider === 'rule') return rule;

  if (provider === 'anthropic' || (provider === 'auto' && process.env['ANTHROPIC_API_KEY'])) {
    return (q, t, ctx = {}) => llmExtract(q, t, ctx); // their Haiku SDK path
  }
  if ((provider === 'claude_code' || provider === 'auto') && claudeCliAvailable()) {
    return (q, t, ctx = {}) => claudeCodeExtract(q, t, ctx); // local Claude Code, no key
  }
  return rule;
}

// ---------------------------------------------------------------------------
// llmText — free-text generation (greeting, warm phrasing, KB answers). Same
// backend selection as the extractor: Anthropic key > local Claude Code CLI > null.
// Returns null when no LLM backend is available so callers fall back to static text.
// ---------------------------------------------------------------------------
export async function llmText(prompt: string): Promise<string | null> {
  const provider = (process.env['LLM_PROVIDER'] ?? 'auto').toLowerCase();
  if (provider === 'off' || provider === 'rule') return null;

  if (provider === 'anthropic' || (provider === 'auto' && process.env['ANTHROPIC_API_KEY'])) {
    try {
      const { default: Anthropic } = (await import('@anthropic-ai/sdk')) as unknown as {
        default: new (o: { apiKey: string }) => {
          messages: {
            create: (p: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text?: string }> }>;
          };
        };
      };
      const client = new Anthropic({ apiKey: process.env['ANTHROPIC_API_KEY']! });
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 300,
        messages: [{ role: 'user', content: prompt }],
      });
      const block = msg.content.find((b) => b.type === 'text');
      const txt = block?.text?.trim();
      if (txt) return txt;
    } catch {
      /* fall through to Claude Code / null */
    }
  }

  if ((provider === 'claude_code' || provider === 'auto') && claudeCliAvailable()) {
    try {
      const model = process.env['CLAUDE_CODE_MODEL'] ?? 'haiku';
      const stdout = await claudeStdin(prompt, model);
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }
  return null;
}

/** Which backend `makeExtractor('llm')` would use right now (for logging/health). */
export function llmBackend(): 'anthropic' | 'claude_code' | 'rule' {
  const provider = (process.env['LLM_PROVIDER'] ?? 'auto').toLowerCase();
  if (provider === 'off' || provider === 'rule') return 'rule';
  if (provider === 'anthropic' || (provider === 'auto' && process.env['ANTHROPIC_API_KEY'])) return 'anthropic';
  if ((provider === 'claude_code' || provider === 'auto') && claudeCliAvailable()) return 'claude_code';
  return 'rule';
}
