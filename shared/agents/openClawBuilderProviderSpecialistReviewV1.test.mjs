import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewV1,
} from './openClawBuilderProviderSpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const OC1_HEAD = '46abde391adf7dd138d0f70f63c284133baaa3d4';
const OC1_BASE = 'a564e318541d75854ed7bf675baf9b4dc52fedaf';
const POOL_HEAD = '341c4e4e1b4a2d02438149940f70275848c6ac74';
const POOL_BASE = '74bf1e3ae769f0fc3c0ed9e4eeee61b408788b16';
const PR1999_HEAD = 'bcdd92c388e36c785adeabeb533e79a751637758';
const PR1999_BASE = '7e8e20a036b5ae114670c9346dcab9594958cc9a';

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function oc1ContentFor(path) {
  if (path.endsWith('/index.js')) return `
api.registerGatewayMethod(
executeOpenClawOc1GatewayRequest
executingInsideOpenClawGateway: true
pluginId: 'stephanos-builder-provider'
providerInstance: \`openclaw-gateway:\${process.pid}\`
{ scope: 'operator.write' }
requireAuth: true
QUALIFICATION_ELIGIBLE=false
PRODUCTION_ELIGIBLE=false
SOURCE_MUTATION=false
`;
  if (path.endsWith('/lib/oc1-gateway-provider.mjs')) return `
export const OPENCLAW_OC1_GATEWAY_METHOD = 'stephanos-builder-provider.oc1Qualification';
const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);
const CANONICAL_REPOSITORY = 'Cheekyfellastef/stephan-os';
grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
grant?.boundedActionCount !== 1
grant?.mergeAuthority !== false
grant?.leaseSeizureAllowed !== false
text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'
FULL_SHA.test(text(grant?.sourceRevision).toLowerCase())
path.resolve(queueRoot, 'openclaw-readonly', 'processing')
item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
text(item?.missionId).toLowerCase() !== missionId
text(item?.actionId).toLowerCase() !== taskId
executeClaimedOpenClawOc1RepositoryScout
executionSurface: 'openclaw-gateway-plugin'
providerVersion: OPENCLAW_OC1_PROVIDER_VERSION
executingInsideOpenClawGateway === true pluginId === 'stephanos-builder-provider' method === OPENCLAW_OC1_GATEWAY_METHOD
schemaVersion: OPENCLAW_OC1_GATEWAY_RESULT_SCHEMA qualificationEligible: false
`;
  if (path.endsWith('/lib/oc1-repository-scout.mjs')) return `
export const OPENCLAW_OC1_TASK_CLASS = 'OC1_REPOSITORY_SCOUT';
export const OPENCLAW_OC1_PROVIDER = 'openclaw-standalone';
export const OPENCLAW_OC1_PROVIDER_VERSION = '1.0.0';
export const OPENCLAW_OC1_ISSUE = 1725;
const CANONICAL_BRANCH = 'main';
spawnSyncFn(BATTLE_BRIDGE_WINDOWS_HOST.git, args
shell: false
windowsHide: true
timeout: 15_000
grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
grant?.mergeAuthority !== false
grant?.leaseSeizureAllowed !== false
claim?.item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'
action?.schemaVersion !== 'stephanos.mission-worker-action.v1'
action?.actionKind !== 'agent-handoff'
claim.item.payload !== action
createExecutionReceipt
toSharedWorkspaceExecutionReceipt
createSharedWorkspaceMessageRecord
writeAtomicJson
qualificationEligible: false
sourceMutationPerformed: false
arbitraryShellAllowed: false
arbitraryCommandAllowed: false
mergeAllowed: false
deploymentAllowed: false
selfQualificationAllowed: false
identity?.product === 'OpenClaw' SAFE_RUNTIME_ID.test(runtimeId)
requestedSourceHead !== text(grant?.sourceRevision).toLowerCase()
text(claim?.item?.missionId).toLowerCase() !== missionId text(claim?.item?.actionId).toLowerCase() !== taskId
`;
  if (path.endsWith('/oc1-gateway-provider.test.mjs')) return `
qualification runs inside OpenClaw Gateway and reopens the exact canonical processing claim
a direct module call without the OpenClaw Gateway runtime marker cannot qualify
caller-selected claim paths and extra request fields are rejected before claim access
wrong task or source-head grant cannot redirect Gateway qualification
assert.equal(result.executionSurface, 'openclaw-gateway-plugin')
assert.deepEqual(result.result.changedFiles, [])
`;
  if (path.endsWith('/oc1-repository-scout.test.mjs')) return `
QUALIFICATION_ELIGIBLE=false
OPENCLAW_OC1_QUALIFICATION
sourceMutation
`;
  if (path.endsWith('/openclaw.plugin.json')) return JSON.stringify({
    id: 'stephanos-builder-provider',
    activation: { onStartup: true },
    configSchema: { type: 'object', additionalProperties: false, properties: {} },
  });
  if (path.endsWith('/package.json')) return JSON.stringify({
    name: '@stephanos/openclaw-builder-provider',
    version: '1.0.0',
    private: true,
    type: 'module',
    openclaw: {
      extensions: ['./index.js'],
      compat: { pluginApi: '>=2026.3.24-beta.2', minGatewayVersion: '>=2026.6.11' },
    },
  });
  throw new Error(`unexpected OC1 path ${path}`);
}

