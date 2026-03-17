import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import aiRouter from './routes/ai.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('server');
const app = express();

const PORT = Number(process.env.PORT || 8787);

function parseAllowedOrigins() {
  const primary = process.env.FRONTEND_ORIGIN || '';
  const multiple = process.env.FRONTEND_ORIGINS || '';

  return [...new Set(`${primary},${multiple}`
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean))];
}

const allowedOrigins = parseAllowedOrigins();
const fallbackLocalOrigin = 'http://localhost:5173';

if (allowedOrigins.length === 0) {
  allowedOrigins.push(fallbackLocalOrigin);
}

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

      const error = new Error('CORS origin denied');
      error.statusCode = 403;
      callback(error);
    },
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'stephanos-server',
    api_status: 'online',
    environment: process.env.NODE_ENV || 'development',
    ts: new Date().toISOString(),
    cors: {
      allowed_origin_count: allowedOrigins.length,
      allowed_origins: allowedOrigins,
    },
  });
});

app.use('/api/ai', aiRouter);


app.use((error, _req, res, next) => {
  if (error?.message === 'CORS origin denied') {
    res.status(403).json({
      ok: false,
      error: 'CORS origin denied',
      allowed_origin_count: allowedOrigins.length,
    });
    return;
  }

  next(error);
});
app.listen(PORT, () => {
  logger.info(`Stephanos server listening on http://localhost:${PORT}`);
  logger.info(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
});
