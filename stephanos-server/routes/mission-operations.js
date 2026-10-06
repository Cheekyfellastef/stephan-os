import express from 'express';
import { randomUUID } from 'node:crypto';
import { readPublicMissionOperations } from '../services/missionOperationsPublicFeed.js';
import {
  approveBoundedMission,
  cancelBoundedMission,
} from '../services/missionOrchestratorControlService.js';
import { admitOpenClawAppGoal } from '../services/openClawAppGoalIntakeService.js';

const router = express.Router();
const APPROVAL_FIELDS = new Set(['approvalToken', 'commandId']);
const CANCELLATION_FIELDS = new Set(['reason', 'commandId']);

function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function commandId(prefix, supplied) {
  return text(supplied).toLowerCase() || `${prefix}-${randomUUID()}`;
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function assertClosedWorldBody(body, allowedFields) {
  if (!plainObject(body)) throw new Error('Mission Operations control body must be an object.');
  const unexpected = Object.keys(body).find((field) => !allowedFields.has(field));
  if (unexpected) throw new Error(`Mission Operations control field is not allowed: ${unexpected}`);
}

function publicResult(result) {
  return {
    ok: true,
    missionId: result.state.missionId,
    currentPhase: result.state.currentPhase,
    finalVerdict: result.state.finalVerdict,
    operatorActionRequired: result.state.operatorActionRequired === true,
    duplicate: result.duplicate === true,
    updatedAt: result.state.updatedAt,
  };
}

function controlError(error, res) {
  const message = error?.message || 'Mission Operations control failed.';
  const status = /not found|ENOENT/i.test(message)
    ? 404
    : /already exists|terminal|not awaiting|does not match|invalid|required|forbidden|unsupported|not allowed|must be an object/i.test(message)
      ? 409
      : 500;
  res.status(status).json({ ok: false, error: message });
}

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

function isLoopbackRequest(req) {
  const address = String(req?.socket?.remoteAddress || '').toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

router.post('/goals/intake/openclaw', async (req, res) => {
  if (!isLoopbackRequest(req)) {
    res.status(403).json({ ok: false, reason: 'OPENCLAW_APP_GOAL_INTAKE_LOOPBACK_REQUIRED' });
    return;
  }
  try {
    const result = await admitOpenClawAppGoal(req.body || {}, {
      repoRoot: process.cwd(),
      workspaceRoot: process.env.STEPHANOS_SHARED_AGENT_WORKSPACE,
    });
    res.status(result.ok ? (result.created ? 201 : 200) : 400).json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      reason: 'OPENCLAW_APP_GOAL_INTAKE_FAILED',
      error: String(error?.message || 'unknown'),
    });
  }
});

router.get('/', async (req, res) => {
  const feed = await readPublicMissionOperations();
  const requestedMissionId = text(req.query.missionId);
  const payload = requestedMissionId
    ? {
      ...feed,
      missions: feed.missions.filter((mission) => mission.mission.missionId === requestedMissionId),
    }
    : feed;

  res.status(feed.status === 'error' ? 502 : 200).json(payload);
});

router.post('/missions/:missionId/approve', async (req, res) => {
  try {
    assertClosedWorldBody(req.body, APPROVAL_FIELDS);
    const result = await approveBoundedMission({
      missionId: req.params.missionId,
      commandId: commandId('approve', req.body.commandId),
      approvalToken: req.body.approvalToken,
    });
    res.json(publicResult(result));
  } catch (error) {
    controlError(error, res);
  }
});

router.post('/missions/:missionId/cancel', async (req, res) => {
  try {
    assertClosedWorldBody(req.body, CANCELLATION_FIELDS);
    const result = await cancelBoundedMission({
      missionId: req.params.missionId,
      commandId: commandId('cancel', req.body.commandId),
      reason: req.body.reason,
    });
    res.json(publicResult(result));
  } catch (error) {
    controlError(error, res);
  }
});

export default router;
