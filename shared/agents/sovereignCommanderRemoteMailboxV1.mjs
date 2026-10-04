import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export const SOVEREIGN_COMMANDER_REMOTE_OPERATION = 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION';
export const SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS = 6;
export const SOVEREIGN_COMMANDER_REMOTE_ACTIONS = Object.freeze([
  'status',
  'search-project',
  'battle-bridge-status',
  'battle-bridge-observe',
  'meter-status',
  'controller-lane-status',
  'visibility-snapshot',
  'publish-controller-activity',
  'repair-ui-4173',
  'restart-stephanos-runtime',
  'status-recovery-mesh',
  'status-worker-watchdog',
  'status-stephanos-core-daemon',
  'qwen35-canary',
  'vr-resource-governor',
  'gaming-resource-status',
  'gaming-resource-prepare',
  'starfield-vr-resource-preflight',
  'gaming-resource-cancel-prepare',
  'gaming-resource-auto',
  'gaming-resource-force-on',
  'gaming-resource-force-off',
  'gaming-resource-acceptance',
  'vr-virtual-airlink-acceptance',
  'starfield-vr-performance-diagnosis',
  'report-starfield-vr-telemetry',
  'starfield-vr-telemetry-refresh',
  'ignite-stephanos',
  'repair-battle-bridge',
  'repair-control-plane',
  'goal-discovery-heartbeat',
  'fleet-goal-supervisor',
  'start-mission-orchestrator-worker',
  'status-mission-orchestrator-worker',
  'start-stephanos-backend',
  'status-stephanos-backend',
  'status-openclaw-whatsapp',
  'repair-openclaw-ignite',
  'repair-openclaw-stack',
  'repair-openclaw-standalone',
  'repair-openclaw-local',
  'repair-goal-builder-flow',
  'repair-stephanos',
  'prove-vr-atlas-runtime',
  'prove-flywheel-runtime',
  'reconcile-remote-commander-parity',
  'sync-vr-reference-sources',
  'preservation-converge-pr-branch',
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const PROOF_HASH_PATTERN = /^[0-9a-f]{64}$/i;
const ALLOWED_FIELDS = new Set([
  'schemaVersion',
  'requestId',
  'operation',
  'repository',
  'issueNumber',
  'branch',
  'operatorApproval',
  'expectedHead',
  'expiresAt',
  'remoteAction',
  'remotePlan',
  'searchQuery',
  'searchMaxResults',
  'targetPrNumber',
  'targetBranch',
  'targetHead',
  'controllerActivity',
]);
const GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const HEALTH_URL = 'http://127.0.0.1:18791/health';
const MCP_URL = 'http://127.0.0.1:18791/mcp';
const PROTOCOL_VERSION = '2025-11-25';
export const SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS = 210_000;
const SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MAX_MS = 300_000;
const REMOTE_SEARCH_QUERY = /^[A-Za-z0-9_.:/#@() +\-]{1,160}$/;

const CANONICAL_CONTROLLER_IDS = new Set([
  '6a9067ac08bc8191b2d78fae5d2bfd01',
  '6aa425918c8881918c1763ee6acf3cb6',
  '6a9bb24c04748191ada675a686f3b3fa',
  '6a859e0d499c8191aeeee31838d64118',
  '6a6f32b20d8c8191bcb991d043d967f6',
]);
const CONTROLLER_ACTIVITY_EXECUTION_STATES = new Set([
  'RUNNING', 'ACTIVE', 'READY', 'IDLE', 'BLOCKED', 'WAITING', 'SAFE_HOLD', 'FAILED',
]);

function validateRemoteControllerActivity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_INVALID', { requested: true });
  }
  let serialized = '';
  try { serialized = JSON.stringify(value); } catch {}
  if (!serialized || Buffer.byteLength(serialized, 'utf8') > 32_000) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_TOO_LARGE', { requested: true });
  }
  if (value.schemaVersion !== 'stephanos.sovereign-controller-activity-publish.v1') {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_SCHEMA_INVALID', { requested: true });
  }
  const controllerId = text(value.controllerId);
  if (!CANONICAL_CONTROLLER_IDS.has(controllerId)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_CONTROLLER_INVALID', { requested: true });
  }
  const runId = text(value.runId);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(runId)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_RUN_INVALID', { requested: true });
  }
  if (typeof value.observedEnabled !== 'boolean') {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ENABLEMENT_INVALID', { requested: true });
  }
  const executionState = text(value.executionState).toUpperCase();
  if (!CONTROLLER_ACTIVITY_EXECUTION_STATES.has(executionState)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_STATE_INVALID', { requested: true });
  }
  // Some canonical controller prompts report active/parked lane *counts* in the
  // legacy activeLanes/parkedLanes fields. Preserve that truth as bounded count-only
  // telemetry while keeping lane identity arrays empty. Material lanes and proof refs
  // remain identity/proof-bearing arrays and never gain synthetic entries.
  const normalized = { ...value };
  for (const [key, countKey] of [['activeLanes', 'activeLaneCount'], ['parkedLanes', 'parkedLaneCount']]) {
    const candidate = normalized[key];
    const legacyCountCandidate = typeof candidate === 'number'
      ? candidate
      : (typeof candidate === 'string' && /^\\d+$/.test(candidate.trim()) ? Number(candidate) : null);
    if (Number.isSafeInteger(legacyCountCandidate) && legacyCountCandidate >= 0 && legacyCountCandidate <= 15) {
      if (normalized[countKey] !== undefined && Number(normalized[countKey]) !== legacyCountCandidate) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_COUNT_INVALID', { requested: true });
      }
      normalized[countKey] = legacyCountCandidate;
      normalized[key] = [];
    }
  }
  for (const key of ['materialLanes', 'proofRefs']) {
    if (normalized[key] === 0) normalized[key] = [];
  }
  const boundedArray = (items, max) => items === undefined || (Array.isArray(items) && items.length <= max);
  if (!boundedArray(normalized.activeLanes, 15)
    || !boundedArray(normalized.parkedLanes, 15)
    || !boundedArray(normalized.materialLanes, 15)
    || !boundedArray(normalized.proofRefs, 20)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ARRAY_INVALID', { requested: true });
  }
  const laneCounts = [normalized.activeLaneCount, normalized.parkedLaneCount].filter((item) => item !== undefined);
  if (laneCounts.some((item) => !Number.isSafeInteger(Number(item)) || Number(item) < 0 || Number(item) > 15)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_COUNT_INVALID', { requested: true });
  }
  const counts = [
    value.materialActionsSucceeded, value.goalsAdvanced, value.sourceChanges,
    value.reviewsAdvanced, value.mergesCompleted, value.safeEligibleWorkRemaining,
  ].filter((item) => item !== undefined);
  if (counts.some((item) => !Number.isSafeInteger(Number(item)) || Number(item) < 0 || Number(item) > 100_000)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_COUNT_INVALID', { requested: true });
  }
  return Object.freeze({
    ok: true,
    controllerActivity: Object.freeze({ ...normalized, controllerId, runId, executionState }),
  });
}

function text(value) {
  return String(value ?? '').trim();
}

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, verdict: 'BLOCKED', blocker, ...details });
}

function sovereignCommanderCompletionEnvelope(call = {}) {
  const result = call?.body?.result;
  if (result?.isError === true) return {};
  let candidate = result?.structuredContent;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const proofHash = text(candidate.proofHash).toLowerCase();
    if (
      candidate.ok === true
      && candidate.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(proofHash)
    ) {
      return candidate;
    }
    candidate = candidate.structuredContent;
  }
  return {};
}

function mcpStructuredPayload(call = {}) {
  const envelope = sovereignCommanderCompletionEnvelope(call);
  const nested = envelope?.structuredContent;
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return {};
  return nested;
}

function fixedRepositoryRoot(env = process.env) {
  const profile = text(env.USERPROFILE) || homedir();
  return resolve(profile, 'Documents', 'GitHub', 'stephan-os');
}

function fixedTokenPath(env = process.env) {
  const profile = text(env.USERPROFILE) || homedir();
  return resolve(profile, 'Documents', 'OpenClaw-Standalone', 'mission-runner', 'keys', 'sovereign-commander-token.txt');
}

function run(spawnSyncFn, executable, args, options = {}) {
  const result = spawnSyncFn(executable, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 30_000,
    maxBuffer: 256 * 1024,
    ...options,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    status: Number.isInteger(result?.status) ? result.status : null,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
  });
}

function boundedRemoteNetworkTimeoutMs(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 1 && parsed <= SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MAX_MS
    ? parsed
    : SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS;
}

async function fetchTextWithDeadline(fetchFn, url, options = {}, timeoutMs = SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedRemoteNetworkTimeoutMs(timeoutMs));
  try {
    const response = await fetchFn(url, { ...options, signal: controller.signal });
    const bodyText = await response.text();
    return Object.freeze({ response, bodyText });
  } finally {
    clearTimeout(timer);
  }
}

async function postMcp(fetchFn, token, message, sessionId = '', timeoutMs = SOVEREIGN_COMMANDER_REMOTE_NETWORK_TIMEOUT_MS) {
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  };
  if (sessionId) headers['mcp-session-id'] = sessionId;
  let response;
  let bodyText = '';
  try {
    const exchange = await fetchTextWithDeadline(fetchFn, MCP_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(message),
    }, timeoutMs);
    response = exchange.response;
    bodyText = exchange.bodyText;
  } catch (error) {
    return Object.freeze({
      ok: false,
      status: 0,
      sessionId: '',
      body: null,
      transportTimedOut: error?.name === 'AbortError' || error?.code === 'ABORT_ERR',
    });
  }
  let body = null;
  try { body = bodyText ? JSON.parse(bodyText) : null; } catch {}
  return Object.freeze({
    ok: response.ok,
    status: response.status,
    sessionId: text(response.headers?.get?.('mcp-session-id')),
    body,
    transportTimedOut: false,
  });
}

function safeRuntimeProofProjection(value = {}, processId = '') {
  const proofContract = processId === 'prove-vr-atlas-runtime'
    ? Object.freeze({
      marker: 'SOVEREIGN_COMMANDER_UI_RUNTIME_PROOF_RESULT=',
      profile: 'vr-atlas-status-pills',
      verdicts: Object.freeze(['VR_ATLAS_RUNTIME_PROOF_PASS', 'VR_ATLAS_RUNTIME_PROOF_BLOCKED']),
    })
    : processId === 'prove-flywheel-runtime'
      ? Object.freeze({
        marker: 'SOVEREIGN_COMMANDER_FLYWHEEL_RUNTIME_PROOF_RESULT=',
        profile: 'flywheel-live-feed',
        verdicts: Object.freeze(['FLYWHEEL_RUNTIME_PROOF_PASS', 'FLYWHEEL_RUNTIME_PROOF_BLOCKED']),
      })
      : null;
  if (!proofContract) return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(proofContract.marker));
  if (!line) return null;
  let proof = null;
  try { proof = JSON.parse(line.slice(proofContract.marker.length)); } catch {}
  if (!proof || typeof proof !== 'object' || Array.isArray(proof)) return null;
  const sourceHead = text(proof.sourceHead).toLowerCase();
  const evidenceHash = text(proof.evidenceHash).toLowerCase();
  const screenshotSha256 = text(proof.screenshotSha256).toLowerCase();
  const profile = text(proof.profile);
  const finalVerdict = text(proof.finalVerdict);
  const blocker = text(proof.blocker || (Array.isArray(proof.blockers) ? proof.blockers[0] : ''));
  const safeCount = (value, max = 10_000) => {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : null;
  };
  const feedState = text(proof?.feed?.state).toLowerCase();
  const browserLiveState = text(proof?.browser?.liveState).toLowerCase();
  const browserLiveLabel = text(proof?.browser?.liveLabel).toUpperCase();
  return Object.freeze({
    profile: profile === proofContract.profile ? profile : '',
    ok: proof.ok === true,
    sourceHead: SHA_PATTERN.test(sourceHead) ? sourceHead : '',
    exactHeadProofOk: proof.exactHeadProofOk === true,
    finalVerdict: proofContract.verdicts.includes(finalVerdict) ? finalVerdict : '',
    evidenceHash: PROOF_HASH_PATTERN.test(evidenceHash) ? evidenceHash : '',
    screenshotSha256: PROOF_HASH_PATTERN.test(screenshotSha256) ? screenshotSha256 : '',
    pillCount: safeCount(proof.pillCount),
    atlasEvidencePanelReady: proof.evidencePanelReady === true,
    atlasCorpusCount: safeCount(proof.corpusCount),
    atlasCorrelationCount: safeCount(proof.correlationCount),
    atlasResearchAgentActionPresent: Boolean(text(proof.agentAction)),
    feedState: ['ready', 'stale'].includes(feedState) ? feedState : '',
    routeResponseMs: safeCount(proof?.feed?.responseMs, 60_000),
    goalCount: safeCount(proof?.feed?.goalCount, 1_000_000),
    eventCount: safeCount(proof?.feed?.eventCount, 1_000_000),
    starfieldSeedPlanted: proof?.feed?.starfieldSeedPlanted === true,
    browserLiveState: ['ready', 'stale'].includes(browserLiveState) ? browserLiveState : '',
    browserLiveLabel: ['LIVE', 'STALE'].includes(browserLiveLabel) ? browserLiveLabel : '',
    backendUnreachableVisible: proof?.browser?.backendUnreachableVisible === true,
    seedVisible: proof?.browser?.seedVisible === true,
    consoleErrorCount: safeCount(proof.consoleErrorCount),
    pageErrorCount: safeCount(proof.pageErrorCount),
    screenshotCaptured: Boolean(proof.screenshotPath),
    receiptCaptured: Boolean(proof.receiptPath),
    blocker: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(blocker) ? blocker : '',
  });
}

