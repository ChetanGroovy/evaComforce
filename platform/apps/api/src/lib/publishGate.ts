/**
 * publishGate.ts — publish-gate check for study configs.
 *
 * Shells out to the studygen linter (`node studygen.mjs check <study.json>`)
 * from the repo root and interprets its result. We deliberately SHELL OUT
 * rather than import runCheck — that function is not exported from
 * studygen.mjs, and the linter is the single source of truth for pass/fail.
 *
 * Contract (studygen.mjs):
 *   - exit code 1 when there are FAIL findings, exit 0 otherwise.
 *   - prints `eval: N FAIL, M WARN` (studygen.mjs:333) when there are findings,
 *     or `eval: clean ✓` when there are none.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// platform/apps/api/src/lib -> repo root is five levels up.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../..'
);

export interface PublishCheckResult {
  ok: boolean;
  failCount: number;
  raw: string;
}

/**
 * Parse the studygen `check` output for the FAIL count.
 * Returns 0 when the linter reports `clean`, otherwise the N in
 * `eval: N FAIL, M WARN`. Falls back to 0 if no parseable line is found.
 */
function parseFailCount(stdout: string): number {
  if (/eval:\s*clean/.test(stdout)) return 0;
  const m = stdout.match(/eval:\s*(\d+)\s+FAIL/);
  if (m && m[1] !== undefined) return Number.parseInt(m[1], 10);
  return 0;
}

/**
 * Run the studygen publish gate against a study.json.
 *
 * @param studyJsonPath path to the study.json to lint (absolute or relative
 *   to the repo root — passed through to studygen unchanged).
 * @returns ok = (exit code 0 AND failCount 0), plus the parsed failCount and
 *   the raw combined stdout/stderr for surfacing to callers.
 */
export async function runPublishCheck(
  studyJsonPath: string
): Promise<PublishCheckResult> {
  const res = spawnSync(
    'node',
    ['studygen.mjs', 'check', studyJsonPath],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  );

  const raw = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  const exitCode = res.status ?? 1;
  const failCount = parseFailCount(res.stdout ?? '');

  return {
    ok: exitCode === 0 && failCount === 0,
    failCount,
    raw,
  };
}
