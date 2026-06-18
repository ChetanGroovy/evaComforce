# comforceEva platform — shared contracts (build to these EXACTLY)

This is the single source of truth every package/app builds against. The proven, working logic to port lives
in the prototype at `../studygen.mjs` (a JS monolith) and the study configs in `../studies/<id>/study.json`.
**Port the prototype's behaviour verbatim — do not redesign the verdict logic.** The prototype passes
`golden 10/10`, `test-converse 11/11`, `serve-selfcheck 10/10`; the TS port must reproduce that.

## Package graph (pnpm workspace, ESM, TypeScript strict)
```
@comforceeva/schema     ← zod schemas + inferred types (no deps)
@comforceeva/engine     ← PURE deterministic verdict (depends on schema only; NO i/o, NO llm, NO http)
@comforceeva/extractor  ← free-text → value adapter (rule + Anthropic Haiku); depends on schema
@comforceeva/eval       ← golden / precision-recall gate (depends on schema, engine)
@comforceeva/api        ← Fastify HTTP service (depends on engine, schema, extractor, eval)
@comforceeva/web        ← React+Vite+Tailwind UI (depends on the API contract only, via fetch)
```
Each package: own `package.json` (`"name": "@comforceeva/<x>"`, `"type":"module"`), `tsconfig.json`
(`{"extends":"../../tsconfig.base.json","compilerOptions":{"outDir":"dist","rootDir":"src"},"include":["src"]}`),
scripts `build` (`tsc -p tsconfig.json`), `typecheck` (`tsc --noEmit`), `test` (`vitest run`).
Cross-package imports use the package name (`@comforceeva/engine`), resolved by the workspace.

## Domain types (schema package — zod)
Mirror `../studies/*/study.json`. Key shapes:
- `Criterion { criterion_number:number; source_pages:number[]; criterion_text:string;
   verification_method:'self_report'|'exam'|'lab'|'imaging'|'records'|'derived';
   knockout_strength:'hard'|'soft'|'none'; phone_screenable:boolean; rationale?:string }`
- `ScreeningQuestion { rank:number; variable_name:string; sms_question:string;
   answer_type:'yes_no'|'number'|'choice'; choices?:string[]; routing?:boolean; show_if?:string;
   disqualify_condition?:string; qualify_condition?:string; depends_on?:string[]; criteria_ids?:string[];
   is_qualifying_question?:boolean; knockout_power?:string; included_in_flow?:boolean }`
- `Study { source?:string; capturedAt?:string; status?:'draft'|'ready';
   study:{ name; internalNumber; sponsor; principalInvestigator; site; priority; indication; drug; ... };
   documents:Document[]; knowledgeBank:Record<string,string>;
   inclusionCriteria:Criterion[]; exclusionCriteria:Criterion[]; screeningQuestions:ScreeningQuestion[];
   flow:{ nodes:FlowNode[]; edges:FlowEdge[] }; funnel:[]; patients:[]; recruiters:[];
   conversation?:{ greeting?; closingQualified?; closingDnq?; closingIncomplete? } }`
Export both the zod schemas and the inferred TS types. Validate on read; reject malformed study.json.

## Engine package — PURE deterministic verdict (port from studygen.mjs)
Port these functions to TS, behaviour-identical:
- `compileQuestions(S): ScreeningQuestion[]` — questions sorted by rank.
- `evalCond(expr:string, scope:Record<string,unknown>): boolean|undefined` — evaluates `disqualify_condition`/
  `show_if` (e.g. `answer == no`, `age < 18 || age > 65`, `sex_at_birth == "Female"`). Scope provides
  `answer`, `age` (numeric question), `sex_at_birth`, plus constants `yes/no/Female/Male`. Safe-eval via `new Function`.
- `screenPatient(S, answers): { terminal:'QUALIFIED'|'DNQ'|'INCOMPLETE'; reason?; deferred?:string[]; failed?:string; criteria_ids?:string[]; trace:TraceRow[] }`
  Rules (CRITICAL — reproduce exactly): questions in rank order; `show_if` false → skipped; `routing`
  questions collect a value, never disqualify; a **disclosed disqualifier wins even over earlier missing
  answers** (scan all answered; first disqualifier in rank order = DNQ); else any required-missing →
  INCOMPLETE; else QUALIFIED. yes/no answers normalized lowercase; sex value kept original case.
