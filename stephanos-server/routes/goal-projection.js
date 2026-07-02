import express from 'express';
import { readLiveGoalProjection } from '../services/liveGoalProjectionService.js';

const router = express.Router();

router.get('/live', async (_req, res) => {
  const projection = await readLiveGoalProjection();
  res.json(projection);
});

export default router;
