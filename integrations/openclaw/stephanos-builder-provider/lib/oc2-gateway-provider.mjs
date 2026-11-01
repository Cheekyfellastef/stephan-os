import path from 'node:path';
import { readFile } from 'node:fs/promises';

import {
  OPENCLAW_OC2_ISSUE,
  OPENCLAW_OC2_OPERATION,
  OPENCLAW_OC2_PROVIDER,
  OPENCLAW_OC2_PROVIDER_VERSION,
  OPENCLAW_OC2_TASK_CLASS,
  executeClaimedOpenClawOc2DeterministicTestBuild,
} from './oc2-deterministic-test-build.mjs';

export const OPENCLAW_OC2_GATEWAY_METHOD = 'stephanos-builder-provider.oc2Qualification';
export const OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA = 'stephanos.openclaw-oc2-gateway-request.v1';
export const OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA = 'stephanos.openclaw-oc2-gateway-result.v1';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const FULL_SHA = /^[a-f0-9]{40}$/;
const ACTION_ID = /^[a-z0-9][a-z0-9._-]{7,127}$/;
const GATEWAY_INSTANCE = /^openclaw-gateway:[1-9][0-9]*$/;
const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function blocked(error, details = {}) {
  return Object.freeze({
    schemaVersion: OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA,
    success: false,
    error,
    qualificationEligible: false,
    changedFiles: Object.freeze([]),
    ...details,
  });
}

function gatewayInstance(context) {
  const providerInstance = text(context?.providerInstance);
  return context?.executingInsideOpenClawGateway === true
    && context?.pluginId === 'stephanos-builder-provider'
    && context?.method === OPENCLAW_OC2_GATEWAY_METHOD
    && GATEWAY_INSTANCE.test(providerInstance)
    ? providerInstance
    : '';
}

function requestBlocker(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) return 'OPENCLAW_OC2_GATEWAY_REQUEST_INVALID';
  const keys = Object.keys(request);
  if (keys.length !== REQUEST_KEYS.size || keys.some((key) => !REQUEST_KEYS.has(key))) return 'OPENCLAW_OC2_GATEWAY_REQUEST_SHAPE_INVALID';
  if (request.schemaVersion !== OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA) return 'OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA_INVALID';
  const grant = request.actionGrant;
  if (grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
    || grant?.boundedActionCount !== 1
    || grant?.mergeAuthority !== false
    || grant?.leaseSeizureAllowed !== false
    || grant?.issueNumber !== OPENCLAW_OC2_ISSUE
    || text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'
    || text(grant?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION
    || text(grant?.repository) !== REPOSITORY
    || !ACTION_ID.test(text(grant?.actionId).toLowerCase())
    || !FULL_SHA.test(text(grant?.sourceRevision).toLowerCase())) {
    return 'OPENCLAW_OC2_GATEWAY_GRANT_INVALID';
  }
  return '';
}

function resolveQueueRoot(env = process.env) {
  const configured = text(env.STEPHANOS_MISSION_WORKER_QUEUE_DIR);
  if (configured) return path.resolve(configured);
  const orchestratorRoot = text(env.STEPHANOS_MISSION_ORCHESTRATOR_DIR);
  if (orchestratorRoot) return path.resolve(orchestratorRoot, 'worker-queue');
  return text(env.USERPROFILE)
    ? path.resolve(env.USERPROFILE, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'orchestrator', 'worker-queue')
    : '';
}

export async function executeOpenClawOc2GatewayRequest(request, options = {}) {
  const providerInstance = gatewayInstance(options.gatewayRuntimeContext);
  if (!providerInstance) return blocked('OPENCLAW_OC2_GATEWAY_RUNTIME_REQUIRED');
  const invalid = requestBlocker(request);
  if (invalid) return blocked(invalid);

  const grant = request.actionGrant;
  const missionId = text(grant.missionId).toLowerCase();
  const taskId = text(grant.actionId).toLowerCase();
  const requestedSourceHead = text(grant.sourceRevision).toLowerCase();
  const queueRoot = resolveQueueRoot(options.env || process.env);
  if (!queueRoot) return blocked('OPENCLAW_OC2_GATEWAY_QUEUE_ROOT_UNAVAILABLE', { missionId, taskId, requestedSourceHead });

  const processingRoot = path.resolve(queueRoot, 'openclaw-readonly', 'processing');
  const processingPath = path.resolve(processingRoot, `${taskId}.json`);
  let item;
  try {
    item = JSON.parse(await (options.readFileFn || readFile)(processingPath, 'utf8'));
  } catch {
    return blocked('OPENCLAW_OC2_GATEWAY_CLAIM_NOT_FOUND', { missionId, taskId, requestedSourceHead });
  }
  if (item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
    || text(item?.adapter).toLowerCase() !== 'openclaw-readonly'
    || text(item?.missionId).toLowerCase() !== missionId
    || text(item?.actionId).toLowerCase() !== taskId
    || text(item?.payload?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION) {
    return blocked('OPENCLAW_OC2_GATEWAY_CLAIM_INVALID', { missionId, taskId, requestedSourceHead });
  }

  const claim = Object.freeze({
    adapter: 'openclaw-readonly',
    item,
    processingPath,
    paths: Object.freeze({ processing: processingRoot }),
  });
  const result = await executeClaimedOpenClawOc2DeterministicTestBuild(item.payload, claim, {
    ...options,
    actionGrant: grant,
    taskClass: OPENCLAW_OC2_TASK_CLASS,
    goalId: `#${OPENCLAW_OC2_ISSUE}`,
    providerVersion: OPENCLAW_OC2_PROVIDER_VERSION,
    requestedSourceHead,
    providerInstance,
  });
  return Object.freeze({
    schemaVersion: OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA,
    success: result.success === true,
    error: result.success === true ? '' : result.error || 'OPENCLAW_OC2_GATEWAY_EXECUTION_BLOCKED',
    missionId,
    goalId: `#${OPENCLAW_OC2_ISSUE}`,
    taskId,
    taskClass: OPENCLAW_OC2_TASK_CLASS,
    repository: REPOSITORY,
    requestedSourceHead,
    provider: OPENCLAW_OC2_PROVIDER,
    providerInstance,
    providerVersion: OPENCLAW_OC2_PROVIDER_VERSION,
    executionSurface: 'openclaw-gateway-plugin',
    qualificationEligible: result.success === true && result.qualificationEligible === true,
    result,
  });
}
