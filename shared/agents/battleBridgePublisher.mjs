import {
  createAgentCapabilityRecord,
  createSharedWorkspaceEventRecord,
  createSharedWorkspaceProofRecord,
  createSharedWorkspaceStatusRecord,
  ensureSharedWorkspaceLayout,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { createVerifierResult, aggregateVerificationResults, VERIFICATION_STATUS } from './verificationHarness.mjs';

export const BATTLE_BRIDGE_PUBLISHER_SCHEMA_VERSION = 'battle-bridge-publisher.v1';
export const BATTLE_BRIDGE_PUBLISHER_RECORD_KIND = 'stephanos.battle_bridge.publisher.slice';

export const BATTLE_BRIDGE_PUBLISHER_SERVICES = Object.freeze([
  'backend',
  'battle-bridge-supervisor',
  'mission-worker',
  'openclaw-gateway',
]);

export const BATTLE_BRIDGE_SERVICE_STATUS = Object.freeze({
  READY: 'READY',
  DEGRADED: 'DEGRADED',
  UNKNOWN: 'UNKNOWN',
  STALE: 'STALE',
});

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,120}$/i;
const SAFE_TEXT_PATTERN = /^[a-z0-9][a-z0-9._:/#() -]{0,240}$/i;
const FORBIDDEN_TEXT_PATTERN = /token|secret|password|credential|private key|\.env|session/i;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const out = String(value).trim();
  return out || fallback;
}

function safeText(value, fallback = '') {
  const out = text(value, fallback);
  if (!out || FORBIDDEN_TEXT_PATTERN.test(out)) return fallback;
  return SAFE_TEXT_PATTERN.test(out) ? out : fallback;
}

function safeId(value, fallback) {
  const out = text(value, fallback).toLowerCase();
  return SAFE_ID_PATTERN.test(out) ? out : fallback;
}

function normalizeServiceId(value) {
  const id = safeId(value, 'backend');
  return BATTLE_BRIDGE_PUBLISHER_SERVICES.includes(id) ? id : 'backend';
}

function normalizeStatus(value) {
  const status = text(value, BATTLE_BRIDGE_SERVICE_STATUS.UNKNOWN).toUpperCase();
  return Object.values(BATTLE_BRIDGE_SERVICE_STATUS).includes(status) ? status : BATTLE_BRIDGE_SERVICE_STATUS.UNKNOWN;
}

function exactNextActionFor(serviceId, status, action) {
  const supplied = safeText(action, '');
  if (supplied) return supplied;
  if (status === BATTLE_BRIDGE_SERVICE_STATUS.READY) return 'Continue polling the live Shared Agent Workspace feed.';
  return `Check ${serviceId} with the Battle Bridge local proof commands and publish a fresh status record.`;
}

export function buildBattleBridgePublisherContract() {
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_PUBLISHER_SCHEMA_VERSION,
    contractKind: 'stephanos.battle_bridge.publisher.contract',
    services: [...BATTLE_BRIDGE_PUBLISHER_SERVICES],
    statusValues: Object.values(BATTLE_BRIDGE_SERVICE_STATUS),
    sharedWorkspaceWriter: 'publishBattleBridgeSliceToSharedWorkspace',
    workspaceRoutes: {
      status: 'status/battle-bridge-current.json',
      proof: 'proof/battle-bridge-current.json',
      capabilities: 'capabilities/openclaw.json',
      event: 'events/battle-bridge-current.json',
    },
    guardrails: {
      arbitraryShellAllowed: false,
      processKillingAllowed: false,
      restartImplementationAllowed: false,
      secretDumpingAllowed: false,
      dashboardWritesAllowed: false,
      repoMutationAllowedFromRuntime: false,
      fakeLiveProofAllowed: false,
      sharedWorkspaceStoreHelpersOnly: true,
    },
    finalVerdict: 'BATTLE_BRIDGE_PUBLISHER_CONTRACT_READY',
  });
}

export function createBattleBridgeServicePublication(input = {}) {
  const serviceId = normalizeServiceId(input.serviceId);
  const status = normalizeStatus(input.status);
  const timestampUtc = safeText(input.timestampUtc || input.checkedAtUtc || input.publishedAtUtc, 'pending');
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_PUBLISHER_SCHEMA_VERSION,
    kind: 'stephanos.battle_bridge.publisher.service_status',
    serviceId,
    status,
    timestampUtc,
    summary: safeText(input.summary, `${serviceId} status is ${status}.`),
    reachable: input.reachable === true,
    usable: input.usable === true,
    browserCompatible: input.browserCompatible === true,
    proofRefs: Array.isArray(input.proofRefs) ? input.proofRefs.map(String).filter((ref) => ref.startsWith('proof/')) : [],
    exactNextAction: exactNextActionFor(serviceId, status, input.exactNextAction),
  });
}

export function createBattleBridgePublisherSlice(input = {}) {
  const timestampUtc = safeText(input.timestampUtc, new Date(0).toISOString());
  const publications = BATTLE_BRIDGE_PUBLISHER_SERVICES.map((serviceId) => createBattleBridgeServicePublication({
    serviceId,
    timestampUtc,
    status: 'UNKNOWN',
    summary: `${serviceId} has not published a current Battle Bridge record.`,
    exactNextAction: `Run the local Battle Bridge proof command for ${serviceId} and republish.`,
    ...(input.services?.[serviceId] || {}),
  }));
  const blocked = publications.filter((item) => item.status !== BATTLE_BRIDGE_SERVICE_STATUS.READY);
  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_PUBLISHER_SCHEMA_VERSION,
    kind: BATTLE_BRIDGE_PUBLISHER_RECORD_KIND,
    recordId: safeId(input.recordId, 'battle-bridge-current'),
    timestampUtc,
    services: publications,
    status: blocked.length === 0 ? 'READY' : 'UNKNOWN',
    summary: blocked.length === 0 ? 'Battle Bridge publishers are current.' : `Battle Bridge has ${blocked.length} unknown or stale publisher(s).`,
    exactNextAction: blocked[0]?.exactNextAction || 'Continue polling the live Shared Agent Workspace feed.',
    proofRefs: [...new Set(publications.flatMap((item) => item.proofRefs))],
    finalVerdict: blocked.length === 0 ? 'BATTLE_BRIDGE_PUBLISHER_READY' : 'BATTLE_BRIDGE_PUBLISHER_UNKNOWN',
  });
}

