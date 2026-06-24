import express from 'express';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { readPublicMissionOperations } from '../services/missionOperationsPublicFeed.js';
import { approveBoundedMission, cancelBoundedMission, createBoundedMission } from '../services/missionOrchestratorControlService.js';

const router = express.Router();

function text(value) { return value === null || value === undefined ? '' : String(value).trim(); }
function commandId(prefix, supplied) { return text(supplied).toLowerCase() || `${prefix}-${randomUUID()}`; }
function localMissionInput(input = {}, env = process.env) {
  const missionId = text(input.missionId).toLowerCase();
  const userProfile = text(env.USERPROFILE);
  const repositoryRoot = text(env.STEPHANOS_REPOSITORY_ROOT) || (userProfile ? resolve(userProfile, 'Documents', 'GitHub', 'stephan-os') : '');
  return {
    ...input,
    missionId,
    repository: text(input.repository) || text(env.STEPHANOS_REPOSITORY) || 'Cheekyfellastef/stephan-os',
    repositoryRoot,
    baseBranch: 'main',
    branch: `openclaw/${missionId}`,
    worktreePath: userProfile ? resolve(userProfile, 'Documents', 'GitHub', 'stephan-os-worktrees', missionId) : '',
  };
}
function publicResult(result) {
  return { ok: true, missionId: result.state.missionId, currentPhase: result.state.currentPhase, finalVerdict: result.state.finalVerdict, operatorActionRequired: result.state.operatorActionRequired === true, duplicate: result.duplicate === true, updatedAt: result.state.updatedAt };
}
function controlError(error, res) {
  const message = error?.message || 'Mission Operations control failed.';
  const status = /not found|ENOENT/i.test(message) ? 404 : /already exists|terminal|not awaiting|does not match|invalid|required|forbidden|unsupported/i.test(message) ? 409 : 500;
  res.status(status).json({ ok: false, error: message });
}

router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
router.get('/', async (req, res) => {
  const feed = await readPublicMissionOperations();
  const requestedMissionId = text(req.query.missionId);
  const payload = requestedMissionId ? { ...feed, missions: feed.missions.filter((mission) => mission.mission.missionId === requestedMissionId) } : feed;
  res.status(feed.status === 'error' ? 502 : 200).json(payload);
});
router.post('/missions', async (req, res) => {
  try {
    const result = await createBoundedMission(localMissionInput(req.body), { createdBy: 'stephanos-mission-operations-api' });
    res.status(201).json(publicResult(result));
  } catch (error) { controlError(error, res); }
});
router.post('/missions/:missionId/approve', async (req, res) => {
  try {
    const result = await approveBoundedMission({ missionId: req.params.missionId, commandId: commandId('approve', req.body?.commandId), approvalToken: req.body?.approvalToken });
    res.json(publicResult(result));
  } catch (error) { controlError(error, res); }
});
router.post('/missions/:missionId/cancel', async (req, res) => {
  try {
    const result = await cancelBoundedMission({ missionId: req.params.missionId, commandId: commandId('cancel', req.body?.commandId), reason: req.body?.reason });
    res.json(publicResult(result));
  } catch (error) { controlError(error, res); }
});

export default router;