function runtimeProofCompleteForAction(actionId = '', proof = null, expectedHead = '') {
  const common = proof?.ok === true
    && proof?.exactHeadProofOk === true
    && proof?.sourceHead === expectedHead
    && PROOF_HASH_PATTERN.test(proof?.evidenceHash || '')
    && PROOF_HASH_PATTERN.test(proof?.screenshotSha256 || '')
    && proof?.screenshotCaptured === true
    && proof?.receiptCaptured === true
    && Number(proof?.consoleErrorCount || 0) === 0
    && Number(proof?.pageErrorCount || 0) === 0;
  if (!common) return false;
  if (actionId === 'prove-vr-atlas-runtime') {
    return proof.profile === 'vr-atlas-status-pills'
      && proof.finalVerdict === 'VR_ATLAS_RUNTIME_PROOF_PASS'
      && Number(proof.pillCount || 0) >= 4;
  }
  if (actionId === 'prove-flywheel-runtime') {
    return proof.profile === 'flywheel-live-feed'
      && proof.finalVerdict === 'FLYWHEEL_RUNTIME_PROOF_PASS'
      && ['ready', 'stale'].includes(proof.feedState)
      && Number.isSafeInteger(proof.routeResponseMs)
      && proof.routeResponseMs <= 10_000
      && proof.starfieldSeedPlanted === true
      && ['ready', 'stale'].includes(proof.browserLiveState)
      && ['LIVE', 'STALE'].includes(proof.browserLiveLabel)
      && proof.backendUnreachableVisible === false
      && proof.seedVisible === true;
  }
  return false;
}

function safeBattleBridgeObservationProjection(value = {}, processId = '') {
  if (processId !== 'battle-bridge-observe') return null;
  const raw = text(value?.structuredContent?.stdout);
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!parsed || parsed.schemaVersion !== 'stephanos.battle-bridge-observation.v1') return null;
  if (parsed.ok !== true
    || parsed.readOnly !== true
    || parsed.arbitraryShellAllowed !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.finalVerdict !== 'BATTLE_BRIDGE_OBSERVATION_READY') return null;

  const safeIntegerOrNull = (value, max = Number.MAX_SAFE_INTEGER) => {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const safeModelName = (value) => {
    const candidate = text(value);
    return /^[A-Za-z0-9][A-Za-z0-9._:/+\-]{0,119}$/.test(candidate) ? candidate : '';
  };
  const safeShortText = (value, pattern, max = 80) => {
    const candidate = text(value).slice(0, max);
    return pattern.test(candidate) ? candidate : '';
  };
  const safeModels = (items, loaded = false) => Object.freeze(
    (Array.isArray(items) ? items : []).slice(0, 64).flatMap((model) => {
      const name = safeModelName(model?.name);
      if (!name) return [];
      const common = {
        name,
        sizeBytes: safeIntegerOrNull(model?.sizeBytes),
      };
      return [Object.freeze(loaded ? {
        ...common,
        sizeVramBytes: safeIntegerOrNull(model?.sizeVramBytes),
        contextLength: safeIntegerOrNull(model?.contextLength, 10_000_000),
      } : {
        ...common,
        parameterSize: safeShortText(model?.parameterSize, /^[A-Za-z0-9._+\-]{0,39}$/, 40),
        quantizationLevel: safeShortText(model?.quantizationLevel, /^[A-Za-z0-9._+\-]{0,39}$/, 40),
        family: safeShortText(model?.family, /^[A-Za-z0-9._+\-]{0,79}$/, 80),
      })];
    }),
  );
  const safeService = (service = {}) => Object.freeze({
    reachable: service?.reachable === true,
    ready: service?.ready === true,
    httpStatus: safeIntegerOrNull(service?.httpStatus, 599) ?? 0,
  });
  const services = Object.freeze(Object.fromEntries(
    ['ui', 'backend', 'openclaw', 'sovereign-commander', 'ollama']
      .map((id) => [id, safeService(parsed?.services?.[id])]),
  ));
  const gpuName = safeShortText(parsed?.gpu?.name, /^[A-Za-z0-9][A-Za-z0-9 ._()+/\-]{0,119}$/, 120);
  const installedModels = safeModels(parsed?.ollama?.installedModels, false);
  const loadedModels = safeModels(parsed?.ollama?.loadedModels, true);
  const installedModelCount = safeIntegerOrNull(parsed?.ollama?.installedModelCount, 10_000) ?? installedModels.length;
  const loadedModelCount = safeIntegerOrNull(parsed?.ollama?.loadedModelCount, 10_000) ?? loadedModels.length;
  const capturedAtUtc = text(parsed.capturedAtUtc);
  const capturedAtValid = capturedAtUtc.length <= 40 && Number.isFinite(Date.parse(capturedAtUtc));

  return Object.freeze({
    schemaVersion: 'stephanos.battle-bridge-observation.v1',
    ok: true,
    capturedAtUtc: capturedAtValid ? capturedAtUtc : '',
    hostRole: parsed.hostRole === 'battle-bridge' ? 'battle-bridge' : '',
    uptimeSeconds: safeIntegerOrNull(parsed.uptimeSeconds),
    memory: Object.freeze({
      totalBytes: safeIntegerOrNull(parsed?.memory?.totalBytes),
      freeBytes: safeIntegerOrNull(parsed?.memory?.freeBytes),
      usedBytes: safeIntegerOrNull(parsed?.memory?.usedBytes),
    }),
    gpu: Object.freeze({
      available: parsed?.gpu?.available === true,
      name: gpuName,
      memoryTotalMiB: safeIntegerOrNull(parsed?.gpu?.memoryTotalMiB, 1_000_000),
      memoryUsedMiB: safeIntegerOrNull(parsed?.gpu?.memoryUsedMiB, 1_000_000),
      memoryFreeMiB: safeIntegerOrNull(parsed?.gpu?.memoryFreeMiB, 1_000_000),
      utilizationGpuPercent: safeIntegerOrNull(parsed?.gpu?.utilizationGpuPercent, 100),
    }),
    ollama: Object.freeze({
      reachable: parsed?.ollama?.reachable === true,
      installedModelCount,
      loadedModelCount,
      installedModelsTruncated: parsed?.ollama?.installedModelsTruncated === true || installedModelCount > installedModels.length,
      loadedModelsTruncated: parsed?.ollama?.loadedModelsTruncated === true || loadedModelCount > loadedModels.length,
      installedModels,
      loadedModels,
    }),
    services,
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
  });
}


function safeMeterStatusProjection(value = {}, processId = '') {
  if (processId !== 'meter-status') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_METER_STATUS_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.sovereign-meter-status.v1'
    || parsed.ok !== true
    || parsed.readOnly !== true
    || parsed.arbitraryShellAllowed !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.unknownMeansGreen !== false) return null;

  const safePercent = (value) => {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 && number <= 100
      ? Math.round(number * 100) / 100
      : null;
  };
  const safeInteger = (value) => {
    if (value === null || value === undefined) return null;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 && number <= Number.MAX_SAFE_INTEGER ? number : null;
  };
  const safeTime = (value) => {
    const candidate = text(value);
    const ms = Date.parse(candidate);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const safeId = (value) => {
    const candidate = text(value).toLowerCase();
    return /^[a-z0-9][a-z0-9._:-]{0,119}$/.test(candidate) ? candidate : '';
  };
  const meters = Object.freeze((Array.isArray(parsed.meters) ? parsed.meters : [])
    .slice(0, 64)
    .flatMap((meter) => {
      const meterId = safeId(meter?.meterId);
      const provider = safeId(meter?.provider);
      const source = safeId(meter?.source);
      const observationState = text(meter?.observationState).toUpperCase();
      const trafficLight = text(meter?.trafficLight).toUpperCase();
      if (!meterId
        || !provider
        || !source
        || !['CURRENT', 'STALE', 'UNKNOWN'].includes(observationState)
        || !['GREEN', 'AMBER', 'RED', 'GREY'].includes(trafficLight)) return [];
      const availability = text(meter?.availability).toUpperCase().slice(0, 80);
      const truthState = text(meter?.truthState).toUpperCase().slice(0, 80);
      const blocker = text(meter?.blocker).toUpperCase().slice(0, 120);
      return [Object.freeze({
        meterId,
        provider,
        source,
        observationState,
        trafficLight,
        remainingPercent: safePercent(meter?.remainingPercent),
        availability: /^[A-Z0-9._:-]{0,80}$/.test(availability) ? availability : '',
        truthState: /^[A-Z0-9._:-]{0,80}$/.test(truthState) ? truthState : '',
        observedAtUtc: safeTime(meter?.observedAtUtc),
        ageSeconds: safeInteger(meter?.ageSeconds),
        naturalResetAtUtc: safeTime(meter?.naturalResetAtUtc),
        meterTruthUsable: meter?.meterTruthUsable === true,
        observableBySovereign: meter?.observableBySovereign === true,
        limit: safeInteger(meter?.limit),
        remaining: safeInteger(meter?.remaining),
        blocker: /^[A-Z0-9._:-]{0,120}$/.test(blocker) ? blocker : '',
      })];
    }));
  const counts = Object.freeze({
    total: meters.length,
    green: meters.filter((item) => item.trafficLight === 'GREEN').length,
    amber: meters.filter((item) => item.trafficLight === 'AMBER').length,
    red: meters.filter((item) => item.trafficLight === 'RED').length,
    grey: meters.filter((item) => item.trafficLight === 'GREY').length,
  });
  const capturedAtUtc = safeTime(parsed.capturedAtUtc);
  const finalVerdict = text(parsed.finalVerdict).toUpperCase();
  if (!capturedAtUtc
    || !['SOVEREIGN_METER_STATUS_READY', 'SOVEREIGN_METER_STATUS_AMBER_PRESENT', 'SOVEREIGN_METER_STATUS_RED_PRESENT'].includes(finalVerdict)) return null;
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-meter-status.v1',
    ok: true,
    capturedAtUtc,
    counts,
    meters,
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict,
  });
}