function providerPoolContentFor(path) {
  if (path.endsWith('/openClawProviderPoolQualificationV1.mjs')) return `
${'import'} { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';
validateExecutionReceipt
toSharedWorkspaceExecutionReceipt
validateSharedWorkspaceRecord
const OPENCLAW_QUALIFICATION_ISSUE = 1725;
export function validateOpenClawQualificationAuthorityChain
issueNumber: OPENCLAW_QUALIFICATION_ISSUE
execution.workerType !== 'openclaw'
execution.state !== 'completed'
execution.operatorActionRequired !== false
canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)
authority.participantId !== 'stephanos'
authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)
authority.receivedRecordId !== execution.receiptId
authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION
candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId
const host = snapshot(trustedHostContext);
const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;
mergeAuthority: false
leaseSeizureAllowed: false
duplicateDispatchAllowed: false
`;
  if (path.endsWith('/openClawProviderPoolQualificationV1.test.mjs')) return `
requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt
capacity is unusable without the exact validated qualification authority, worker and task class
caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw
syntactically valid trusted qualification without canonical authority cannot route
existing mutation owner is preserved even when OpenClaw is canonically qualified
normal AUTO routing does not silently replace a healthy existing provider policy
assert.equal(result.mergeAuthority, false)
assert.equal(result.leaseSeizureAllowed, false)
assert.equal(result.duplicateDispatchAllowed, false)
`;
  if (path.endsWith('/openClawTaskClassPromotionCandidateV1.mjs')) return `
const ISSUE_NUMBER = 1725;
OC1_REPOSITORY_SCOUT: Object.freeze({
OC2_DETERMINISTIC_TEST_BUILD: Object.freeze({
validateExecutionReceipt(execution
execution?.workerType !== 'openclaw'
execution?.operatorActionRequired !== false
proof.record.timestampUtc !== execution.timestampUtc
proof.record.messageId !== execution.executionId
text(result.observedSourceHead).toLowerCase() !== text(execution.sourceHead).toLowerCase()
canonicalResultDigest(result) !== text(result.exactOutputIdentity).toLowerCase()
result.selfQualificationAllowed !== false
createSharedWorkspaceReceiptRecord({
participantId: 'stephanos'
providerPoolAdmissionAllowed: false
providerQualificationAuthority: false
sourceMutationAllowed: false
mergeAllowed: false
deploymentAllowed: false
runtimeMutationAllowed: false
`;
  if (path.endsWith('/openClawTaskClassPromotionCandidateV1.test.mjs')) return `
turns canonical OC1 execution plus provider proof into a gate-compatible Stephanos promotion candidate without routing authority
supports OC2 only after a completed fixed test/build execution and matching canonical provider proof
fails closed on failed execution, unsupported class, mutation, self-qualification, worker/head drift, test failure or stale proof
rejects result digest drift, extra authority fields and proof-record lineage drift
rejects accessor-bearing, sparse and revoked proof records without executing accessors
assert.equal(candidate.providerPoolAdmissionAllowed, false)
assert.equal(candidate.providerQualificationAuthority, false)
`;
  throw new Error(`unexpected provider-pool path ${path}`);
}

