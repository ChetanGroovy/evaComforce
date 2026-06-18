/**
 * routes/report.ts — aggregate screening report
 *
 * GET /api/report/:id → { counts, dnqReasons, patients }
 */

import type { FastifyInstance } from 'fastify';
import { reportForStudy, loadStudy } from '../lib/studies.js';

export async function reportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>('/report/:id', async (req, reply) => {
    if (!loadStudy(req.params.id)) {
      return reply.code(404).send({ error: 'study not found' });
    }
    return reply.send(reportForStudy(req.params.id));
  });
}
