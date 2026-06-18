/**
 * @comforceeva/api — Fastify HTTP server
 *
 * Endpoints (all under /api):
 *   GET  /api/studies
 *   POST /api/studies
 *   GET  /api/studies/:id
 *   POST /api/studies/:id/update
 *   POST /api/screen/start
 *   POST /api/screen/answer
 *   GET  /api/report/:id
 *
 * Static: serves ../web/dist at / when present.
 *
 * Config:
 *   PORT        — HTTP port (default 7765)
 *   STUDIES_DIR — study config directory (default: ../../studies from repo root)
 *   HOST        — bind address (default 0.0.0.0)
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import staticFiles from '@fastify/static';
import { studiesRoutes } from './routes/studies.js';
import { screenRoutes } from './routes/screen.js';
import { reportRoutes } from './routes/report.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env['PORT'] ?? 7765);
const HOST = process.env['HOST'] ?? '0.0.0.0';

// Path to the built web app (../web/dist relative to this file's dist/ location)
const WEB_DIST = path.resolve(__dirname, '..', '..', 'web', 'dist');

export async function buildApp(): Promise<ReturnType<typeof Fastify>> {
  const app = Fastify({ logger: true });

  // CORS *
  await app.register(cors, {
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type'],
  });

  // Serve built web app from ../web/dist at / (if present)
  if (fs.existsSync(WEB_DIST)) {
    await app.register(staticFiles, {
      root: WEB_DIST,
      prefix: '/',
      // serve index.html for SPA routes (fallback)
      decorateReply: false,
    });
    app.setNotFoundHandler((req, reply) => {
      // API paths must never fall through to the SPA — return JSON 404.
      if (req.url.startsWith('/api/')) {
        return reply.code(404).send({ error: 'not found' });
      }
      const indexPath = path.join(WEB_DIST, 'index.html');
      if (fs.existsSync(indexPath)) {
        return reply
          .type('text/html')
          .send(fs.readFileSync(indexPath));
      }
      return reply.code(404).send({ error: 'not found' });
    });
  }

  // Register all API routes under /api prefix
  await app.register(
    async (api) => {
      await api.register(studiesRoutes);
      await api.register(screenRoutes);
      await api.register(reportRoutes);
    },
    { prefix: '/api' }
  );

  return app;
}

// Main entry point (not executed when imported in tests)
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  console.log(`comforceEva API → http://localhost:${PORT}`);
  console.log(`  GET  /api/studies`);
  console.log(`  POST /api/studies`);
  console.log(`  GET  /api/studies/:id`);
  console.log(`  POST /api/studies/:id/update`);
  console.log(`  POST /api/screen/start`);
  console.log(`  POST /api/screen/answer`);
  console.log(`  GET  /api/report/:id`);
  console.log(`  static → ${fs.existsSync(WEB_DIST) ? WEB_DIST : '(web/dist not present)'}`);
  console.log(`  STUDIES_DIR → ${process.env['STUDIES_DIR'] ?? '(default prototype studies/)'}`);
}
