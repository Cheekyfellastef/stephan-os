import { readFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  buildMissionWorkerAction,
  issueMissionWorkerAuthorization,
  projectMissionWorkerActionState,
} from '../../shared/agents/missionOrchestratorWorker.mjs';
import {
  appendMissionEvent,
  listMissionRecords,
  readMissionRecord,
  resolveMissionOrchestratorRoot,
  runWithMissionStatePrecondition,
} from './missionOrchestratorStore.js';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function resolveMissionWorkerQueueRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_WORKER_QUEUE_DIR);
  if (configured) return resolve(configured);
  const orchestratorRoot = resolveMissionOrchestratorRoot(env);
  return orchestratorRoot ? resolve(orchestratorRoot, 'worker-queue') : '';
}

function queuePaths(root, adapter) {
  const adapterRoot = resolve(root, adapter);
  return { pending: resolve(adapterRoot, 'pending'), processing: resolve(adapterRoot, 'processing'), completed: resolve(adapterRoot, 'completed'), failed: resolve(adapterRoot, 'failed') };
}

async function createImmutableJson(path, value) {
  try {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if (error?.code === 'EEXIST') return false;
    throw error;
  }
}

function adapterForAction(action) {
  if (action.actionKind === 'signed-openclaw-operation') return 'openclaw-signed';
  if (action.actionKind === 'github-inspection') return 'openclaw-github-readonly';
  if (action.actionKind === 'agent-handoff' && action.adapter === 'codex') return 'codex';
  if (action.actionKind === 'agent-handoff' && action.adapter === 'openclaw-readonly') return 'openclaw-readonly';
  if (action.actionKind === 'local-deployment') return 'openclaw-local-deployment';
  if (action.actionKind === 'evidence-judgment') return 'verification';
  return '';
}

