import express from 'express';
import { createBuildConciergeGoalRequest } from '../services/buildConciergeGoalService.js';

const router = express.Router();

router.post('/goals', async (req, res) => {
  const result = await createBuildConciergeGoalRequest(req.body || {});
  res.status(result.status).json(result);
});

export default router;
