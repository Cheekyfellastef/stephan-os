import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  OPENCLAW_OC1_ISSUE,
  OPENCLAW_OC1_PROVIDER,
  OPENCLAW_OC1_PROVIDER_VERSION,
  OPENCLAW_OC1_TASK_CLASS,
  executeClaimedOpenClawOc1RepositoryScout,
} from './oc1-repository-scout.mjs';

export const OPENCLAW_OC1_GATEWAY_METHOD = 'stephanos-builder-provider.oc1Qualification';
export const OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA = 'stephanos.openclaw-oc1-gateway-request.v1';
export const OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA = 'stephanos.openclaw-oc1-gateway-result.v1';

const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
const ACTION_ID = /^[a-z0-9][a-z0-9._-]{7,127}$/;
const FULL_SHA = /^[a-f0-9]{40}$/;
const GATEWAY_INSTANCE = /^openclaw-gateway:[1-9][0-9]*$/;
const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function blocked(error, details = {}) {
  return Object.freeze({
    schemaVersion: OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA,
    success: false,
    error,
    qualificationEligible: false,
    changedFiles: Object.freeze([]),
    ...details,
  });
}

function resolveMissionWorkerQueueRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_WORKER_QUEUE_DIR);
  if (configured) return path.resolve(configured);
  const orchestratorRoot = text(env.STEPHANOS_MISSION_ORCHESTRATOR_DIR);
  if (orchestratorRoot) return path.resolve(orchestratorRoot, 'worker-queue');
  const userProfile = text(env.USERPROFILE);
  return userProfile
    ? path.resolve(userProfile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'orchestrator', 'worker-queue')
    : '';
}

function validateGatewayRuntimeContext(context) {
  const providerInstance = text(context?.providerInstance);
  return context?.executingInsideOpenClawGateway === true
    && context?.pluginId === 'stephanos-builder-provider'
    && context?.method === OPENCLAW_OC1_GATEWAY_METHOD
    && GATEWAY_INSTANCE.test(providerInstance)
    ? providerInstance
    : '';
}

function validateGatewayRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return 'OPENCLAW_OC1_GATEWAY_REQUEST_INVALID';
  }
  const keys = Object.keys(request);
  if (keys.length !== REQUEST_KEYS.size || keys.some((key) => !REQUEST_KEYS.has(key))) {
    return 'OPENCLAW_OC1_GATEWAY_REQUEST_SHAPE_INVALID';
  }
  if (request.schemaVersion !== OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA) {
    return 'OPENCLAW_OC1_GATEWAY_REQUEST_SCHEMA_INVALID';
  }
  const grant = request.actionGrant;
  const actionId = text(grant?.actionId).toLowerCase();
  if (
    grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
    || grant?.boundedActionCount !== 1
    || grant?.mergeAuthority !== false
    || grant?.leaseSeizureAllowed !== false
    || grant?.issueNumber !== OPENCLAW_OC1_ISSUE
    || text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'
    || text(grant?.repository) !== CANONICAL_REPOSITORY
    || !ACTION_ID.test(actionId)
    || !FULL_SHA.test(text(grant?.sourceRevision).toLowerCase())
  ) {
    return 'OPENCLAW_OC1_GATEWAY_GRANT_INVALID';
  }
  return '';
}

export async function executeOpenClawOc1GatewayRequest(request, options = {}) {
  const providerInstance = validateGatewayRuntimeContext(options.gatewayRuntimeContext);
  if (!providerInstance) return blocked('OPENCLAW_OC1_GATEWAY_RUNTIME_REQUIRED');

  const requestError = validateGatewayRequest(request);
  if (requestError) return blocked(requestError);

  const grant = request.actionGrant;
  const missionId = text(grant.missionId).toLowerCase();
  const taskId = text(grant.actionId).toLowerCase();
  const requestedSourceHead = text(grant.sourceRevision).toLowerCase();
  const queueRoot = resolveMissionWorkerQueueRoot(options.env || process.env);
  if (!queueRoot) {
    return blocked('OPENCLAW_OC1_GATEWAY_QUEUE_ROOT_UNAVAILABLE', { missionId, taskId, requestedSourceHead });
  }

  const processingRoot = path.resolve(queueRoot, 'openclaw-readonly', 'processing');
  const processingPath = path.resolve(processingRoot, `${taskId}.json`);
  let item;
  try {
    item = JSON.parse(await (options.readFileFn || readFile)(processingPath, 'utf8'));
  } catch {
    return blocked('OPENCLAW_OC1_GATEWAY_CLAIM_NOT_FOUND', { missionId, taskId, requestedSourceHead });
  }

  if (
    item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
    || text(item?.adapter).toLowerCase() !== 'openclaw-readonly'
    || text(item?.missionId).toLowerCase() !== missionId
    || text(item?.actionId).toLowerCase() !== taskId
    || !item?.payload
  ) {
    return blocked('OPENCLAW_OC1_GATEWAY_CLAIM_INVALID', { missionId, taskId, requestedSourceHead });
  }

  const claim = Object.freeze({
    adapter: 'openclaw-readonly',
    item,
    processingPath,
    paths: Object.freeze({ processing: processingRoot }),
  });
  const result = await executeClaimedOpenClawOc1RepositoryScout(item.payload, claim, {
    ...options,
    actionGrant: grant,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    goalId: `#${OPENCLAW_OC1_ISSUE}`,
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    requestedSourceHead,
  });

  return Object.freeze({
    schemaVersion: OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA,
    success: result.success === true,
    error: result.success === true ? '' : result.error || 'OPENCLAW_OC1_GATEWAY_EXECUTION_BLOCKED',
    missionId,
    goalId: `#${OPENCLAW_OC1_ISSUE}`,
    taskId,
    taskClass: OPENCLAW_OC1_TASK_CLASS,
    repository: CANONICAL_REPOSITORY,
    requestedSourceHead,
    provider: OPENCLAW_OC1_PROVIDER,
    providerInstance,
    providerVersion: OPENCLAW_OC1_PROVIDER_VERSION,
    executionSurface: 'openclaw-gateway-plugin',
    qualificationEligible: result.success === true,
    result,
  });
}