function positiveInteger(value) {
  const normalized = typeof value === 'string'
    ? Number(value.replace(/^#/, ''))
    : Number(value);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null;
}

function encodedMissionIdentity(value) {
  const normalized = text(value).toLowerCase();
  const goalLane = /^goal-([1-9]\d*)-pr-([1-9]\d*)(?:$|[-_.])/.exec(normalized);
  if (goalLane) {
    return {
      issueNumber: positiveInteger(goalLane[1]),
      prNumber: positiveInteger(goalLane[2]),
    };
  }
  const criticalGoal = /^critical-([1-9]\d*)(?:$|[-_.])/.exec(normalized);
  return {
    issueNumber: positiveInteger(criticalGoal?.[1]),
    prNumber: null,
  };
}

function validateExecutionTargetBindings(state, action, grant) {
  const errors = [];
  const repository = text(grant?.repository).toLowerCase();
  const branch = text(grant?.branch);
  const stateRepository = text(state?.repository).toLowerCase();
  const stateBranch = text(state?.git?.branch || state?.branch);
  const actionRepository = text(
    action?.repository || action?.claims?.repository,
  ).toLowerCase();
  const actionBranch = text(action?.branch || action?.claims?.branch);
  if (!repository) errors.push('action-grant-repository-missing');
  else {
    if (stateRepository !== repository) errors.push('action-grant-repository-mismatch');
    if (actionRepository && actionRepository !== repository) {
      errors.push('action-grant-action-repository-mismatch');
    }
  }
  if (!branch) errors.push('action-grant-branch-missing');
  else {
    if (stateBranch !== branch) errors.push('action-grant-branch-mismatch');
    if (actionBranch && actionBranch !== branch) {
      errors.push('action-grant-action-branch-mismatch');
    }
  }

  const missionIdentity = encodedMissionIdentity(state?.missionId);
  const laneIdentity = encodedMissionIdentity(grant?.laneId);
  const laneId = text(grant?.laneId).toLowerCase();
  const stateMissionId = text(state?.missionId).toLowerCase();
  const issueNumber = positiveInteger(grant?.issueNumber);
  const prNumber = positiveInteger(grant?.prNumber);
  const headSha = text(grant?.headSha).toLowerCase();
  const statePrNumber = positiveInteger(
    state?.pullRequest?.number
      ?? state?.prNumber
      ?? state?.relatedPr
      ?? missionIdentity.prNumber,
  );
  const actionPrNumber = positiveInteger(
    action?.prNumber ?? action?.claims?.prNumber,
  );
  const hasPrTarget = Boolean(statePrNumber || actionPrNumber);
  if (hasPrTarget) {
    if (!laneId) errors.push('action-grant-lane-binding-missing');
    if (!issueNumber) errors.push('action-grant-issue-binding-missing');
    if (!prNumber) errors.push('action-grant-pr-binding-missing');
    if (!headSha) errors.push('action-grant-head-binding-missing');
  }
  if (laneId && laneId !== stateMissionId) {
    errors.push('action-grant-lane-mismatch');
  }
  if (issueNumber) {
    const stateIssueNumber = positiveInteger(
      state?.issueNumber
        ?? state?.relatedIssue
        ?? missionIdentity.issueNumber,
    );
    if (!stateIssueNumber) errors.push('action-grant-issue-binding-unproven');
    else if (stateIssueNumber !== issueNumber) errors.push('action-grant-issue-mismatch');
    if (laneIdentity.issueNumber && laneIdentity.issueNumber !== issueNumber) {
      errors.push('action-grant-lane-issue-mismatch');
    }
  }

  if (prNumber) {
    if (!statePrNumber) errors.push('action-grant-pr-binding-unproven');
    else if (statePrNumber !== prNumber) errors.push('action-grant-pr-mismatch');
    if (actionPrNumber && actionPrNumber !== prNumber) {
      errors.push('action-grant-action-pr-mismatch');
    }
    if (laneIdentity.prNumber && laneIdentity.prNumber !== prNumber) {
      errors.push('action-grant-lane-pr-mismatch');
    }
  }

  if (headSha) {
    const stateHeadSha = text(state?.pullRequest?.headSha).toLowerCase();
    const actionHeadSha = text(
      action?.expectedHeadSha || action?.claims?.expectedHeadSha,
    ).toLowerCase();
    if (stateHeadSha !== headSha) errors.push('action-grant-head-mismatch');
    if (actionHeadSha && actionHeadSha !== headSha) {
      errors.push('action-grant-action-head-mismatch');
    }
  }
  return errors;
}

function validateExactActionGrant(state, action, grant, options = {}) {
  const errors = [];
  const sourceRevision = text(grant?.sourceRevision).toLowerCase();
  const expectedSourceRevision = text(
    options.sourceRevision
      || options.env?.STEPHANOS_MISSION_WORKER_HEAD_SHA,
  ).toLowerCase();
  if (grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1') {
    errors.push('invalid-action-grant-schema');
  }
  if (text(grant?.controllerId) !== 'durable-flywheel-controller') {
    errors.push('invalid-action-grant-controller');
  }
  if (!/^[0-9a-f]{40}$/.test(sourceRevision)) {
    errors.push('invalid-action-grant-source-revision');
  }
  if (expectedSourceRevision && sourceRevision !== expectedSourceRevision) {
    errors.push('action-grant-source-revision-mismatch');
  }
  if (grant?.boundedActionCount !== 1) errors.push('action-grant-not-single-use');
  if (text(grant?.missionId).toLowerCase() !== text(state?.missionId).toLowerCase()) {
    errors.push('action-grant-mission-mismatch');
  }
  if (Number(grant?.missionRevision) !== Number(state?.revision)) {
    errors.push('action-grant-revision-mismatch');
  }
  if (text(grant?.currentPhase).toUpperCase() !== text(state?.currentPhase).toUpperCase()) {
    errors.push('action-grant-phase-mismatch');
  }
  if (text(grant?.actionId).toLowerCase() !== text(action?.actionId).toLowerCase()) {
    errors.push('action-grant-action-mismatch');
  }
  if (text(grant?.actionKind) !== text(action?.actionKind)) {
    errors.push('action-grant-kind-mismatch');
  }
  if (text(grant?.adapter) !== adapterForAction(action)) {
    errors.push('action-grant-adapter-mismatch');
  }
  if (text(grant?.operation) !== text(action?.operation)) {
    errors.push('action-grant-operation-mismatch');
  }
  if (grant?.mergeAuthority !== false || grant?.leaseSeizureAllowed !== false) {
    errors.push('action-grant-authority-expanded');
  }
  errors.push(...validateExecutionTargetBindings(state, action, grant));
  return { valid: errors.length === 0, errors };
}

async function beginRepairIfRequired(state, options) {
  if (state.currentPhase !== 'REPAIR_REQUIRED') return { state, repairStarted: false };
  const round = Number.isInteger(state.repair?.currentRound) ? state.repair.currentRound + 1 : 1;
  const started = await appendMissionEvent(state.missionId, {
    eventId: `repair-${state.missionId}-round-${round}`.slice(0, 128),
    eventType: 'REPAIR_STARTED',
    expectedRevision: state.revision,
    expectedCurrentPhase: 'REPAIR_REQUIRED',
    summary: `Bounded Codex repair round ${round} started after required check failure.`,
  }, options);
  return {
    state: started.state,
    repairStarted: started.preconditionFailed !== true,
    preconditionFailed: started.preconditionFailed === true,
    reason: started.reason || '',
  };
}

async function publishLockedMissionWorkerAction(state, options = {}) {
  const action = buildMissionWorkerAction(state, options);
  if (action.executable !== true) {
    return {
      published: false,
      reason: action.reason || action.finalVerdict,
      action,
      path: '',
    };
  }
  if (options.actionGrant) {
    const validation = validateExactActionGrant(
      state,
      action,
      options.actionGrant,
      options,
    );
    if (!validation.valid) {
      return {
        published: false,
        reason: 'locked-action-grant-mismatch',
        blockers: validation.errors,
        action,
        path: '',
      };
    }
  }
  const adapter = adapterForAction(action);
  if (!adapter) {
    return {
      published: false,
      reason: 'unsupported-worker-adapter',
      action,
      path: '',
    };
  }
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) throw new Error('Mission worker queue directory is not configured.');
  const paths = queuePaths(root, adapter);
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })));
  let payload = action;
  if (action.actionKind === 'signed-openclaw-operation') {
    if (!options.privateKeyPem && !options.privateKeyPath) {
      throw new Error('Mission worker authorization private key is not configured.');
    }
    const privateKeyPem = options.privateKeyPem || await readFile(options.privateKeyPath, 'utf8');
    payload = issueMissionWorkerAuthorization(action, privateKeyPem, options);
    if (payload.finalVerdict !== 'MISSION_WORKER_REQUEST_ISSUED') {
      return {
        published: false,
        reason: payload.finalVerdict,
        action,
        payload,
        path: '',
      };
    }
  }
  const path = resolve(paths.pending, `${action.actionId}.json`);
  const published = await createImmutableJson(path, {
    schemaVersion: 'stephanos.mission-worker-queue-item.v1',
    adapter,
    actionId: action.actionId,
    missionId: state.missionId,
    createdAt: options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(),
    payload,
  });
  if (!published) {
    return {
      published: false,
      reason: 'action-already-published',
      action,
      path,
    };
  }
  return {
    published: true,
    reason: '',
    action,
    payload,
    path,
    adapter,
  };
}

