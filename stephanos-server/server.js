import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import http from 'node:http';
import aiRouter from './routes/ai.js';
import aiAdminRouter from './routes/ai-admin.js';
import memoryRouter from './routes/memory.js';
import tileStateRouter from './routes/tile-state.js';
import { createLogger } from './utils/logger.js';
import { DEFAULT_PROVIDER_KEY } from '../shared/ai/providerDefaults.mjs';
import {
  buildHealthDiagnostics,
  getServerPort,
  isAllowedPrivateFrontendOrigin,
  resolveAllowedOrigins,
} from './config/runtimeConfig.js';
import { memoryService } from './services/memoryService.js';
import { durableMemoryService } from './services/durableMemoryService.js';

const logger = createLogger('server');
const app = express();

const PORT = getServerPort();
const allowedOrigins = resolveAllowedOrigins();
const allowedOriginsSet = new Set(allowedOrigins);
const healthUrl = `http://127.0.0.1:${PORT}/api/health`;

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOriginsSet.has(origin) || isAllowedPrivateFrontendOrigin(origin)) {
        callback(null, true);
        return;
      }

      const error = new Error(`CORS origin denied: ${origin}`);
      error.statusCode = 403;
      error.allowedOrigins = allowedOrigins;
      callback(error);
    },
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json(buildHealthDiagnostics(process.env, req));
});

memoryService.load();
durableMemoryService.load();

app.use('/api/ai', aiRouter);
app.use('/api/ai-admin', aiAdminRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/tile-state', tileStateRouter);

app.use((error, _req, res, next) => {
  if (error?.message?.startsWith('CORS origin denied:')) {
    res.status(403).json({
      ok: false,
      error: 'CORS origin denied',
      denied_origin: error.message.replace('CORS origin denied: ', ''),
      allowed_origin_count: allowedOrigins.length,
      allowed_origins: allowedOrigins,
      configured_via: ['FRONTEND_ORIGIN', 'FRONTEND_ORIGINS'],
    });
    return;
  }

  next(error);
});
async function probeExistingStephanosServer() {
  try {
    const response = await fetch(healthUrl, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      return { reusable: false };
    }

    const payload = await response.json();
    const reusableBaseUrls = new Set([
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
    ]);
    return {
      reusable:
        payload?.service === 'stephanos-server' &&
        reusableBaseUrls.has(payload?.backend_base_url) &&
        reusableBaseUrls.has(payload?.backend_internal_base_url || payload?.backend_base_url),
      payload,
    };
  } catch {
    return { reusable: false };
  }
}

const server = http.createServer(app);

server.on('error', async (error) => {
  if (error?.code !== 'EADDRINUSE') {
    logger.error('Stephanos server failed to start.', error);
    console.error('[BACKEND LIVE] Stephanos server failed to start.', error);
    process.exit(1);
    return;
  }

  const existingServer = await probeExistingStephanosServer();
  if (existingServer.reusable) {
    logger.info(`Stephanos server already running on http://localhost:${PORT}, reusing`);
    console.log(`[BACKEND LIVE] Stephanos server already running on http://localhost:${PORT}, reusing`);
    process.exit(0);
    return;
  }

  logger.error(`Port ${PORT} is occupied by a non-Stephanos process, cannot continue.`);
  console.error(`[BACKEND LIVE] Port ${PORT} is occupied by a non-Stephanos process, cannot continue.`);
  process.exit(1);
});

server.listen(PORT, () => {
  logger.info(`Stephanos server listening on http://localhost:${PORT}`);
  logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Default provider router target: ${DEFAULT_PROVIDER_KEY} (free-tier default)`);
  console.log(`[BACKEND LIVE] Stephanos server listening on http://localhost:${PORT}`);
  console.log(`[BACKEND LIVE] Health endpoint: ${healthUrl}`);
  console.log(`[BACKEND LIVE] Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`[BACKEND LIVE] Default provider router target: ${DEFAULT_PROVIDER_KEY}`);
});