function safeControllerLaneStatusProjection(value = {}, processId = '') {
  if (processId !== 'controller-lane-status') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.sovereign-controller-lane-status.v1'
    || parsed.ok !== true
    || parsed.readOnly !== true
    || parsed.arbitraryShellAllowed !== false
    || parsed.sourceMutationAllowed !== false
    || parsed.mergeAuthority !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.unknownMeansGreen !== false) return null;

  const bounded = (input, max = 1_000_000) => {
    if (input === null || input === undefined || input === '') return null;
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const safePercent = (input) => {
    const number = Number(input);
    return Number.isFinite(number) && number >= 0 && number <= 100
      ? Math.round(number * 100) / 100
      : null;
  };
  const safeTime = (input) => {
    const candidate = text(input);
    const ms = Date.parse(candidate);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const safeControllerId = (input) => {
    const candidate = text(input).slice(0, 80);
    return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$/.test(candidate) ? candidate : '';
  };
  const safeTitle = (input) => text(input).replace(/[^A-Za-z0-9 ._()#+/&:-]/g, '').slice(0, 120);
  const safeState = (input, max = 120) => {
    const candidate = text(input).toUpperCase().slice(0, max);
    return /^[A-Z0-9._:-]{0,120}$/.test(candidate) ? candidate : '';
  };
  const safePhysicalController = (controller = {}) => {
    const controllerId = safeControllerId(controller?.controllerId);
    const trafficLight = safeState(controller?.trafficLight, 20);
    if (!controllerId || !['GREEN', 'AMBER', 'RED', 'UNKNOWN'].includes(trafficLight)) return null;
    return Object.freeze({
      controllerId,
      title: safeTitle(controller?.title),
      freshness: safeState(controller?.freshness, 40) || 'UNKNOWN',
      activityState: safeState(controller?.activityState, 80) || 'UNKNOWN',
      trafficLight,
      materialLaneCount: bounded(controller?.materialLaneCount, 100_000),
      activeLaneCount: bounded(controller?.activeLaneCount, 100_000),
      parkedLaneCount: bounded(controller?.parkedLaneCount, 100_000),
      safeEligibleWorkRemaining: bounded(controller?.safeEligibleWorkRemaining, 1_000_000),
      blocker: safeState(controller?.blocker, 120),
    });
  };
  const safeHost = (host = {}) => {
    const controllerId = safeControllerId(host?.controllerId);
    if (!controllerId) return null;
    return Object.freeze({
      controllerId,
      title: safeTitle(host?.title),
      logicalControllerCount: bounded(host?.logicalControllerCount, 1_000_000),
      activeCount: bounded(host?.activeCount, 1_000_000),
      trackingCount: bounded(host?.trackingCount, 1_000_000),
      parkedCount: bounded(host?.parkedCount, 1_000_000),
    });
  };

  const physicalControllers = Object.freeze((Array.isArray(parsed?.physical?.controllers) ? parsed.physical.controllers : [])
    .slice(0, 5)
    .map(safePhysicalController)
    .filter(Boolean));
  const hostLoads = Object.freeze((Array.isArray(parsed?.logical?.hostLoads) ? parsed.logical.hostLoads : [])
    .slice(0, 5)
    .map(safeHost)
    .filter(Boolean));
  const refillHealth = safeState(parsed?.lanes?.refillHealth, 20);
  const refillState = safeState(parsed?.lanes?.refillState, 120);
  if (!['GREEN', 'AMBER', 'RED', 'GREY'].includes(refillHealth)) return null;
  const finalVerdict = safeState(parsed.finalVerdict, 120);
  if (![
    'SOVEREIGN_CONTROLLER_LANE_STATUS_READY',
    'SOVEREIGN_CONTROLLER_LANE_STATUS_REFILL_OR_EVIDENCE_REQUIRED',
    'SOVEREIGN_CONTROLLER_LANE_STATUS_ATTENTION_REQUIRED',
    'SOVEREIGN_CONTROLLER_LANE_STATUS_UNKNOWN',
  ].includes(finalVerdict)) return null;
  const capturedAtUtc = safeTime(parsed.capturedAtUtc);
  if (!capturedAtUtc) return null;

  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-controller-lane-status.v1',
    ok: true,
    capturedAtUtc,
    physical: Object.freeze({
      expected: bounded(parsed?.physical?.expected, 100),
      building: bounded(parsed?.physical?.building, 100),
      amber: bounded(parsed?.physical?.amber, 100),
      red: bounded(parsed?.physical?.red, 100),
      unknown: bounded(parsed?.physical?.unknown, 100),
      allCurrent: parsed?.physical?.allCurrent === true,
      allObservedEnabled: parsed?.physical?.allObservedEnabled === true,
      finalVerdict: safeState(parsed?.physical?.finalVerdict, 120) || 'UNKNOWN',
      controllers: physicalControllers,
    }),
    logical: Object.freeze({
      current: parsed?.logical?.current === true,
      valid: parsed?.logical?.valid === true,
      observedAtUtc: safeTime(parsed?.logical?.observedAtUtc),
      physicalControllerCount: bounded(parsed?.logical?.physicalControllerCount, 100),
      total: bounded(parsed?.logical?.total, 1_000_000),
      active: bounded(parsed?.logical?.active, 1_000_000),
      tracking: bounded(parsed?.logical?.tracking, 1_000_000),
      parked: bounded(parsed?.logical?.parked, 1_000_000),
      retired: bounded(parsed?.logical?.retired, 1_000_000),
      selectedForAdmission: bounded(parsed?.logical?.selectedForAdmission, 1_000_000),
      finalVerdict: safeState(parsed?.logical?.finalVerdict, 120) || 'UNKNOWN',
      hostLoads,
    }),
    lanes: Object.freeze({
      targetMaterialLanes: bounded(parsed?.lanes?.targetMaterialLanes, 100_000),
      activeMaterialLaneCount: bounded(parsed?.lanes?.activeMaterialLaneCount, 100_000),
      activeLaneClaimCount: bounded(parsed?.lanes?.activeLaneClaimCount, 100_000),
      reportedMaterialLaneCountSum: bounded(parsed?.lanes?.reportedMaterialLaneCountSum, 100_000),
      occupancyPercent: safePercent(parsed?.lanes?.occupancyPercent),
      freeTargetLaneSlots: bounded(parsed?.lanes?.freeTargetLaneSlots, 100_000),
      runnableBacklogCount: bounded(parsed?.lanes?.runnableBacklogCount, 1_000_000),
      parkedPhysicalLaneCount: bounded(parsed?.lanes?.parkedPhysicalLaneCount, 100_000),
      reportedSafeEligibleWorkMax: bounded(parsed?.lanes?.reportedSafeEligibleWorkMax, 1_000_000),
      reportedSafeEligibleWorkSum: bounded(parsed?.lanes?.reportedSafeEligibleWorkSum, 1_000_000),
      refillHealth,
      refillState,
    }),
    readOnly: true,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
    unknownMeansGreen: false,
    finalVerdict,
  });
}

function safeVisibilitySnapshotProjection(value = {}, processId = '') {
  if (processId !== 'visibility-snapshot') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_VISIBILITY_SNAPSHOT_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.sovereign-visibility-snapshot.v1'
    || parsed.ok !== true
    || parsed.readOnly !== true
    || parsed.sourceMutationAllowed !== false
    || parsed.arbitraryShellAllowed !== false
    || parsed.arbitraryProcessInspectionAllowed !== false
    || parsed.rawLogsReturned !== false
    || parsed.rawPathsReturned !== false
    || parsed.secretMaterialIncluded !== false
    || parsed.mergeAuthority !== false
    || parsed.pcRestartAuthority !== false
    || parsed.remoteCommanderRequired !== false
    || parsed.unknownMeansGreen !== false) return null;

  const safeTime = (input) => {
    const candidate = text(input);
    const ms = Date.parse(candidate);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const bounded = (input, max = 1_000_000) => {
    if (input === null || input === undefined || input === '') return null;
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const safeState = (input, max = 160) => {
    const candidate = text(input).toUpperCase().slice(0, max);
    return /^[A-Z0-9._:-]{0,160}$/.test(candidate) ? candidate : '';
  };
  const safeBranch = (input) => {
    const candidate = text(input).slice(0, 120);
    return /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/.test(candidate) ? candidate : '';
  };
  const repositoryHead = text(parsed?.repository?.head).toLowerCase();
  const repository = Object.freeze({
    available: parsed?.repository?.available === true,
    head: SHA_PATTERN.test(repositoryHead) ? repositoryHead : '',
    branch: safeBranch(parsed?.repository?.branch),
    dirty: parsed?.repository?.dirty === true,
    changedEntryCount: bounded(parsed?.repository?.changedEntryCount, 100_000),
    trackedChangeCount: bounded(parsed?.repository?.trackedChangeCount, 100_000),
    untrackedCount: bounded(parsed?.repository?.untrackedCount, 100_000),
    rawPathsReturned: false,
  });

  const observationEnvelope = {
    structuredContent: { stdout: JSON.stringify(parsed?.observation || {}) },
  };
  const observation = safeBattleBridgeObservationProjection(observationEnvelope, 'battle-bridge-observe');

  const controllerEnvelope = {
    structuredContent: {
      stdout: `SOVEREIGN_COMMANDER_CONTROLLER_LANE_STATUS_RESULT=${JSON.stringify(parsed?.controllers || {})}`,
    },
  };
  const controllers = safeControllerLaneStatusProjection(controllerEnvelope, 'controller-lane-status');

  const meterEnvelope = {
    structuredContent: {
      stdout: `SOVEREIGN_COMMANDER_METER_STATUS_RESULT=${JSON.stringify(parsed?.meters || {})}`,
    },
  };
  const meters = safeMeterStatusProjection(meterEnvelope, 'meter-status');

  let core = Object.freeze({ available: false });
  if (parsed?.core?.available !== false) {
    const coreEnvelope = { structuredContent: { stdout: JSON.stringify(parsed?.core || {}) } };
    core = safeCoreDaemonStatusProjection(coreEnvelope);
  }

  const proofHashes = Object.freeze((Array.isArray(parsed?.selfHeal?.dependencySelfHealProofHashes)
    ? parsed.selfHeal.dependencySelfHealProofHashes
    : [])
    .map((item) => text(item).toLowerCase())
    .filter((item) => PROOF_HASH_PATTERN.test(item))
    .slice(0, 8));
  const octopusProofHash = text(parsed?.selfHeal?.octopusSelfHealLastProofHash).toLowerCase();
  const selfHeal = Object.freeze({
    available: parsed?.selfHeal?.available === true,
    dependencySelfHealEnabled: parsed?.selfHeal?.dependencySelfHealEnabled === true,
    dependencySelfHealLastAttemptAtUtc: safeTime(parsed?.selfHeal?.dependencySelfHealLastAttemptAtUtc),
    dependencySelfHealAttemptCount: bounded(parsed?.selfHeal?.dependencySelfHealAttemptCount),
    dependencySelfHealLastVerdict: safeState(parsed?.selfHeal?.dependencySelfHealLastVerdict),
    dependencySelfHealLastBlocker: safeState(parsed?.selfHeal?.dependencySelfHealLastBlocker),
    dependencySelfHealProofHashes: proofHashes,
    octopusSelfHealEnabled: parsed?.selfHeal?.octopusSelfHealEnabled === true,
    octopusSelfHealLastAttemptAtUtc: safeTime(parsed?.selfHeal?.octopusSelfHealLastAttemptAtUtc),
    octopusSelfHealAttemptCount: bounded(parsed?.selfHeal?.octopusSelfHealAttemptCount),
    octopusSelfHealLastVerdict: safeState(parsed?.selfHeal?.octopusSelfHealLastVerdict),
    octopusSelfHealLastBlocker: safeState(parsed?.selfHeal?.octopusSelfHealLastBlocker),
    octopusSelfHealLastProofHash: PROOF_HASH_PATTERN.test(octopusProofHash) ? octopusProofHash : '',
    flywheelCycleRunning: parsed?.selfHeal?.flywheelCycleRunning === true,
    flywheelLastCycleFinishedAtUtc: safeTime(parsed?.selfHeal?.flywheelLastCycleFinishedAtUtc),
    flywheelLastStatus: safeState(parsed?.selfHeal?.flywheelLastStatus, 120),
    flywheelLastAction: safeState(parsed?.selfHeal?.flywheelLastAction, 120),
    flywheelLastBlockerCount: bounded(parsed?.selfHeal?.flywheelLastBlockerCount),
  });

  const relay = Object.freeze({
    available: parsed?.relay?.available === true,
    daemonHealthy: parsed?.relay?.daemonHealthy === true,
    carrierHealthy: parsed?.relay?.carrierHealthy === true,
    deliveryState: safeState(parsed?.relay?.deliveryState, 80),
    adaptivePollMode: safeState(parsed?.relay?.adaptivePollMode, 40),
    nextPollMs: bounded(parsed?.relay?.nextPollMs, 60_000),
    heartbeatAtUtc: safeTime(parsed?.relay?.heartbeatAtUtc),
    heartbeatAgeSeconds: bounded(parsed?.relay?.heartbeatAgeSeconds, 31_536_000),
    carrierConsecutiveFailures: bounded(parsed?.relay?.carrierConsecutiveFailures),
    scheduledMailboxFallbackExpected: parsed?.relay?.scheduledMailboxFallbackExpected === true,
    fallbackCovered: parsed?.relay?.fallbackCovered === true,
    retryIdentityPreserved: parsed?.relay?.retryIdentityPreserved === true,
    blocker: safeState(parsed?.relay?.blocker),
    finalVerdict: safeState(parsed?.relay?.finalVerdict, 120),
  });

  const safeLight = (input) => {
    const candidate = safeState(input, 20);
    return ['GREEN', 'AMBER', 'RED', 'GREY'].includes(candidate) ? candidate : 'GREY';
  };
  const health = Object.freeze({
    repository: safeLight(parsed?.health?.repository),
    core: safeLight(parsed?.health?.core),
    services: safeLight(parsed?.health?.services),
    laneRefill: safeLight(parsed?.health?.laneRefill),
    transport: safeLight(parsed?.health?.transport),
  });
  const capturedAtUtc = safeTime(parsed.capturedAtUtc);
  const finalVerdict = safeState(parsed.finalVerdict, 120);
  if (!capturedAtUtc
    || !observation
    || !controllers
    || !meters
    || ![
      'SOVEREIGN_VISIBILITY_SNAPSHOT_READY',
      'SOVEREIGN_VISIBILITY_SNAPSHOT_DEGRADED_OR_INCOMPLETE',
      'SOVEREIGN_VISIBILITY_SNAPSHOT_ATTENTION_REQUIRED',
    ].includes(finalVerdict)) return null;

  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-visibility-snapshot.v1',
    ok: true,
    capturedAtUtc,
    repository,
    observation,
    core,
    selfHeal,
    controllers,
    meters,
    relay,
    health,
    readOnly: true,
    sourceMutationAllowed: false,
    arbitraryShellAllowed: false,
    arbitraryProcessInspectionAllowed: false,
    rawLogsReturned: false,
    rawPathsReturned: false,
    secretMaterialIncluded: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    remoteCommanderRequired: false,
    unknownMeansGreen: false,
    finalVerdict,
  });
}