export async function publishMissionWorkerAction(inputState, options = {}) {
  if (inputState.dispatch?.status === 'running' && ['AGENT_IMPLEMENTATION', 'REPAIR_REQUIRED', 'LIVE_RUNTIME_INVESTIGATION'].includes(inputState.currentPhase)) return { published: false, reason: 'agent-already-running', action: null, path: '' };
  const prepared = await beginRepairIfRequired(inputState, options);
  if (prepared.preconditionFailed) {
    return {
      published: false,
      reason: 'repair-transition-precondition-failed',
      blockers: [prepared.reason || 'mission-state-precondition-failed'],
      action: null,
      path: '',
      repairStarted: false,
    };
  }
  const state = prepared.state;
  const locked = await runWithMissionStatePrecondition(
    state.missionId,
    {
      expectedRevision: state.revision,
      expectedCurrentPhase: state.currentPhase,
    },
    (current) => publishLockedMissionWorkerAction(current, options),
    options,
  );
  if (locked.preconditionFailed) {
    return {
      published: false,
      reason: 'mission-state-precondition-failed',
      blockers: [locked.reason],
      action: null,
      path: '',
      repairStarted: prepared.repairStarted,
    };
  }
  const result = {
    ...locked.result,
    repairStarted: prepared.repairStarted,
  };
  if (result.published && result.action.actionKind === 'agent-handoff') {
    const action = result.action;
    await appendMissionEvent(state.missionId, {
      eventId: `dispatch-${action.actionId}`.slice(0, 128),
      eventType: 'AGENT_DISPATCHED',
      agentId: action.adapter === 'codex' ? 'codex' : 'openclaw-standalone',
      summary: `${action.adapter} handoff published to the durable worker queue.`,
    }, options);
  }
  return result;
}