function pr1999ContentFor(path) {
  if (path.endsWith('/openClawProviderPoolQualificationV1.mjs')) return `
${'import'} { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';
acquireSharedWorkspaceOperationLock
validateExecutionReceipt
validateSharedWorkspaceRecord
export const OPENCLAW_PROVIDER_POOL_PUBLISHER_ID = 'stephanos-openclaw-provider-pool-publisher-v1';
export const OPENCLAW_PROVIDER_POOL_COMPONENT_FILES = Object.freeze({
export const OPENCLAW_PROVIDER_POOL_PUBLICATION_LOCK_SEGMENTS = Object.freeze([
'openclaw-provider-pool'
'publication.lock'
const OPENCLAW_QUALIFICATION_ISSUE = 1725;
'SOURCE_CONSTRUCTION'
'FOCUSED_TESTS'
export function validateOpenClawQualificationAuthorityChain
execution.workerType !== 'openclaw'
execution.state !== 'completed'
authority.participantId !== 'stephanos'
candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId
sameStrings(operations, OPENCLAW_CAPACITY_OPERATIONS)
export function validateOpenClawProviderPoolStatusRecord
validatePublisherAttestation(status, expected.publisherPublicKeyPem)
component.componentDigest !== payloadDigest(component.payload)
component.componentDigest !== status.hostContextDigests[componentKey]
status.sourceMutationAllowed !== false
status.mergeAuthority !== false
status.leaseSeizureAllowed !== false
status.duplicateDispatchAllowed !== false
export async function publishOpenClawProviderPoolToSharedWorkspace
OPENCLAW_PROVIDER_POOL_PUBLICATION_LOCK_SEGMENTS
verifyOwnership()
await operationLock.release()
mergeAuthority: false
leaseSeizureAllowed: false
duplicateDispatchAllowed: false
algorithm: 'Ed25519'
signPayload(null, Buffer.from(canonical, 'utf8'), privateKeyPem)
verifyPayload(null, Buffer.from(canonicalJson(unsignedStatus), 'utf8'), publicKeyPem, Buffer.from(attestation.signature, 'base64'))
writeAtomicJson(root, ['receipts', OPENCLAW_PROVIDER_POOL_COMPONENT_FILES[componentKey]
writeAtomicJson(root, ['status', 'openclaw-provider-pool-current.json']
`;
  if (path.endsWith('/openClawProviderPoolQualificationV1.test.mjs')) return `
requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt
capacity is unusable without the exact validated qualification authority, worker and task class
supportedOperations: ['SOURCE_CONSTRUCTION', 'FOCUSED_TESTS', 'MERGE_PULL_REQUEST']
publishes only the complete trusted OpenClaw qualification chain to the canonical status path
publisherId: 'forged-publisher'
ARBITRARY_SHELL
Tampered after publication.
serializes concurrent OpenClaw provider-pool generations behind one fixed operation lock
SHARED_WORKSPACE_OPERATION_LOCK_TIMEOUT
assert.deepEqual(finalValidation.hostContext, secondHost)
`;
  throw new Error(`unexpected #1999 provider-pool path ${path}`);
}

