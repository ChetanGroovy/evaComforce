/**
 * routes/studies.ts — study CRUD endpoints
 *
 * GET  /api/studies          → StudySummary[]
 * POST /api/studies          → { id, status, documents, note }
 * GET  /api/studies/:id      → StudyDetail
 * POST /api/studies/:id/update → StudyDetail (shallow-merge patch)
 */

import type { FastifyInstance } from 'fastify';
import {
  scanStudies,
  loadStudy,
  studyDetail,
  createStudy,
  updateStudy,
  type CreateStudyBody,
  type UpdateStudyPatch,
} from '../lib/studies.js';

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
      const result = updateStudy(req.params.id, req.body);
      if ('error' in result) {
        return reply.code(result.code).send({ error: result.error });
      }
      return reply.send(result);
    }
  );
}
