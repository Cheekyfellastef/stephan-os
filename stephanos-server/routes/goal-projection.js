import express from 'express';
import { readLiveGoalProjection } from '../services/liveGoalProjectionService.js';
import { importGoalSummaries } from '../services/goalIngestionService.js';

const router = express.Router();

router.post('/import', async (req, res) => {
  const result = await importGoalSummaries(req.body || {});
  res.status(result.status || (result.ok ? 201 : 400)).json(result);
});

router.get('/live', async (_req, res) => {
  const projection = await readLiveGoalProjection();
  res.json(projection);
});

export default router;