function sources(paths, head, contentFor, overrides = {}) {
  return paths.map((path) => {
    const content = overrides[path] ?? contentFor(path);
    return {
      schemaVersion: 'stephanos.windows-authority-source.v1', repository: REPOSITORY, path, ref: head, exists: true,
      size: Buffer.byteLength(content, 'utf8'), blobSha: blobSha(content), content,
    };
  });
}

function analysis(paths) {
  return { findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) };
}

function lineage(head, base, overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1', repository: REPOSITORY,
    sourceHead: head, sourceCommitSha: head, baseSha: base, liveMainBeforeSha: base, liveMainAfterSha: base,
    parents: ['1111111111111111111111111111111111111111', base],
    comparison: { status: 'ahead', aheadBy: 43, behindBy: 0, baseCommitSha: base, mergeBaseCommitSha: base },
    ...overrides,
  };
}

function oc1Input(overrides = {}) {
  return {
    repository: REPOSITORY, prNumber: 1910, branch: 'agent/openclaw-oc1-repository-scout-provider-v1',
    sourceHead: OC1_HEAD, baseSha: OC1_BASE, lineageEvidence: lineage(OC1_HEAD, OC1_BASE),
    analysis: analysis(OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1),
    sources: sources(OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1, OC1_HEAD, oc1ContentFor),
    ...overrides,
  };
}

function poolInput(overrides = {}) {
  return {
    repository: REPOSITORY, prNumber: 1905, branch: 'agent/openclaw-provider-pool-qualification-v1',
    sourceHead: POOL_HEAD, baseSha: POOL_BASE, lineageEvidence: lineage(POOL_HEAD, POOL_BASE),
    analysis: analysis(OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1),
    sources: sources(OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1, POOL_HEAD, providerPoolContentFor),
    ...overrides,
  };
}

function pr1999Input(overrides = {}) {
  return {
    repository: REPOSITORY, prNumber: 1999, branch: 'codex/five-builder-flywheel-repair',
    sourceHead: PR1999_HEAD, baseSha: PR1999_BASE, lineageEvidence: lineage(PR1999_HEAD, PR1999_BASE),
    analysis: analysis(OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1),
    sources: sources(OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1, PR1999_HEAD, pr1999ContentFor),
    ...overrides,
  };
}

test('exact OC1 high-risk estate remains eligible and clean only with closed-world source proof', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(oc1Input());
  assert.equal(result.eligible, true); assert.equal(result.clean, true); assert.equal(result.findings.length, 0);
  assert.deepEqual(result.reviewedPaths, OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1);
  assert.equal(result.proofRefs.length, OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1.length);
  assert.equal(result.finalVerdict, 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_CLEAN');
});

test('OC1 wrong PR, incomplete escalation and main drift remain fail closed', () => {
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(oc1Input({ prNumber: 1911 })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(oc1Input({ analysis: { findings: analysis(OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1).findings.slice(1) } })).eligible, false);
  const drift = analyzeOpenClawBuilderProviderSpecialistReviewV1(oc1Input({ lineageEvidence: lineage(OC1_HEAD, OC1_BASE, { liveMainAfterSha: '2222222222222222222222222222222222222222' }) }));
  assert.equal(drift.eligible, true); assert.equal(drift.clean, false); assert.equal(drift.findings[0].code, 'openclaw-oc1-reconciliation-lineage-invalid');
});

test('OC1 shell widening, missing mission binding and extra source evidence remain findings', () => {
  const gatewayPath = OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1[1];
  const scoutPath = OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1[2];
  const alteredSources = sources(OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1, OC1_HEAD, oc1ContentFor, {
    [gatewayPath]: oc1ContentFor(gatewayPath).replace("text(item?.missionId).toLowerCase() !== missionId", 'mission-binding-removed'),
    [scoutPath]: oc1ContentFor(scoutPath).replace('shell: false', 'shell: true'),
  });
  alteredSources.push({ ...alteredSources[0] });
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(oc1Input({ sources: alteredSources }));
  assert.equal(result.eligible, true); assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc1-mission-binding-missing'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc1-shell-denial-missing'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc1-dynamic-code-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc1-source-evidence-estate-mismatch'));
});

