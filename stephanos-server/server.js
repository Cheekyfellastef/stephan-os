import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import aiRouter from './routes/ai.js';
import { createLogger } from './utils/logger.js';
import { DEFAULT_PROVIDER_KEY } from '../shared/ai/providerDefaults.mjs';
import {
  buildHealthDiagnostics,
  getServerPort,
  resolveAllowedOrigins,
} from './config/runtimeConfig.js';

const logger = createLogger('server');
const app = express();

const PORT = getServerPort();
const allowedOrigins = resolveAllowedOrigins();
const allowedOriginsSet = new Set(allowedOrigins);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOriginsSet.has(origin)) {
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

app.get('/api/health', (_req, res) => {
  res.json(buildHealthDiagnostics());
});

app.use('/api/ai', aiRouter);

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
app.listen(PORT, () => {
  logger.info(`Stephanos server listening on http://localhost:${PORT}`);
  logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Default provider router target: ${DEFAULT_PROVIDER_KEY}`);
});