- `startSession(S)/stepSession(sess,text)/finishSession(sess)` — the stepwise conversational engine; the
  server verdict MUST equal `screenPatient` for the same answers (this is the equivalence invariant).
- Port the parseAnswerTxt key:value parser too.
Ship vitest tests porting `golden` + `test-converse` + `serve-selfcheck` so the same invariants hold.

## Extractor package — adapter
`makeExtractor(kind:'rule'|'llm'): (q:ScreeningQuestion, replyText:string, ctx?) => { value:unknown; confidence:number; needs_clarification:boolean }`
- `rule`: port `extractAnswer` (negation-aware yes/no, number incl. spelled-out, choice, BMI height+weight).
- `llm`: Anthropic **Haiku 4.5** (`claude-haiku-4-5`) via `@anthropic-ai/sdk`, structured tool-use / strict
  output returning `{value,confidence,needs_clarification}`, prompt-cache the stable system+question prefix,
  timeout + fallback to rule. If `process.env.ANTHROPIC_API_KEY` is unset, fall back to rule (documented stub).
Include extractor goldens (`free-text → expected value`) + a vitest suite.

## Eval package
Port `eval` (precision: every question sources a `phone_screenable` criterion; recall: every phone_screenable
criterion has ≥1 question; label cross-check; KB drug-form/compensation grounding) and `golden` (frozen
regression: the 3 historical mistakes stay caught). Expose `runEval(S, docsText?)` and a `golden()` runner.

## API package — Fastify, EXACT endpoint contract (port from studygen.mjs serve)
Base path `/api`. JSON. CORS `*`. Session state in-memory (Map; Redis later). Serve the built web app statically.
- `GET  /api/studies` → `[{ id, name, sponsor, indication, questionCount, status }]`
- `POST /api/studies` `{name, internalNumber?, sponsor?, indication?, documents:[{filename,type,dataBase64}]}`
   → save docs to `studies/<slug>/docs`, run pdftotext → protocol.txt/icf.txt, scaffold draft study.json → `{id,status:'draft',documents}`
- `GET  /api/studies/:id` → `{ id, name, sponsor, indication, drug, phase, questions[], criteriaCount{inclusion,exclusion}, status, overview{...}, knowledgeBank{} }`
- `POST /api/studies/:id/update` `{study?, knowledgeBank?, conversation?, screeningQuestions?, status?}` → shallow-merge, persist, return detail
- `POST /api/screen/start` `{studyId, name?}` → `{ sessionId, greeting?, consent:true, done:false }` (greeting = consent-to-continue; first question comes after the first affirmative reply)
- `POST /api/screen/answer` `{sessionId, text}` → one turn: `{ ack?, prompt?, done, terminal?, reason?, deferred?, closing?, redirected?, trace? }`
   Conversational layer (presentation only — never changes the verdict): consent gate, `ack:"Got it."` between turns, deflection on question-like replies (`{ack:<deflection>, prompt:<same q>, redirected:true}`), `closing` on terminal (qualified scheduling / DNQ on-file). Copy the wording from studygen.mjs.
- `GET  /api/report/:id` → `{ counts{qualified,dnq,incomplete,total}, dnqReasons[], patients[] }` (aggregate `studies/<id>/screening`)
The study config dir is `../../studies` relative to apps/api (i.e. the prototype's `studies/`). Make the path configurable via env `STUDIES_DIR` (default to the prototype's `studies`).

## Web package — React + Vite + Tailwind
Port the prototype UI (`../ui/`) to React components: study picker (with Draft/Ready badge + "+ New Study" upload modal), live SMS-style screening chat (renders `greeting`/`ack`/`closing`/deflection, typing delays), verdict card + collapsible trace, funnel dashboard, and the "Edit Study" modal (overview + Knowledge Bank). All API calls relative (`/api/...`). Dark theme matching the prototype's aesthetic. No external network deps beyond npm packages.

## Ground rules
- TypeScript strict everywhere. No `any` in public APIs.
- The engine stays pure: no `fs`, no `http`, no LLM. I/O lives in apps; LLM lives in extractor.
- Reproduce the prototype's invariants — if your port changes a verdict, it's a bug.
- Network may be unavailable for `pnpm install`; write correct source + package.json regardless. Don't block on installs.