test('exact #1905 provider-pool high-risk estate is eligible and clean only with closed-world authority proof', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(poolInput());
  assert.equal(result.eligible, true); assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1);
  assert.equal(result.proofRefs.length, OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1.length);
  assert.equal(result.finalVerdict, 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_CLEAN');
});

test('#1905 specialist rejects wrong PR and incomplete four-path escalation instead of widening review authority', () => {
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(poolInput({ prNumber: 1906 })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(poolInput({ analysis: { findings: analysis(OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1).findings.slice(0, 3) } })).eligible, false);
});

test('#1905 specialist fails closed when trusted-host authority binding or denial coverage is removed', () => {
  const poolPath = OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1[0];
  const promotionTestPath = OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1[3];
  const alteredSources = sources(OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1, POOL_HEAD, providerPoolContentFor, {
    [poolPath]: providerPoolContentFor(poolPath).replace("authority.participantId !== 'stephanos'", 'authority-participant-binding-removed'),
    [promotionTestPath]: providerPoolContentFor(promotionTestPath).replace('assert.equal(candidate.providerQualificationAuthority, false)', 'qualification-authority-denial-test-removed'),
  });
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(poolInput({ sources: alteredSources }));
  assert.equal(result.eligible, true); assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-stephanos-authority-gate-missing'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-promotion-qualification-authority-denial-test-missing'));
});

test('exact #1999 two-file provider-pool escalation routes through the existing protected specialist', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(pr1999Input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1);
  assert.equal(result.proofRefs.length, 2);
  assert.equal(result.finalVerdict, 'OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_CLEAN');
});

test('#1999 specialist rejects wrong identity, incomplete escalation and current-main drift', () => {
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(pr1999Input({ prNumber: 1905 })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(pr1999Input({ branch: 'agent/openclaw-provider-pool-qualification-v1' })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(pr1999Input({ analysis: { findings: analysis(OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1).findings.slice(0, 1) } })).eligible, false);
  const drift = analyzeOpenClawBuilderProviderSpecialistReviewV1(pr1999Input({ lineageEvidence: lineage(PR1999_HEAD, PR1999_BASE, { liveMainAfterSha: '3333333333333333333333333333333333333333' }) }));
  assert.equal(drift.eligible, true);
  assert.equal(drift.clean, false);
  assert.equal(drift.findings[0].code, 'pr1999-provider-pool-reconciliation-lineage-invalid');
});

test('#1999 specialist rejects removed publication locking and exact-operation gating', () => {
  const path = OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1[0];
  const alteredSources = sources(OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1, PR1999_HEAD, pr1999ContentFor, {
    [path]: pr1999ContentFor(path)
      .replace('acquireSharedWorkspaceOperationLock', 'operation-lock-removed')
      .replace('sameStrings(operations, OPENCLAW_CAPACITY_OPERATIONS)', 'operations.includes(\'SOURCE_CONSTRUCTION\')'),
  });
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(pr1999Input({ sources: alteredSources }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'pr1999-provider-pool-operation-lock-missing'));
  assert.ok(result.findings.some((item) => item.code === 'pr1999-provider-pool-exact-operations-gate-missing'));
});

test('#1999 specialist rejects widened source evidence and dynamic execution', () => {
  const path = OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1[0];
  const alteredSources = sources(OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1, PR1999_HEAD, pr1999ContentFor, {
    [path]: `${pr1999ContentFor(path)}\nspawnSync('powershell.exe', [], { shell: true })`,
  });
  alteredSources.push({ ...alteredSources[0] });
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(pr1999Input({ sources: alteredSources }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'pr1999-provider-pool-source-evidence-estate-mismatch'));
  assert.ok(result.findings.some((item) => item.code === 'pr1999-provider-pool-dynamic-execution-forbidden'));
});