function safeCapabilityParityProjection(value = {}, processId = '') {
  if (processId !== 'reconcile-remote-commander-parity') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const prefix = 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(prefix));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(prefix.length)); } catch {}
  if (!parsed || parsed.ok !== true) return null;
  const bounded = (input) => {
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 && number <= 10000 ? number : null;
  };
  const retainedCapabilityCount = bounded(parsed.retainedCapabilityCount);
  const parityPresentCount = bounded(parsed.parityPresentCount);
  const buildableGapCount = bounded(parsed.buildableGapCount);
  const boundaryHoldCount = bounded(parsed.boundaryHoldCount);
  if ([retainedCapabilityCount, parityPresentCount, buildableGapCount, boundaryHoldCount].some((entry) => entry === null)) return null;
  const finalVerdict = text(parsed.finalVerdict);
  if (!['SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GREEN', 'SOVEREIGN_COMMANDER_CAPABILITY_PARITY_GAPS_TRACKED'].includes(finalVerdict)) return null;
  return Object.freeze({
    canonicalOwnerGoal: text(parsed.canonicalOwnerGoal) === '#2573' ? '#2573' : '',
    retainedCapabilityCount,
    parityPresentCount,
    buildableGapCount,
    boundaryHoldCount,
    zeroGapInvariantSatisfied: buildableGapCount === 0,
    closureRequired: buildableGapCount > 0,
    daemonMayReportGreen: buildableGapCount === 0,
    mustContinueUntilZero: true,
    finalVerdict,
  });
}

function safeStarfieldVrTelemetryProjection(value = {}, processId = '') {
  if (!['report-starfield-vr-telemetry', 'starfield-vr-telemetry-refresh'].includes(processId)) return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'STARFIELD_VR_TELEMETRY_HEADLINE_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.starfield-vr-telemetry-headline.v1'
    || parsed.primaryTelemetryPublished !== true
    || parsed.rawTelemetryReturned !== false
    || parsed.hostPathsReturned !== false
    || parsed.secretMaterialReturned !== false) return null;

  const safeText = (input, max = 240) => {
    const candidate = text(input).replace(/[\r\n\t]/g, ' ').slice(0, max);
    return /^[\x20-\x7E]*$/.test(candidate) ? candidate : '';
  };
  const boundedCount = (input, max = 10_000_000) => {
    if (input === null || input === undefined || input === '') return null;
    const number = Number(input);
    return Number.isSafeInteger(number) && number >= 0 && number <= max ? number : null;
  };
  const boundedMetric = (input, min = 0, max = 1_000_000_000) => {
    if (input === null || input === undefined || input === '') return null;
    const number = Number(input);
    return Number.isFinite(number) && number >= min && number <= max
      ? Math.round(number * 100) / 100
      : null;
  };
  const safeTime = (input) => {
    const candidate = text(input);
    const ms = Date.parse(candidate);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : '';
  };
  const headline = parsed?.headline && typeof parsed.headline === 'object' && !Array.isArray(parsed.headline)
    ? parsed.headline
    : {};
  const sourceHead = safeText(headline.sourceHead, 40).toLowerCase();
  const signals = Object.freeze((Array.isArray(headline.signals) ? headline.signals : [])
    .map((item) => safeText(item, 120))
    .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(item))
    .slice(0, 32));
  const finalVerdict = safeText(parsed.finalVerdict, 120);
  const generatedAtUtc = safeTime(parsed.generatedAtUtc);
  if (!generatedAtUtc
    || !['STARFIELD_VR_TELEMETRY_REPORT_PUBLISHED', 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED'].includes(finalVerdict)) return null;

  const publication = Object.freeze({
    packet: parsed?.publication?.packet === true,
    history: parsed?.publication?.history === true,
    loop: parsed?.publication?.loop === true,
    event: parsed?.publication?.event === true,
  });
  if (!publication.packet || !publication.history) return null;
  const degraded = finalVerdict === 'STARFIELD_VR_TELEMETRY_REPORT_DEGRADED';

  return Object.freeze({
    schemaVersion: 'stephanos.starfield-vr-telemetry-headline.v1',
    ok: parsed.ok === true,
    generatedAtUtc,
    finalVerdict,
    sessionId: safeText(parsed.sessionId, 160),
    headline: Object.freeze({
      focus: safeText(headline.focus, 120),
      provider: safeText(headline.provider, 80),
      providerIdentityStatus: safeText(headline.providerIdentityStatus, 80),
      launchSessionId: safeText(headline.launchSessionId, 160),
      sourceHead: SHA_PATTERN.test(sourceHead) ? sourceHead : '',
      telemetrySessionId: safeText(headline.telemetrySessionId, 160),
      signals,
      sessionOutcome: safeText(headline.sessionOutcome, 80),
      partialTelemetry: headline.partialTelemetry === true,
      crashEvidenceCount: boundedCount(headline.crashEvidenceCount, 10_000),
      sampleCount: boundedCount(headline.sampleCount),
      avgGpuUtilPct: boundedMetric(headline.avgGpuUtilPct, 0, 100),
      maxGpuUtilPct: boundedMetric(headline.maxGpuUtilPct, 0, 100),
      maxGpuMemoryPct: boundedMetric(headline.maxGpuMemoryPct, 0, 100),
      avgStarfieldCpuPct: boundedMetric(headline.avgStarfieldCpuPct, 0, 100),
      avgSystemCpuPct: boundedMetric(headline.avgSystemCpuPct, 0, 100),
      maxLlamaServerCount: boundedCount(headline.maxLlamaServerCount, 1000),
      airLinkRuntimeSamplePct: boundedMetric(headline.airLinkRuntimeSamplePct, 0, 100),
      minGameDriveFreeGiB: boundedMetric(headline.minGameDriveFreeGiB, 0, 10_000_000),
      minGameDriveFreePct: boundedMetric(headline.minGameDriveFreePct, 0, 100),
      avgGameDriveActivePct: boundedMetric(headline.avgGameDriveActivePct, 0, 100),
      maxGameDriveLatencyMs: boundedMetric(headline.maxGameDriveLatencyMs, 0, 10_000_000),
      maxGameDriveQueueLength: boundedMetric(headline.maxGameDriveQueueLength, 0, 1_000_000),
      maxPagesPerSec: boundedMetric(headline.maxPagesPerSec, 0, 1_000_000_000),
      storageTelemetryAvailable: headline.storageTelemetryAvailable === true,
      topRecommendation: safeText(headline.topRecommendation, 240),
      topRecommendationSource: safeText(headline.topRecommendationSource, 160),
      projectLoopState: safeText(headline.projectLoopState, 120),
      projectTelemetryGapCount: boundedCount(headline.projectTelemetryGapCount, 10_000),
      projectNextExperiment: safeText(headline.projectNextExperiment, 240),
    }),
    history: Object.freeze({
      sessionCount: boundedCount(parsed?.history?.sessionCount, 1_000_000),
      newestSessionId: safeText(parsed?.history?.newestSessionId, 160),
    }),
    publication,
    degraded,
    primaryTelemetryPublished: true,
    auxiliaryProjectionPublished: parsed.auxiliaryProjectionPublished === true,
    sharedWorkspacePublished: parsed.sharedWorkspacePublished === true,
    rawTelemetryReturned: false,
    hostPathsReturned: false,
    secretMaterialReturned: false,
  });
}

function safePreservationConvergenceProjection(value = {}, command = {}) {
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value;
  const processId = text(source?.command?.plan?.processId);
  const status = Number(source?.structuredContent?.status);
  const stdout = String(source?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_PRESERVATION_CONVERGENCE_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  let parsed = null;
  try { parsed = line ? JSON.parse(line.slice(marker.length)) : null; } catch {}
  const proofHash = text(parsed?.proofHash).toLowerCase();
  const proofCore = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? {
      schemaVersion: parsed.schemaVersion,
      timestampUtc: parsed.timestampUtc,
      canonicalOwnerGoal: parsed.canonicalOwnerGoal,
      relatedPr: parsed.relatedPr,
      branch: parsed.branch,
      oldHead: parsed.oldHead,
      protectedMainHead: parsed.protectedMainHead,
      newHead: parsed.newHead,
      changed: parsed.changed,
      pushed: parsed.pushed,
      diffCheckPassed: parsed.diffCheckPassed,
      oldHeadAncestorPreserved: parsed.oldHeadAncestorPreserved,
      mainAncestorPreserved: parsed.mainAncestorPreserved,
      exactHeadWriterGuard: parsed.exactHeadWriterGuard,
      nonForcePushOnly: parsed.nonForcePushOnly,
      mergeAuthority: parsed.mergeAuthority,
      directMainWriteAllowed: parsed.directMainWriteAllowed,
      forcePushAllowed: parsed.forcePushAllowed,
      rebaseAllowed: parsed.rebaseAllowed,
      resetAllowed: parsed.resetAllowed,
      leaseSeizureAllowed: parsed.leaseSeizureAllowed,
      finalVerdict: parsed.finalVerdict,
    }
    : null;
  const recomputedProofHash = proofCore
    ? createHash('sha256').update(JSON.stringify(proofCore)).digest('hex')
    : '';
  const oldHead = text(parsed?.oldHead).toLowerCase();
  const protectedMainHead = text(parsed?.protectedMainHead).toLowerCase();
  const newHead = text(parsed?.newHead).toLowerCase();
  const branch = text(parsed?.branch);
  const relatedPr = Number(parsed?.relatedPr);
  const valid = processId === 'preservation-converge-pr-branch'
    && Number.isInteger(status) && status === 0
    && parsed?.ok === true
    && parsed?.schemaVersion === 'stephanos.sovereign-preservation-convergence.v1'
    && parsed?.finalVerdict === 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE'
    && relatedPr === Number(command?.targetPrNumber)
    && branch === text(command?.targetBranch)
    && oldHead === text(command?.targetHead).toLowerCase()
    && protectedMainHead === text(command?.expectedHead).toLowerCase()
    && SHA_PATTERN.test(newHead)
    && PROOF_HASH_PATTERN.test(proofHash)
    && proofHash === recomputedProofHash
    && parsed?.changed === (newHead !== oldHead)
    && parsed?.pushed === parsed?.changed
    && parsed?.canonicalOwnerGoal === '#2573'
    && typeof parsed?.timestampUtc === 'string'
    && Number.isFinite(Date.parse(parsed.timestampUtc))
    && parsed?.diffCheckPassed === true
    && parsed?.oldHeadAncestorPreserved === true
    && parsed?.mainAncestorPreserved === true
    && parsed?.exactHeadWriterGuard === true
    && parsed?.nonForcePushOnly === true
    && parsed?.mergeAuthority === false
    && parsed?.directMainWriteAllowed === false
    && parsed?.forcePushAllowed === false
    && parsed?.rebaseAllowed === false
    && parsed?.resetAllowed === false
    && parsed?.leaseSeizureAllowed === false;
  if (!valid) return null;
  return Object.freeze({
    schemaVersion: 'stephanos.sovereign-preservation-convergence.v1',
    ok: true,
    relatedPr,
    branch,
    oldHead,
    protectedMainHead,
    newHead,
    changed: parsed?.changed === true,
    pushed: parsed?.pushed === true,
    proofHash,
    finalVerdict: 'SOVEREIGN_PRESERVATION_CONVERGENCE_COMPLETE',
    mergeAuthority: false,
    directMainWriteAllowed: false,
    forcePushAllowed: false,
    rebaseAllowed: false,
    resetAllowed: false,
    leaseSeizureAllowed: false,
  });
}

function safeControllerActivityPublicationProjection(value = {}, processId = '') {
  if (processId !== 'publish-controller-activity') return null;
  const stdout = String(value?.structuredContent?.stdout || '');
  const marker = 'SOVEREIGN_COMMANDER_CONTROLLER_ACTIVITY_PUBLISH_RESULT=';
  const line = stdout.split(/\r?\n/).find((entry) => entry.startsWith(marker));
  if (!line) return null;
  let parsed = null;
  try { parsed = JSON.parse(line.slice(marker.length)); } catch {}
  const controllerId = text(parsed?.controllerId);
  const runId = text(parsed?.runId);
  const statusId = text(parsed?.statusId);
  const proofId = text(parsed?.proofId);
  const executionState = text(parsed?.executionState).toUpperCase();
  const materialLaneCount = Number(parsed?.materialLaneCount);
  const materialActionsSucceeded = Number(parsed?.materialActionsSucceeded);
  if (!parsed
    || parsed.schemaVersion !== 'stephanos.sovereign-controller-activity-publish.v1'
    || parsed.ok !== true
    || parsed.finalVerdict !== 'SOVEREIGN_CONTROLLER_ACTIVITY_PUBLISHED'
    || !CANONICAL_CONTROLLER_IDS.has(controllerId)
    || !/^[A-Za-z0-9._-]{1,80}$/.test(runId)
    || !/^controller-[A-Za-z0-9._-]+-activity$/.test(statusId)
    || !CONTROLLER_ACTIVITY_EXECUTION_STATES.has(executionState)
    || !Number.isSafeInteger(materialLaneCount) || materialLaneCount < 0 || materialLaneCount > 15
    || !Number.isSafeInteger(materialActionsSucceeded) || materialActionsSucceeded < 0 || materialActionsSucceeded > 100_000
    || parsed.arbitraryShellAllowed !== false
    || parsed.sourceMutationAllowed !== false
    || parsed.mergeAuthority !== false
    || parsed.secretMaterialIncluded !== false) return null;
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    ok: true,
    controllerId,
    runId,
    statusWritten: parsed.statusWritten === true,
    proofWritten: parsed.proofWritten === true,
    statusId,
    proofId: /^[A-Za-z0-9._-]{0,160}$/.test(proofId) ? proofId : '',
    executionState,
    materialLaneCount,
    materialActionsSucceeded,
    finalVerdict: parsed.finalVerdict,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAuthority: false,
    secretMaterialIncluded: false,
  });
}