export function createBattleBridgePublisherWorkspaceRecords(slice = {}) {
  const timestampUtc = safeText(slice.timestampUtc, 'pending');
  const proofRefs = slice.proofRefs?.length ? slice.proofRefs : ['proof/battle-bridge-current.json'];
  const statusRecord = createSharedWorkspaceStatusRecord({
    statusId: 'battle-bridge-current',
    timestampUtc,
    status: slice.status || 'UNKNOWN',
    summary: slice.summary || 'Battle Bridge publisher status unavailable.',
    proofRefs,
  });
  const proofRecord = createSharedWorkspaceProofRecord({
    proofId: 'battle-bridge-current',
    timestampUtc,
    status: slice.status || 'UNKNOWN',
    summary: slice.exactNextAction || 'Battle Bridge publisher proof requires refresh.',
    correlationId: slice.correlationId || 'battle-bridge-current',
    relatedIssue: slice.relatedIssue || '#1287',
    proofRefs,
    refs: proofRefs,
  });
  const eventRecord = createSharedWorkspaceEventRecord({
    eventId: 'battle-bridge-current',
    timestampUtc,
    eventKind: 'health-check-result',
    summary: slice.summary || 'Battle Bridge current status published.',
  });
  const capabilityRecord = createAgentCapabilityRecord({
    agentId: 'openclaw',
    timestampUtc,
    proofRefs,
  });
  return Object.freeze({ statusRecord, proofRecord, eventRecord, capabilityRecord });
}

export function verifyBattleBridgePublisherSlice(slice = {}, options = {}) {
  const records = createBattleBridgePublisherWorkspaceRecords(slice);
  const checks = Object.entries(records).map(([name, record]) => {
    const validation = validateSharedWorkspaceRecord(record, options);
    return createVerifierResult({
      checkId: `battle-bridge-${name}`,
      verifierType: 'WorkspaceRecordVerifier',
      status: validation.valid ? VERIFICATION_STATUS.PASS : VERIFICATION_STATUS.BLOCKED,
      target: 'shared-agent-workspace',
      evidence: [`record=${name}`, `valid=${validation.valid}`, `errors=${validation.errors.join('|') || 'none'}`],
      reason: validation.valid ? '' : validation.errors[0],
      timestampUtc: options.timestampUtc || slice.timestampUtc || 'pending',
      finalVerdict: validation.valid ? 'BATTLE_BRIDGE_PUBLISHER_RECORD_PASS' : 'BATTLE_BRIDGE_PUBLISHER_RECORD_BLOCKED',
      proofRefs: record.proofRefs || record.refs || [],
    });
  });
  return aggregateVerificationResults({ aggregateId: 'battle-bridge-publisher', checks, timestampUtc: options.timestampUtc || slice.timestampUtc || 'pending' });
}

export async function publishBattleBridgeSliceToSharedWorkspace(root, sliceInput = {}, options = {}) {
  const slice = sliceInput?.kind === BATTLE_BRIDGE_PUBLISHER_RECORD_KIND
    ? sliceInput
    : createBattleBridgePublisherSlice(sliceInput);
  const verification = verifyBattleBridgePublisherSlice(slice, options);
  if (verification.status === VERIFICATION_STATUS.FAIL || verification.status === VERIFICATION_STATUS.BLOCKED) {
    return { ok: false, reason: verification.reason || 'BATTLE_BRIDGE_PUBLISHER_VERIFICATION_BLOCKED', slice, verification };
  }
  const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: options.repoRoot });
  if (!layout.ok) return { ok: false, reason: layout.reason, slice, verification };
  const records = createBattleBridgePublisherWorkspaceRecords(slice);
  const writes = [];
  writes.push(await writeAtomicJson(layout.root, ['status', 'battle-bridge-current.json'], records.statusRecord, options));
  writes.push(await writeAtomicJson(layout.root, ['proof', 'battle-bridge-current.json'], records.proofRecord, options));
  writes.push(await writeAtomicJson(layout.root, ['capabilities', 'openclaw.json'], records.capabilityRecord, options));
  writes.push(await writeAtomicJson(layout.root, ['events', 'battle-bridge-current.json'], records.eventRecord, options));
  const failed = writes.find((write) => !write.ok);
  if (failed) return { ok: false, reason: failed.reason, slice, verification, records, writes };
  return { ok: true, reason: 'BATTLE_BRIDGE_PUBLISHER_SLICE_WRITTEN', slice, verification, records, writes };
}

export function createBackendStatusPublication(input = {}) {
  return createBattleBridgeServicePublication({ serviceId: 'backend', ...input });
}

export function createSupervisorHealthPublication(input = {}) {
  return createBattleBridgeServicePublication({ serviceId: 'battle-bridge-supervisor', ...input });
}

export function createMissionWorkerHeartbeatPublication(input = {}) {
  return createBattleBridgeServicePublication({ serviceId: 'mission-worker', summary: input.summary || 'Mission Worker heartbeat published.', ...input });
}

export function createOpenClawGatewayStatusPublication(input = {}) {
  return createBattleBridgeServicePublication({ serviceId: 'openclaw-gateway', ...input });
}
