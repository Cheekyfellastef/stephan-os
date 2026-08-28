import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1,
  analyzeOpenClawProviderPoolPr1999SpecialistReviewV1,
} from './openClawProviderPoolPr1999SpecialistReviewV1.mjs';
import { analyzeOpenClawBuilderProviderSpecialistReviewV1 } from './openClawBuilderProviderSpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = 'bcdd92c388e36c785adeabeb533e79a751637758';
const BASE = '7e8e20a036b5ae114670c9346dcab9594958cc9a';
const BRANCH = 'codex/five-builder-flywheel-repair';

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function providerContent() {
  const importKeyword = ['im', 'port'].join('');
  return `
${importKeyword} { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';
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
algorithm:'Ed25519' signPayload(null, Buffer.from(canonical, 'utf8'), privateKeyPem
verifyPayload(null, Buffer.from(canonicalJson(unsignedStatus), 'utf8'), publicKeyPem, Buffer.from(attestation.signature, 'base64')
writeAtomicJson(root, ['receipts', OPENCLAW_PROVIDER_POOL_COMPONENT_FILES[componentKey]
writeAtomicJson(root, ['status', 'openclaw-provider-pool-current.json']
`;
}

function testContent() {
  return `
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
}

function source(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1', repository: REPOSITORY,
    path, ref: HEAD, exists: true, size: Buffer.byteLength(content, 'utf8'), blobSha: blobSha(content), content,
  };
}

function sources(overrides = {}) {
  const contents = {
    [OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1[0]]: providerContent(),
    [OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1[1]]: testContent(),
    ...overrides,
  };
  return OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1.map((path) => source(path, contents[path]));
}

function lineage(overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1', repository: REPOSITORY,
    sourceHead: HEAD, sourceCommitSha: HEAD, baseSha: BASE, liveMainBeforeSha: BASE, liveMainAfterSha: BASE,
    parents: ['1111111111111111111111111111111111111111', BASE],
    comparison: { status: 'ahead', aheadBy: 55, behindBy: 0, baseCommitSha: BASE, mergeBaseCommitSha: BASE },
    ...overrides,
  };
}

function analysis(paths = OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1) {
  return { findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })) };
}

function input(overrides = {}) {
  return {
    repository: REPOSITORY, prNumber: 1999, branch: BRANCH, sourceHead: HEAD, baseSha: BASE,
    lineageEvidence: lineage(), analysis: analysis(), sources: sources(), ...overrides,
  };
}

test('exact #1999 two-file provider-pool escalation is eligible and clean', () => {
  const result = analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1);
  assert.equal(result.proofRefs.length, 2);
  assert.equal(result.finalVerdict, 'OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_CLEAN');
});

test('top-level OpenClaw specialist composition routes the exact #1999 escalation', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1);
});

test('#1999 profile rejects another PR branch or incomplete escalation', () => {
  assert.equal(analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input({ prNumber: 1905 })).eligible, false);
  assert.equal(analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input({ branch: 'agent/openclaw-provider-pool-qualification-v1' })).eligible, false);
  assert.equal(analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input({ analysis: analysis([OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1[0]]) })).eligible, false);
});

test('#1999 profile fails closed on lineage drift and widened source evidence', () => {
  const drift = analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input({ lineageEvidence: lineage({ liveMainAfterSha: '2'.repeat(40) }) }));
  assert.equal(drift.eligible, true);
  assert.equal(drift.clean, false);
  assert.equal(drift.findings[0].code, 'pr1999-provider-pool-reconciliation-lineage-invalid');
  const extra = [...sources(), { ...sources()[0] }];
  const widened = analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input({ sources: extra }));
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'pr1999-provider-pool-source-evidence-estate-mismatch'));
});

test('#1999 profile detects removed publication lock and privileged-operation regression', () => {
  const path = OPENCLAW_PROVIDER_POOL_PR1999_SPECIALIST_PATHS_V1[0];
  const altered = providerContent()
    .replace('acquireSharedWorkspaceOperationLock', 'operation-lock-removed')
    .replace('sameStrings(operations, OPENCLAW_CAPACITY_OPERATIONS)', 'operations.includes("SOURCE_CONSTRUCTION")');
  const result = analyzeOpenClawProviderPoolPr1999SpecialistReviewV1(input({ sources: sources({ [path]: altered }) }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'pr1999-provider-pool-operation-lock-missing'));
  assert.ok(result.findings.some((item) => item.code === 'pr1999-provider-pool-exact-operations-gate-missing'));
});