function safeMaintenanceProjection(value = {}) {
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value;
  const proofHash = text(source?.proofHash).toLowerCase();
  const processId = text(source?.command?.plan?.processId);
  const status = Number(source?.structuredContent?.status);
  const errorCode = text(source?.structuredContent?.errorCode);
  return Object.freeze({
    ok: source?.ok === true,
    finalVerdict: text(source?.finalVerdict),
    proofHash: PROOF_HASH_PATTERN.test(proofHash) ? proofHash : '',
    processId: /^[A-Za-z0-9][A-Za-z0-9._-]{1,119}$/.test(processId) ? processId : '',
    status: Number.isInteger(status) ? status : null,
    errorCode: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(errorCode) ? errorCode : '',
    runtimeProof: safeRuntimeProofProjection(source, processId),
    observation: safeBattleBridgeObservationProjection(source, processId),
    meterStatus: safeMeterStatusProjection(source, processId),
    controllerLaneStatus: safeControllerLaneStatusProjection(source, processId),
    controllerActivityPublication: safeControllerActivityPublicationProjection(source, processId),
    capabilityParity: safeCapabilityParityProjection(source, processId),
    starfieldVrTelemetry: safeStarfieldVrTelemetryProjection(source, processId),
  });
}

function findMaintenanceExecutionEnvelope(value = {}) {
  let candidate = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const processId = text(candidate?.command?.plan?.processId);
    const status = Number(candidate?.structuredContent?.status);
    if (processId && Number.isInteger(status)) return candidate;
    candidate = candidate.structuredContent;
  }
  return {};
}

function findFailedMaintenanceExecutionEnvelope(value = {}) {
  let candidate = value;
  for (let depth = 0; depth < 5; depth += 1) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return {};
    const processId = text(candidate?.command?.plan?.processId);
    const status = Number(candidate?.structuredContent?.status);
    const hasBoundedOutput = typeof candidate?.structuredContent?.stdout === 'string'
      || typeof candidate?.structuredContent?.stderr === 'string';
    if (
      candidate?.ok === false
      && candidate?.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
      && processId
      && Number.isInteger(status)
      && status !== 0
      && hasBoundedOutput
    ) {
      return candidate;
    }
    candidate = candidate.structuredContent;
  }
  return {};
}

function safeMaintenanceFailureProjection(value = {}, expectedAction = '') {
  const source = findFailedMaintenanceExecutionEnvelope(value);
  if (!source || Object.keys(source).length === 0) return null;
  const processId = text(source?.command?.plan?.processId);
  const status = Number(source?.structuredContent?.status);
  const errorCode = text(source?.structuredContent?.errorCode);
  const executionBlocker = text(source?.blocker);
  const safeToken = (candidate, max = 160) => (
    candidate.length <= max && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(candidate) ? candidate : ''
  );
  if (
    source?.ok !== false
    || source?.finalVerdict !== 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
    || processId !== text(expectedAction)
    || !Number.isInteger(status)
    || status === 0
  ) return null;
  return Object.freeze({
    processId,
    status,
    errorCode: safeToken(errorCode),
    executionBlocker: safeToken(executionBlocker),
  });
}

function safeStarfieldVrResourcePreflightProjection(value = {}) {
  const failureEnvelope = findFailedMaintenanceExecutionEnvelope(value);
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(failureEnvelope).length > 0
    ? failureEnvelope
    : (Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value);
  const structured = source?.structuredContent && typeof source.structuredContent === 'object'
    ? source.structuredContent
    : {};
  const status = Number(structured?.status);
  const stdout = String(structured?.stdout || '').trim();
  const stderr = String(structured?.stderr || '').trim();
  let parsed = null;
  try { parsed = stdout ? JSON.parse(stdout) : null; } catch {}

  const safeModels = (items) => Object.freeze(
    (Array.isArray(items) ? items : [])
      .map((item) => text(item))
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(item))
      .slice(0, 32),
  );
  const safeDiagnostic = (value) => String(value || '')
    .replace(/[A-Za-z]:\\Users\\[^\\\r\n]+/gi, '%USERPROFILE%')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)\b/g, '[redacted]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 480);

  if (!parsed || parsed.schemaVersion !== 'stephanos.vr-resource-governor.v1') {
    if (!Number.isInteger(status) || status === 0) return null;
    const diagnostic = safeDiagnostic(stderr || stdout);
    return Object.freeze({
      ok: false,
      finalVerdict: 'STARFIELD_VR_RESOURCE_PREFLIGHT_FAILED',
      blocker: /\bThe property\b/i.test(diagnostic)
        ? 'STARFIELD_VR_RESOURCE_PREFLIGHT_STRICTMODE_PROPERTY'
        : 'STARFIELD_VR_RESOURCE_PREFLIGHT_EXECUTION_FAILED',
      status,
      phase: '',
      active: false,
      reason: '',
      profileName: '',
      profileProcessName: '',
      parkAllModels: false,
      localModelAllowed: null,
      zeroLocalModelInvariant: false,
      evictionHealthy: false,
      loadedModelsBefore: Object.freeze([]),
      loadedModelsAfter: Object.freeze([]),
      reappearanceDetected: false,
      reappearanceCount: 0,
      diagnostic,
    });
  }

  const profile = parsed.profile && typeof parsed.profile === 'object' && !Array.isArray(parsed.profile)
    ? parsed.profile
    : {};
  const phase = text(parsed.phase);
  const loadedModelsAfter = safeModels(parsed.loadedModelsAfter);
  const invariantsGreen = parsed.active === true
    && profile.parkAllModels === true
    && parsed.localModelAllowed === false
    && parsed.zeroLocalModelInvariant === true
    && parsed.evictionHealthy === true
    && loadedModelsAfter.length === 0;
  const ok = Number.isInteger(status) && status === 0 && invariantsGreen;
  return Object.freeze({
    ok,
    finalVerdict: ok
      ? 'STARFIELD_VR_RESOURCE_PREFLIGHT_PASSED'
      : 'STARFIELD_VR_RESOURCE_PREFLIGHT_FAILED',
    blocker: ok ? '' : 'STARFIELD_VR_RESOURCE_PREFLIGHT_INVARIANT_FAILED',
    status: Number.isInteger(status) ? status : null,
    phase,
    active: parsed.active === true,
    reason: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(text(parsed.reason)) ? text(parsed.reason) : '',
    profileName: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(text(profile.name)) ? text(profile.name) : '',
    profileProcessName: /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/.test(text(profile.processName)) ? text(profile.processName) : '',
    parkAllModels: profile.parkAllModels === true,
    localModelAllowed: typeof parsed.localModelAllowed === 'boolean' ? parsed.localModelAllowed : null,
    zeroLocalModelInvariant: parsed.zeroLocalModelInvariant === true,
    evictionHealthy: parsed.evictionHealthy === true,
    loadedModelsBefore: safeModels(parsed.loadedModelsBefore),
    loadedModelsAfter,
    reappearanceDetected: parsed.reappearanceDetected === true,
    reappearanceCount: Number.isInteger(Number(parsed.reappearanceCount)) ? Number(parsed.reappearanceCount) : 0,
    diagnostic: '',
  });
}

