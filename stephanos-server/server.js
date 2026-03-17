import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import aiRouter from './routes/ai.js';
import { createLogger } from './utils/logger.js';

const logger = createLogger('server');
const app = express();

const PORT = Number(process.env.PORT || 8787);
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || 'http://localhost:5173';

app.use(
  cors({
    origin: FRONTEND_ORIGIN,
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'stephanos-server', ts: new Date().toISOString() });
});

app.use('/api/ai', aiRouter);

app.listen(PORT, () => {
  logger.info(`Stephanos server listening on http://localhost:${PORT}`);
});