export async function publishNextMissionWorkerAction(options = {}) {
  const missions = await listMissionRecords(options);
  const runnable = missions.filter((state) => !['COMPLETE', 'CANCELLED', 'BLOCKED', 'AWAITING_OPERATOR_APPROVAL'].includes(state.currentPhase));
  const grant = options.actionGrant;
  const grantedMissionId = text(grant?.missionId).toLowerCase();
  const candidates = grant
    ? runnable.filter((state) => text(state?.missionId).toLowerCase() === grantedMissionId)
    : runnable;
  if (grant && candidates.length !== 1) {
    return {
      published: false,
      reason: candidates.length ? 'action-grant-mission-ambiguous' : 'action-grant-mission-not-runnable',
      action: null,
      path: '',
    };
  }
  for (const state of candidates) {
    let actionState = state;
    let repairStarted = false;
    if (grant) {
      const projectedState = projectMissionWorkerActionState(state, options);
      const preview = buildMissionWorkerAction(projectedState, options);
      const validation = validateExactActionGrant(projectedState, preview, grant, options);
      if (!validation.valid) {
        return {
          published: false,
          reason: 'action-grant-mismatch',
          blockers: validation.errors,
          action: preview,
          path: '',
        };
      }
      if (state.currentPhase === 'REPAIR_REQUIRED') {
        const prepared = await beginRepairIfRequired(state, options);
        if (prepared.preconditionFailed) {
          return {
            published: false,
            reason: 'repair-transition-precondition-failed',
            blockers: [prepared.reason || 'mission-state-precondition-failed'],
            action: preview,
            path: '',
            repairStarted: false,
          };
        }
        actionState = prepared.state;
        repairStarted = prepared.repairStarted;
        const actualAction = buildMissionWorkerAction(actionState, options);
        const actualValidation = validateExactActionGrant(
          actionState,
          actualAction,
          grant,
          options,
        );
        if (!actualValidation.valid) {
          return {
            published: false,
            reason: 'post-repair-action-grant-mismatch',
            blockers: actualValidation.errors,
            action: actualAction,
            path: '',
            repairStarted,
          };
        }
      }
    }
    const result = await publishMissionWorkerAction(actionState, options);
    if (result.published || grant) {
      return {
        ...result,
        repairStarted: repairStarted || result.repairStarted,
        actionGrantAccepted: Boolean(grant),
      };
    }
  }
  return { published: false, reason: 'no-runnable-mission', action: null, path: '' };
}

export async function readMissionWorkerQueue(options = {}) {
  const root = options.queueRoot || resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!root) return [];
  const adapters = ['openclaw-signed', 'openclaw-github-readonly', 'codex', 'openclaw-readonly', 'openclaw-local-deployment', 'verification'];
  const result = [];
  for (const adapter of adapters) {
    const paths = queuePaths(root, adapter);
    let entries = [];
    try { entries = await readdir(paths.pending, { withFileTypes: true }); } catch (error) { if (error?.code !== 'ENOENT') throw error; }
    for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith('.json'))) {
      const path = join(paths.pending, entry.name);
      try { result.push({ adapter, path, item: JSON.parse(await readFile(path, 'utf8')) }); }
      catch { result.push({ adapter, path, item: null, error: 'queue-item-read-failed' }); }
    }
  }
  return result.sort((left, right) => String(left.item?.createdAt || '').localeCompare(String(right.item?.createdAt || '')));
}

export async function collectAgentWorkerResult(result, options = {}) {
  const missionId = text(result?.missionId).toLowerCase();
  const actionId = text(result?.actionId).toLowerCase();
  const adapter = text(result?.adapter).toLowerCase();
  if (!missionId || !actionId || !['codex', 'openclaw-readonly'].includes(adapter)) throw new Error('Agent result identity is incomplete or unsupported.');
  const current = await readMissionRecord(missionId, options);
  if (current.state.dispatch?.status !== 'running') throw new Error('Mission has no active agent dispatch.');
  if (adapter !== current.state.dispatch.adapter) throw new Error('Agent result adapter does not match the active dispatch.');
  let collected = await appendMissionEvent(missionId, { eventId: `result-${actionId}`.slice(0, 128), eventType: 'AGENT_RESULT_RECEIVED', success: result.success === true, resultId: text(result.resultId, actionId), changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles : [], receipt: result.receipt, error: text(result.error), summary: `${adapter} result collected from the durable worker queue.` }, options);
  const evidenceReceipts = Array.isArray(result.evidenceReceipts) ? result.evidenceReceipts : [];
  if (result.success === true && evidenceReceipts.length) {
    collected = await appendMissionEvent(missionId, {
      eventId: `evidence-${actionId}`.slice(0, 128),
      eventType: 'EVIDENCE_RECORDED',
      receipts: evidenceReceipts,
      summary: `${adapter} grounded evidence collected from the durable worker queue.`,
    }, options);
  }
  return collected;
}