function safeVrVirtualAirLinkAcceptanceProjection(value = {}) {
  const failureEnvelope = findFailedMaintenanceExecutionEnvelope(value);
  const executionEnvelope = findMaintenanceExecutionEnvelope(value);
  const source = Object.keys(failureEnvelope).length > 0
    ? failureEnvelope
    : (Object.keys(executionEnvelope).length > 0 ? executionEnvelope : value);
  const raw = text(source?.structuredContent?.stdout);
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!parsed || parsed.schemaVersion !== 'stephanos.vr-virtual-airlink-acceptance.v1') return null;
  const safeModels = (items) => Object.freeze(
    (Array.isArray(items) ? items : [])
      .map((item) => text(item))
      .filter((item) => /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/.test(item))
      .slice(0, 32),
  );
  const safeGpu = (gpu) => {
    if (!gpu || typeof gpu !== 'object' || Array.isArray(gpu)) return null;
    const integerOrNull = (value) => Number.isInteger(Number(value)) ? Number(value) : null;
    return Object.freeze({
      available: gpu.available === true,
      memoryUsedMiB: integerOrNull(gpu.memoryUsedMiB),
      memoryTotalMiB: integerOrNull(gpu.memoryTotalMiB),
      utilizationGpuPercent: integerOrNull(gpu.utilizationGpuPercent),
    });
  };
  const blocker = text(parsed.blocker);
  const finalVerdict = text(parsed.finalVerdict);
  if (!['SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_PASSED', 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED'].includes(finalVerdict)) return null;
  if (blocker && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(blocker)) return null;
  return Object.freeze({
    ok: parsed.ok === true,
    finalVerdict,
    blocker,
    virtualAirLinkTestUsed: parsed.virtualAirLinkTestUsed === true,
    virtualAirLinkRestoredOff: parsed.virtualAirLinkRestoredOff === true,
    launchAllowed: parsed.launchAllowed === true,
    realHeadsetProofClaimed: parsed.realHeadsetProofClaimed === true,
    governorWatchStarted: parsed.governorWatchStarted === true,
    governorWatchProcessCount: Number.isInteger(Number(parsed.governorWatchProcessCount)) ? Number(parsed.governorWatchProcessCount) : 0,
    lightweightModel: text(parsed.lightweightModel),
    loadedModelsBefore: safeModels(parsed.loadedModelsBefore),
    heavyModelsBefore: safeModels(parsed.heavyModelsBefore),
    heavyModelSamplesDuringGuard: safeModels(parsed.heavyModelSamplesDuringGuard),
    loadedModelsAfterGuard: safeModels(parsed.loadedModelsAfterGuard),
    heavyModelsAfterGuard: safeModels(parsed.heavyModelsAfterGuard),
    gpuBefore: safeGpu(parsed.gpuBefore),
    gpuAfter: safeGpu(parsed.gpuAfter),
    vramReleasedMiB: Number.isInteger(Number(parsed.vramReleasedMiB)) ? Number(parsed.vramReleasedMiB) : null,
    observationSeconds: Number.isInteger(Number(parsed.observationSeconds)) ? Number(parsed.observationSeconds) : 0,
  });
}

function safeCoreDaemonStatusProjection(value = {}) {
  const raw = text(value?.structuredContent?.stdout);
  let parsed = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch {}
  if (!parsed || parsed?.schemaVersion !== 'stephanos.core-daemon-status.v1') {
    return Object.freeze({ available: false });
  }
  const sourceHead = text(parsed.sourceHead).toLowerCase();
  const heartbeatAgeSeconds = Number(parsed.heartbeatAgeSeconds);
  return Object.freeze({
    available: true,
    ok: parsed.ok === true,
    daemonHealthy: parsed.daemonHealthy === true,
    readiness: /^[A-Z_]{1,40}$/.test(text(parsed.readiness)) ? text(parsed.readiness) : 'UNKNOWN',
    wakeState: /^[A-Z_]{1,40}$/.test(text(parsed.wakeState)) ? text(parsed.wakeState) : 'UNKNOWN',
    awake: parsed.awake === true,
    repairRequired: parsed.repairRequired === true,
    repairReason: /^[A-Z0-9_:-]{0,160}$/.test(text(parsed.repairReason)) ? text(parsed.repairReason) : '',
    controlPlaneFinalVerdict: /^[A-Z0-9_:-]{0,160}$/.test(text(parsed.controlPlaneFinalVerdict))
      ? text(parsed.controlPlaneFinalVerdict)
      : '',
    sourceHead: SHA_PATTERN.test(sourceHead) ? sourceHead : '',
    heartbeatAgeSeconds: Number.isFinite(heartbeatAgeSeconds) && heartbeatAgeSeconds >= 0 ? heartbeatAgeSeconds : null,
    sovereignCommanderHealthy: parsed.sovereignCommanderHealthy === true,
    backendHealthy: parsed.backendHealthy === true,
    missionWorkerHealthy: parsed.missionWorkerHealthy === true,
    gamingActive: parsed.gamingActive === true,
    uiRequired: false,
    sourceMutationAllowed: false,
    schedulerAuthority: false,
    mergeAuthority: false,
    vendorMeterRequired: false,
    remoteCommanderRequired: false,
  });
}

function safeProjectSearchProjection(value = {}, query = '') {
  const results = Array.isArray(value?.results) ? value.results : [];
  const safeResults = results.slice(0, 30).flatMap((entry) => {
    const relativePath = text(entry?.relativePath).replaceAll('\\', '/');
    const line = Number(entry?.line);
    const column = Number(entry?.column);
    if (!relativePath
      || relativePath.startsWith('/')
      || relativePath.includes('..')
      || /^[A-Za-z]:/.test(relativePath)
      || relativePath.length > 240
      || !Number.isSafeInteger(line) || line < 1
      || !Number.isSafeInteger(column) || column < 1) return [];
    return [Object.freeze({ relativePath, line, column })];
  });
  return Object.freeze({
    queryHash: createHash('sha256').update(String(query)).digest('hex'),
    resultCount: safeResults.length,
    truncated: value?.truncated === true || results.length > safeResults.length,
    results: Object.freeze(safeResults),
  });
}

function isBoundedCommanderConfig(config = {}) {
  return config?.implementation === 'stephanos-local-node'
    && config?.vendorMeterRequired === false
    && config?.externalSaasRelayRequired === false
    && config?.sourceControlledMaintenanceOnly === true
    && config?.arbitraryUnboundedCommandAllowed === false
    && config?.mergeAuthority === false
    && config?.pcRestartAuthority === false
    && config?.canRunFocusedNodeTests === false;
}

export function validateSovereignCommanderRemoteCommandShape(command = {}) {
  if (text(command?.operation) !== SOVEREIGN_COMMANDER_REMOTE_OPERATION) {
    return Object.freeze({ ok: true, requested: false });
  }
  const unexpectedField = Object.keys(command).find((field) => !ALLOWED_FIELDS.has(field));
  if (unexpectedField) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED', {
      requested: true,
      field: unexpectedField,
    });
  }
  const expectedHead = text(command?.expectedHead).toLowerCase();
  if (!SHA_PATTERN.test(expectedHead)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_EXPECTED_HEAD_REQUIRED', { requested: true });
  }
  const remoteAction = text(command?.remoteAction);
  const remotePlanFieldPresent = Object.prototype.hasOwnProperty.call(command || {}, 'remotePlan');
  const remotePlanSupplied = Array.isArray(command?.remotePlan);
  if (remotePlanFieldPresent && !remotePlanSupplied) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID', { requested: true });
  }
  if (remoteAction && remotePlanFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT', { requested: true });
  }
  if (remotePlanSupplied) {
    const remotePlan = command.remotePlan.map((value) => text(value));
    if (remotePlan.length < 1 || remotePlan.length > SOVEREIGN_COMMANDER_REMOTE_PLAN_MAX_STEPS) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID', {
        requested: true,
        stepCount: remotePlan.length,
      });
    }
    const invalidAction = remotePlan.find((actionId) => (
      actionId === 'status'
      || actionId === 'search-project'
      || actionId === 'battle-bridge-observe'
      || actionId === 'meter-status'
      || actionId === 'controller-lane-status'
      || actionId === 'publish-controller-activity'
      || actionId === 'preservation-converge-pr-branch'
      || !SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(actionId)
    ));
    if (invalidAction) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED', {
        requested: true,
        remoteAction: invalidAction,
      });
    }
    if (new Set(remotePlan).size !== remotePlan.length) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION', { requested: true });
    }
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({
        ...command,
        expectedHead,
        remoteAction: '',
        remotePlan: Object.freeze(remotePlan),
      }),
    });
  }
  if (!SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes(remoteAction)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED', {
      requested: true,
      remoteAction,
    });
  }
  const searchFieldPresent = Object.prototype.hasOwnProperty.call(command || {}, 'searchQuery')
    || Object.prototype.hasOwnProperty.call(command || {}, 'searchMaxResults');
  if (remoteAction === 'search-project') {
    const searchQuery = text(command?.searchQuery);
    const searchMaxResults = Number(command?.searchMaxResults ?? 20);
    if (!REMOTE_SEARCH_QUERY.test(searchQuery)) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_QUERY_INVALID', { requested: true });
    }
    if (!Number.isSafeInteger(searchMaxResults) || searchMaxResults < 1 || searchMaxResults > 30) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_LIMIT_INVALID', { requested: true });
    }
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({ ...command, expectedHead, remoteAction, searchQuery, searchMaxResults }),
    });
  }
  if (searchFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_FIELDS_NOT_ALLOWED', { requested: true });
  }
  const controllerActivityFieldPresent = Object.prototype.hasOwnProperty.call(command || {}, 'controllerActivity');
  const controllerActivityConflictingFields = ['targetPrNumber', 'targetBranch', 'targetHead']
    .some((field) => Object.prototype.hasOwnProperty.call(command || {}, field));
  if (remoteAction === 'publish-controller-activity') {
    if (controllerActivityConflictingFields) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_FIELDS_NOT_ALLOWED', { requested: true });
    }
    const validatedActivity = validateRemoteControllerActivity(command?.controllerActivity);
    if (!validatedActivity.ok) return validatedActivity;
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({
        ...command,
        expectedHead,
        remoteAction,
        controllerActivity: validatedActivity.controllerActivity,
      }),
    });
  }
  if (controllerActivityFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_FIELDS_NOT_ALLOWED', { requested: true });
  }

  const convergenceFieldPresent = ['targetPrNumber', 'targetBranch', 'targetHead']
    .some((field) => Object.prototype.hasOwnProperty.call(command || {}, field));
  if (remoteAction === 'preservation-converge-pr-branch') {
    const targetPrNumber = Number(command?.targetPrNumber);
    const targetBranch = text(command?.targetBranch);
    const targetHead = text(command?.targetHead).toLowerCase();
    const branchSafe = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/.test(targetBranch)
      && !targetBranch.includes('..')
      && !targetBranch.includes('//')
      && !targetBranch.endsWith('/')
      && !targetBranch.startsWith('refs/')
      && !['main', 'master'].includes(targetBranch.toLowerCase());
    if (!Number.isSafeInteger(targetPrNumber) || targetPrNumber < 1 || targetPrNumber > 999999999) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_TARGET_PR_INVALID', { requested: true });
    }
    if (!branchSafe) return fail('SOVEREIGN_COMMANDER_REMOTE_TARGET_BRANCH_INVALID', { requested: true });
    if (!SHA_PATTERN.test(targetHead) || targetHead === expectedHead) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_TARGET_HEAD_INVALID', { requested: true });
    }
    return Object.freeze({
      ok: true,
      requested: true,
      expectedHead,
      command: Object.freeze({
        ...command,
        expectedHead,
        remoteAction,
        targetPrNumber,
        targetBranch,
        targetHead,
      }),
    });
  }
  if (convergenceFieldPresent) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONVERGENCE_FIELDS_NOT_ALLOWED', { requested: true });
  }
  return Object.freeze({
    ok: true,
    requested: true,
    expectedHead,
    command: Object.freeze({ ...command, expectedHead, remoteAction }),
  });
}

