/**
 * engine-shim.ts — thin re-export of the real workspace packages.
 *
 * The verdict engine is @comforceeva/engine (pure, deterministic, tested:
 * golden / equivalence / selfcheck). The extractor is @comforceeva/extractor.
 * Domain types come from @comforceeva/schema. There is NO logic in this file —
 * any verdict fix belongs in packages/engine, not here. This shim exists only so
 * the API's route/lib modules keep their existing `./lib/engine-shim.js` imports.
 */

export {
  norm,
  evalCond,
  compileQuestions,
  parseAnswerTxt,
  screenPatient,
  startSession,
  stepSession,
  finishSession,
  sessionPrompt,
} from '@comforceeva/engine';

export type {
  Session,
  ScreenResult,
  StepResult,
  ExtractFn,
  ExtractResult,
} from '@comforceeva/engine';

export type {
  Study,
  StudyMeta,
  ScreeningQuestion,
  Criterion,
  Document,
  FlowNode,
  FlowEdge,
  Conversation,
  TraceRow,
} from '@comforceeva/schema';

import { makeExtractor as _makeExtractor } from '@comforceeva/extractor';
import type { ExtractFn } from '@comforceeva/engine';

/**
 * The extractor package returns an `ExtractorFn` (its `value` is `unknown` and may
 * be async for the `llm` kind). The engine's session loop expects an `ExtractFn`.
 * The `rule` extractor is synchronous and shape-compatible, so we adapt the type
 * here. (For the async `llm` kind, drive it outside the synchronous session loop.)
 */
export const makeExtractor = (kind: 'rule' | 'llm' = 'rule'): ExtractFn =>
  _makeExtractor(kind) as unknown as ExtractFn;
