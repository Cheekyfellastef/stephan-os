import express from 'express';
import { readPublicMissionOperations } from '../services/missionOperationsPublicFeed.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const feed = await readPublicMissionOperations();
  const requestedMissionId = String(req.query.missionId || '').trim();
  const payload = requestedMissionId
    ? {
      ...feed,
      missions: feed.missions.filter((mission) => mission.mission.missionId === requestedMissionId),
    }
    : feed;

  res.status(feed.status === 'error' ? 502 : 200).json(payload);
});

export default router;