export function isTerminalizableSovereignCommanderRemoteBlocker(value) {
  return new Set([
    'SOVEREIGN_COMMANDER_REMOTE_FIELD_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_EXPECTED_HEAD_REQUIRED',
    'SOVEREIGN_COMMANDER_REMOTE_ACTION_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_ACTION_PLAN_CONFLICT',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_TYPE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_SIZE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_ACTION_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_PLAN_DUPLICATE_ACTION',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_QUERY_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_LIMIT_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_SEARCH_FIELDS_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_TOO_LARGE',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_SCHEMA_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_CONTROLLER_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_RUN_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ENABLEMENT_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_STATE_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_ARRAY_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_COUNT_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_ACTIVITY_FIELDS_NOT_ALLOWED',
    'SOVEREIGN_COMMANDER_REMOTE_TARGET_PR_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_TARGET_BRANCH_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_TARGET_HEAD_INVALID',
    'SOVEREIGN_COMMANDER_REMOTE_CONVERGENCE_FIELDS_NOT_ALLOWED',
  ]).has(text(value));
}

export async function executeSovereignCommanderRemoteOnBattleBridge(command = {}, options = {}) {
  const shape = validateSovereignCommanderRemoteCommandShape(command);
  if (!shape.ok || !shape.requested) return shape;

  const env = options?.env || process.env;
  const repositoryRoot = fixedRepositoryRoot(env);
  const tokenPath = fixedTokenPath(env);
  const spawnSyncFn = typeof options?.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;
  const readFileFn = typeof options?.readFileFn === 'function' ? options.readFileFn : readFile;
  const fetchFn = typeof options?.fetchFn === 'function' ? options.fetchFn : globalThis.fetch;
  const networkTimeoutMs = boundedRemoteNetworkTimeoutMs(options?.networkTimeoutMs);

  const branch = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'branch', '--show-current']);
  const head = run(spawnSyncFn, GIT, ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  const observedBranch = text(branch.stdout);
  const observedHead = text(head.stdout).toLowerCase();
  if (!branch.ok || !head.ok) return fail('SOVEREIGN_COMMANDER_REMOTE_SOURCE_IDENTITY_UNAVAILABLE');
  if (observedBranch !== 'main') return fail('SOVEREIGN_COMMANDER_REMOTE_CANONICAL_BRANCH_REQUIRED', { observedBranch });
  if (observedHead !== shape.expectedHead) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_HEAD_MISMATCH', {
      expectedHead: shape.expectedHead,
      observedHead,
    });
  }

  let health;
  try {
    const exchange = await fetchTextWithDeadline(
      fetchFn,
      HEALTH_URL,
      { method: 'GET' },
      Math.min(networkTimeoutMs, 15_000),
    );
    let parsedHealth = null;
    try { parsedHealth = exchange.bodyText ? JSON.parse(exchange.bodyText) : null; } catch {}
    health = exchange.response.ok ? parsedHealth : null;
  } catch {
    health = null;
  }
  if (health?.ok !== true || health?.service !== 'stephanos-sovereign-commander') {
    return fail('SOVEREIGN_COMMANDER_REMOTE_HEALTH_REQUIRED');
  }

  let token = '';
  try { token = text(await readFileFn(tokenPath, 'utf8')); } catch {}
  if (token.length < 32) return fail('SOVEREIGN_COMMANDER_REMOTE_TOKEN_UNAVAILABLE');
  const callMcp = (message, sessionId = '') => postMcp(fetchFn, token, message, sessionId, networkTimeoutMs);

  const initialize = await callMcp({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: 'battle-bridge-mobile-ingress', version: '1.0.0' },
      capabilities: {},
    },
  });
  const sessionId = initialize.sessionId;
  if (!initialize.ok || !sessionId) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MCP_INITIALIZE_FAILED', { status: initialize.status });
  }

  const initialized = await callMcp({
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, sessionId);
  if (!initialized.ok) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MCP_INITIALIZED_FAILED', { status: initialized.status });
  }

  const listed = await callMcp({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  }, sessionId);
  const tools = Array.isArray(listed.body?.result?.tools)
    ? listed.body.result.tools.map((tool) => text(tool?.name))
    : [];
  if (!listed.ok
    || !tools.includes('get_config')
    || !tools.includes('maintenance_action')
    || (shape.command.remoteAction === 'search-project' && !tools.includes('search_project'))) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_TOOL_SURFACE_INVALID');
  }

  const configCall = await callMcp({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'get_config', arguments: {} },
  }, sessionId);
  const config = mcpStructuredPayload(configCall);
  if (!configCall.ok || !isBoundedCommanderConfig(config)) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_CONFIG_POSTURE_INVALID');
  }

  if (shape.command.remoteAction === 'status') {
    const statusResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STATUS_COMPLETE',
      remoteAction: 'status',
      sourceHead: shape.expectedHead,
      healthReady: true,
      authenticatedMcpReady: true,
      implementation: 'stephanos-local-node',
      sourceControlledMaintenanceOnly: true,
      arbitraryUnboundedCommandAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...statusResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: statusResult,
    });
  }

  if (shape.command.remoteAction === 'search-project') {
    const searchCall = await callMcp({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'search_project',
        arguments: {
          query: shape.command.searchQuery,
          maxResults: shape.command.searchMaxResults,
        },
      },
    }, sessionId);
    const completion = sovereignCommanderCompletionEnvelope(searchCall);
    const rawSearch = completion?.structuredContent;
    if (!searchCall.ok
      || completion?.ok !== true
      || completion?.finalVerdict !== 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      || !PROOF_HASH_PATTERN.test(text(completion?.proofHash))) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_SEARCH_FAILED', {
        status: searchCall.status,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const projection = safeProjectSearchProjection(rawSearch, shape.command.searchQuery);
    const searchResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PROJECT_SEARCH_COMPLETE',
      remoteAction: 'search-project',
      sourceHead: shape.expectedHead,
      proofHash: text(completion.proofHash).toLowerCase(),
      queryHash: projection.queryHash,
      resultCount: projection.resultCount,
      truncated: projection.truncated,
      results: projection.results,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
      fileContentsReturned: false,
    });
    return Object.freeze({
      ...searchResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: searchResult,
    });
  }

  if (Array.isArray(shape.command.remotePlan)) {
    const completedSteps = [];
    for (let index = 0; index < shape.command.remotePlan.length; index += 1) {
      const actionId = shape.command.remotePlan[index];
      const actionCall = await callMcp({
        jsonrpc: '2.0',
        id: 4 + index,
        method: 'tools/call',
        params: {
          name: 'maintenance_action',
          arguments: { actionId },
        },
      }, sessionId);
      if (!actionCall.ok) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          status: actionCall.status,
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      const boundedFailure = safeMaintenanceFailureProjection(
        actionCall.body?.result?.structuredContent,
        actionId,
      );
      if (boundedFailure) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_STEP_FAILED', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          status: boundedFailure.status,
          processId: boundedFailure.processId,
          errorCode: boundedFailure.errorCode,
          executionBlocker: boundedFailure.executionBlocker,
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      const projection = safeMaintenanceProjection(sovereignCommanderCompletionEnvelope(actionCall));
      const runtimeProofRequired = ['prove-vr-atlas-runtime', 'prove-flywheel-runtime'].includes(actionId);
      const runtimeProofComplete = !runtimeProofRequired
        || runtimeProofCompleteForAction(actionId, projection.runtimeProof, shape.expectedHead);
      const proofComplete = projection.ok === true
        && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
        && PROOF_HASH_PATTERN.test(projection.proofHash)
        && projection.processId === actionId
        && projection.status === 0
        && runtimeProofComplete;
      if (!proofComplete) {
        return fail('SOVEREIGN_COMMANDER_REMOTE_PLAN_RECEIPT_INVALID', {
          stepIndex: index,
          remoteAction: actionId,
          remotePlan: shape.command.remotePlan,
          stepCount: completedSteps.length,
          proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
          processIdMatch: projection.processId === actionId,
          successfulStatus: projection.status === 0,
          runtimeProof: projection.runtimeProof,
          completedSteps: Object.freeze(completedSteps),
          publicReceiptSafe: true,
          secretMaterialReturned: false,
        });
      }
      completedSteps.push(Object.freeze({
        stepIndex: index,
        remoteAction: actionId,
        proofHash: projection.proofHash,
        processId: projection.processId,
        status: projection.status,
        errorCode: projection.errorCode,
        runtimeProof: projection.runtimeProof,
      }));
    }

    const planProofHash = createHash('sha256').update(JSON.stringify({
      requestId: text(shape.command.requestId),
      sourceHead: shape.expectedHead,
      remotePlan: shape.command.remotePlan,
      completedSteps: completedSteps.map((step) => ({
        stepIndex: step.stepIndex,
        remoteAction: step.remoteAction,
        proofHash: step.proofHash,
        processId: step.processId,
        status: step.status,
      })),
    })).digest('hex');
    const planResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PLAN_COMPLETE',
      remotePlan: shape.command.remotePlan,
      stepCount: completedSteps.length,
      completedSteps: Object.freeze(completedSteps),
      planProofHash,
      sourceHead: shape.expectedHead,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...planResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: planResult,
    });
  }

  const actionCall = await callMcp({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'maintenance_action',
      arguments: shape.command.remoteAction === 'preservation-converge-pr-branch'
        ? {
          actionId: shape.command.remoteAction,
          targetPrNumber: shape.command.targetPrNumber,
          targetBranch: shape.command.targetBranch,
          targetHead: shape.command.targetHead,
          expectedMain: shape.expectedHead,
        }
        : shape.command.remoteAction === 'publish-controller-activity'
          ? {
            actionId: shape.command.remoteAction,
            controllerActivityPayloadBase64: Buffer.from(
              JSON.stringify(shape.command.controllerActivity),
              'utf8',
            ).toString('base64url'),
          }
          : { actionId: shape.command.remoteAction },
    },
  }, sessionId);
  if (!actionCall.ok) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED', { status: actionCall.status });
  }
  const dedicatedBoundedFailureAction = ['vr-virtual-airlink-acceptance', 'starfield-vr-resource-preflight']
    .includes(shape.command.remoteAction);
  const boundedFailure = dedicatedBoundedFailureAction
    ? null
    : safeMaintenanceFailureProjection(actionCall.body?.result?.structuredContent, shape.command.remoteAction);
  if (boundedFailure) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_FAILED', {
      remoteAction: shape.command.remoteAction,
      status: boundedFailure.status,
      processId: boundedFailure.processId,
      errorCode: boundedFailure.errorCode,
      executionBlocker: boundedFailure.executionBlocker,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
  }
  const rawMaintenance = dedicatedBoundedFailureAction
    ? (actionCall.body?.result?.structuredContent || {})
    : sovereignCommanderCompletionEnvelope(actionCall);
  const projection = safeMaintenanceProjection(rawMaintenance);
  const coreDaemonStatus = shape.command.remoteAction === 'status-stephanos-core-daemon'
    ? safeCoreDaemonStatusProjection(rawMaintenance)
    : null;

  if (shape.command.remoteAction === 'status-stephanos-core-daemon') {
    const coreHealthy = coreDaemonStatus?.available === true
      && coreDaemonStatus?.ok === true
      && coreDaemonStatus?.daemonHealthy === true
      && Number.isFinite(coreDaemonStatus?.heartbeatAgeSeconds)
      && coreDaemonStatus.heartbeatAgeSeconds <= 60
      && coreDaemonStatus.sourceHead === shape.expectedHead
      && coreDaemonStatus.readiness !== 'RELOAD_REQUIRED';
    if (!coreHealthy) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CORE_DAEMON_NOT_READY', {
        remoteAction: shape.command.remoteAction,
        sourceHead: shape.expectedHead,
        coreDaemonStatus,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
  }

  if (shape.command.remoteAction === 'preservation-converge-pr-branch') {
    const preservationConvergence = safePreservationConvergenceProjection(rawMaintenance, shape.command);
    if (!preservationConvergence) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_PRESERVATION_CONVERGENCE_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        targetPrNumber: shape.command.targetPrNumber,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const convergenceResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_PRESERVATION_CONVERGENCE_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: preservationConvergence.proofHash,
      preservationConvergence,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...convergenceResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: convergenceResult,
    });
  }

  if (shape.command.remoteAction === 'visibility-snapshot') {
    const visibilitySnapshot = safeVisibilitySnapshotProjection(rawMaintenance, projection.processId);
    const visibilityProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && visibilitySnapshot
      && visibilitySnapshot.readOnly === true
      && visibilitySnapshot.sourceMutationAllowed === false
      && visibilitySnapshot.arbitraryShellAllowed === false
      && visibilitySnapshot.arbitraryProcessInspectionAllowed === false
      && visibilitySnapshot.rawLogsReturned === false
      && visibilitySnapshot.rawPathsReturned === false
      && visibilitySnapshot.secretMaterialIncluded === false
      && visibilitySnapshot.mergeAuthority === false
      && visibilitySnapshot.pcRestartAuthority === false
      && visibilitySnapshot.remoteCommanderRequired === false
      && visibilitySnapshot.unknownMeansGreen === false;
    if (!visibilityProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_VISIBILITY_SNAPSHOT_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const visibilityResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_VISIBILITY_SNAPSHOT_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      visibilitySnapshot,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...visibilityResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: visibilityResult,
    });
  }

  if (shape.command.remoteAction === 'battle-bridge-observe') {
    const observation = safeBattleBridgeObservationProjection(rawMaintenance, projection.processId);
    const observationProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && observation
      && observation.readOnly === true
      && observation.arbitraryShellAllowed === false
      && observation.secretMaterialIncluded === false;
    if (!observationProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_OBSERVATION_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const observationResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_BATTLE_BRIDGE_OBSERVATION_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      observation,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...observationResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: observationResult,
    });
  }

  if (shape.command.remoteAction === 'meter-status') {
    const meterStatus = safeMeterStatusProjection(rawMaintenance, projection.processId);
    const meterProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && meterStatus
      && meterStatus.readOnly === true
      && meterStatus.arbitraryShellAllowed === false
      && meterStatus.secretMaterialIncluded === false
      && meterStatus.unknownMeansGreen === false;
    if (!meterProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_METER_STATUS_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const meterResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_METER_STATUS_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      meterStatus,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...meterResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: meterResult,
    });
  }

  if (shape.command.remoteAction === 'controller-lane-status') {
    const controllerLaneStatus = safeControllerLaneStatusProjection(rawMaintenance, projection.processId);
    const statusProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && controllerLaneStatus
      && controllerLaneStatus.readOnly === true
      && controllerLaneStatus.arbitraryShellAllowed === false
      && controllerLaneStatus.sourceMutationAllowed === false
      && controllerLaneStatus.mergeAuthority === false
      && controllerLaneStatus.secretMaterialIncluded === false
      && controllerLaneStatus.unknownMeansGreen === false;
    if (!statusProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const controllerLaneResult = Object.freeze({
      ok: true,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_CONTROLLER_LANE_STATUS_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      controllerLaneStatus,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...controllerLaneResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: controllerLaneResult,
    });
  }

  if (['report-starfield-vr-telemetry', 'starfield-vr-telemetry-refresh'].includes(shape.command.remoteAction)) {
    const telemetry = safeStarfieldVrTelemetryProjection(rawMaintenance, projection.processId);
    const telemetryProofComplete = projection.ok === true
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && telemetry
      && telemetry.primaryTelemetryPublished === true
      && telemetry.rawTelemetryReturned === false
      && telemetry.hostPathsReturned === false
      && telemetry.secretMaterialReturned === false;
    if (!telemetryProofComplete) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
        processIdMatch: projection.processId === shape.command.remoteAction,
        successfulStatus: projection.status === 0,
        telemetryProjectionPresent: Boolean(telemetry),
        publicReceiptSafe: true,
        secretMaterialReturned: false,
      });
    }
    const telemetryResult = Object.freeze({
      ok: true,
      finalVerdict: telemetry.degraded
        ? 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_DEGRADED'
        : 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_TELEMETRY_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: projection.proofHash,
      processId: projection.processId,
      status: projection.status,
      telemetry,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...telemetryResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: telemetryResult,
    });
  }

  if (shape.command.remoteAction === 'starfield-vr-resource-preflight') {
    const preflight = safeStarfieldVrResourcePreflightProjection(rawMaintenance);
    const successReceiptProven = preflight?.ok === true
      && PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED';
    const failureEnvelope = findFailedMaintenanceExecutionEnvelope(rawMaintenance);
    const failedProcessId = text(failureEnvelope?.command?.plan?.processId);
    const failedStatus = Number(failureEnvelope?.structuredContent?.status);
    const boundedFailureProven = preflight?.ok === false
      && failureEnvelope?.ok === false
      && failureEnvelope?.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
      && failedProcessId === shape.command.remoteAction
      && Number.isInteger(failedStatus)
      && failedStatus !== 0;
    const boundedFailureProofHash = boundedFailureProven
      ? createHash('sha256').update(JSON.stringify({
        expectedHead: shape.expectedHead,
        remoteAction: shape.command.remoteAction,
        processId: failedProcessId,
        status: failedStatus,
        preflight,
      })).digest('hex')
      : '';
    const receiptProven = successReceiptProven
      || (boundedFailureProven && PROOF_HASH_PATTERN.test(boundedFailureProofHash));
    const effectiveProofHash = successReceiptProven ? projection.proofHash : boundedFailureProofHash;
    const effectiveProcessId = successReceiptProven ? projection.processId : failedProcessId;
    const effectiveStatus = successReceiptProven ? projection.status : failedStatus;
    if (!receiptProven || !preflight) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_PREFLIGHT_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(effectiveProofHash),
        processIdMatch: effectiveProcessId === shape.command.remoteAction,
        boundedStatus: Number.isInteger(effectiveStatus),
      });
    }
    const preflightResult = Object.freeze({
      ok: true,
      preflightPassed: preflight.ok,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_PREFLIGHT_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: effectiveProofHash,
      processId: effectiveProcessId,
      status: effectiveStatus,
      preflight,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...preflightResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: preflightResult,
    });
  }

  if (shape.command.remoteAction === 'vr-virtual-airlink-acceptance') {
    const acceptance = safeVrVirtualAirLinkAcceptanceProjection(rawMaintenance);
    const successReceiptProven = PROOF_HASH_PATTERN.test(projection.proofHash)
      && projection.processId === shape.command.remoteAction
      && projection.status === 0
      && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED';
    const failureEnvelope = findFailedMaintenanceExecutionEnvelope(rawMaintenance);
    const failedProcessId = text(failureEnvelope?.command?.plan?.processId);
    const failedStatus = Number(failureEnvelope?.structuredContent?.status);
    const boundedFailureProven = acceptance?.ok === false
      && acceptance.finalVerdict === 'SOVEREIGN_COMMANDER_VIRTUAL_AIR_LINK_ACCEPTANCE_FAILED'
      && failureEnvelope?.ok === false
      && failureEnvelope?.finalVerdict === 'SOVEREIGN_COMMANDER_EXECUTION_FAILED'
      && failedProcessId === shape.command.remoteAction
      && failedStatus === 2;
    const boundedFailureProofHash = boundedFailureProven
      ? createHash('sha256').update(JSON.stringify({
        expectedHead: shape.expectedHead,
        remoteAction: shape.command.remoteAction,
        processId: failedProcessId,
        status: failedStatus,
        acceptance,
      })).digest('hex')
      : '';
    const receiptProven = successReceiptProven
      || (boundedFailureProven && PROOF_HASH_PATTERN.test(boundedFailureProofHash));
    const effectiveProofHash = successReceiptProven ? projection.proofHash : boundedFailureProofHash;
    const effectiveProcessId = successReceiptProven ? projection.processId : failedProcessId;
    const effectiveStatus = successReceiptProven ? projection.status : failedStatus;
    if (!receiptProven || !acceptance) {
      return fail('SOVEREIGN_COMMANDER_REMOTE_VR_ACCEPTANCE_RECEIPT_INVALID', {
        remoteAction: shape.command.remoteAction,
        proofHashPresent: PROOF_HASH_PATTERN.test(effectiveProofHash),
        processIdMatch: effectiveProcessId === shape.command.remoteAction,
        boundedStatus: [0, 2].includes(effectiveStatus),
      });
    }
    const acceptanceResult = Object.freeze({
      ok: true,
      acceptancePassed: acceptance.ok,
      finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_VR_ACCEPTANCE_COMPLETE',
      remoteAction: shape.command.remoteAction,
      sourceHead: shape.expectedHead,
      proofHash: effectiveProofHash,
      processId: effectiveProcessId,
      status: effectiveStatus,
      acceptance,
      vendorMeterRequired: false,
      externalSaasRelayRequired: false,
      arbitraryShellAllowed: false,
      mergeAuthority: false,
      pcRestartAuthority: false,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
    return Object.freeze({
      ...acceptanceResult,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
      requestId: text(shape.command.requestId),
      result: acceptanceResult,
    });
  }

  const runtimeProofRequired = ['prove-vr-atlas-runtime', 'prove-flywheel-runtime'].includes(shape.command.remoteAction);
  const runtimeProofComplete = !runtimeProofRequired
    || runtimeProofCompleteForAction(shape.command.remoteAction, projection.runtimeProof, shape.expectedHead);
  const observationRequired = shape.command.remoteAction === 'battle-bridge-observe';
  const observationComplete = !observationRequired || (
    projection.observation?.ok === true
    && projection.observation?.schemaVersion === 'stephanos.battle-bridge-observation.v1'
    && projection.observation?.hostRole === 'battle-bridge'
    && projection.observation?.readOnly === true
    && projection.observation?.arbitraryShellAllowed === false
    && projection.observation?.secretMaterialIncluded === false
    && projection.observation?.finalVerdict === 'BATTLE_BRIDGE_OBSERVATION_READY'
  );
  const proofComplete = projection.ok === true
    && projection.finalVerdict === 'SOVEREIGN_COMMANDER_COMMAND_COMPLETED'
    && PROOF_HASH_PATTERN.test(projection.proofHash)
    && projection.processId === shape.command.remoteAction
    && projection.status === 0
    && runtimeProofComplete
    && observationComplete;
  if (!proofComplete) {
    return fail('SOVEREIGN_COMMANDER_REMOTE_RECEIPT_INVALID', {
      remoteAction: shape.command.remoteAction,
      proofHashPresent: PROOF_HASH_PATTERN.test(projection.proofHash),
      processIdMatch: projection.processId === shape.command.remoteAction,
      successfulStatus: projection.status === 0,
      runtimeProof: projection.runtimeProof,
      observation: projection.observation,
      publicReceiptSafe: true,
      secretMaterialReturned: false,
    });
  }

  const maintenanceResult = Object.freeze({
    ok: true,
    finalVerdict: 'SOVEREIGN_COMMANDER_REMOTE_MAINTENANCE_COMPLETE',
    remoteAction: shape.command.remoteAction,
    sourceHead: shape.expectedHead,
    proofHash: projection.proofHash,
    processId: projection.processId,
    status: projection.status,
    errorCode: projection.errorCode,
    runtimeProof: projection.runtimeProof,
    observation: projection.observation,
    meterStatus: projection.meterStatus,
    controllerLaneStatus: projection.controllerLaneStatus,
    controllerActivityPublication: projection.controllerActivityPublication,
    capabilityParity: projection.capabilityParity,
    ...(coreDaemonStatus ? { coreDaemonStatus } : {}),
    vendorMeterRequired: false,
    externalSaasRelayRequired: false,
    arbitraryShellAllowed: false,
    mergeAuthority: false,
    pcRestartAuthority: false,
    publicReceiptSafe: true,
    secretMaterialReturned: false,
  });
  return Object.freeze({
    ...maintenanceResult,
    verdict: 'COMMAND_EXECUTION_COMPLETE',
    operation: SOVEREIGN_COMMANDER_REMOTE_OPERATION,
    requestId: text(shape.command.requestId),
    maintenance: projection,
    result: maintenanceResult,
  });
}
