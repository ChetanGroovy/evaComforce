/**
 * routes/studies.ts — study CRUD endpoints
 *
 * GET  /api/studies          → StudySummary[]
 * POST /api/studies          → { id, status, documents, note }
 * GET  /api/studies/:id      → StudyDetail
 * POST /api/studies/:id/update → StudyDetail (shallow-merge patch)
 */

import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  scanStudies,
  loadStudy,
  studyDetail,
  createStudy,
  updateStudy,
  getStudiesDir,
  type CreateStudyBody,
  type UpdateStudyPatch,
} from '../lib/studies.js';
import { runPublishCheck } from '../lib/publishGate.js';
import { onboardStudy } from '../lib/onboard.js';

export async function studiesRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/studies
  app.get('/studies', async (_req, reply) => {
    return reply.send(scanStudies());
  });

  // POST /api/studies
  app.post<{ Body: CreateStudyBody }>('/studies', async (req, reply) => {
    const result = createStudy(req.body);
    if ('error' in result) {
      return reply.code(result.code).send({ error: result.error });
    }
    return reply.code(201).send(result);
  });

  // GET /api/studies/:id
  app.get<{ Params: { id: string } }>('/studies/:id', async (req, reply) => {
    const S = loadStudy(req.params.id);
    if (!S) return reply.code(404).send({ error: 'study not found' });
    return reply.send(studyDetail(req.params.id, S));
  });

  // POST /api/studies/:id/update
  app.post<{ Params: { id: string }; Body: UpdateStudyPatch }>(
    '/studies/:id/update',
    async (req, reply) => {
      // PF3: publish gate. A transition to 'ready' is patient-facing and must
      // pass the studygen publish check AND have no unresolved review_flag on
      // any screeningQuestion. Other status writes (draft/onboarding/needs_review)
      // pass straight through.
      if (req.body?.status === 'ready') {
        const S = loadStudy(req.params.id);
        if (!S) return reply.code(404).send({ error: 'study not found' });

        // Effective screening questions = the patch's if it sets them, else the
        // study's current set (so we gate on what will actually be persisted).
        const qs = Array.isArray(req.body.screeningQuestions)
          ? req.body.screeningQuestions
          : (S.screeningQuestions ?? []);
        const flagged = qs.some(
          (q) => (q as { review_flag?: unknown }).review_flag
        );
        if (flagged) {
          return reply.code(400).send({
            error:
              'cannot publish: one or more screening questions have an unresolved review_flag',
          });
        }

        const studyJsonPath = path.join(getStudiesDir(), req.params.id, 'study.json');
        const check = await runPublishCheck(studyJsonPath);
        if (!check.ok) {
          return reply.code(400).send({
            error: `cannot publish: study failed the publish gate (${check.failCount} FAIL)`,
            detail: check.raw,
          });
        }
      }

      const result = updateStudy(req.params.id, req.body);
      if ('error' in result) {
        return reply.code(result.code).send({ error: result.error });
      }
      return reply.send(result);
    }
  );

  // POST /api/studies/:id/onboard — run (or re-run) the extraction pipeline.
  // ?force=1 overwrites a non-empty screeningQuestions set.
  app.post<{ Params: { id: string }; Querystring: { force?: string } }>(
    '/studies/:id/onboard',
    async (req, reply) => {
      if (!loadStudy(req.params.id)) {
        return reply.code(404).send({ error: 'study not found' });
      }
      const force = req.query?.force === '1' || req.query?.force === 'true';
      const result = await onboardStudy(req.params.id, { force });
      return reply.send(result);
    }
  );
}
