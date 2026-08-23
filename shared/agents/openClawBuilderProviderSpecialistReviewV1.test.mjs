import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewV1,
} from './openClawBuilderProviderSpecialistReviewV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const HEAD = '46abde391adf7dd138d0f70f63c284133baaa3d4';
const BASE = 'a564e318541d75854ed7bf675baf9b4dc52fedaf';

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function contentFor(path) {
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
  throw new Error(`unexpected path ${path}`);
}

function sources(overrides = {}) {
  return OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1.map((path) => {
    const content = overrides[path] ?? contentFor(path);
    return {
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: REPOSITORY,
      path,
      ref: HEAD,
      exists: true,
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    };
  });
}

function analysis() {
  return {
    findings: OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path,
    })),
  };
}

function lineage(overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository: REPOSITORY,
    sourceHead: HEAD,
    sourceCommitSha: HEAD,
    baseSha: BASE,
    liveMainBeforeSha: BASE,
    liveMainAfterSha: BASE,
    parents: ['1111111111111111111111111111111111111111', BASE],
    comparison: {
      status: 'ahead',
      aheadBy: 43,
      behindBy: 0,
      baseCommitSha: BASE,
      mergeBaseCommitSha: BASE,
    },
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    repository: REPOSITORY,
    prNumber: 1910,
    branch: 'agent/openclaw-oc1-repository-scout-provider-v1',
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: analysis(),
    sources: sources(),
    ...overrides,
  };
}

test('exact OC1 high-risk estate is eligible and clean only with closed-world source proof', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.findings.length, 0);
  assert.deepEqual(result.reviewedPaths, OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1);
  assert.equal(result.proofRefs.length, OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1.length);
  assert.equal(result.finalVerdict, 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_CLEAN');
});

test('wrong PR, incomplete escalation and main drift are not accepted', () => {
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(input({ prNumber: 1911 })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewV1(input({ analysis: { findings: analysis().findings.slice(1) } })).eligible, false);
  const drift = analyzeOpenClawBuilderProviderSpecialistReviewV1(input({
    lineageEvidence: lineage({ liveMainAfterSha: '2222222222222222222222222222222222222222' }),
  }));
  assert.equal(drift.eligible, true);
  assert.equal(drift.clean, false);
  assert.equal(drift.findings[0].code, 'openclaw-oc1-reconciliation-lineage-invalid');
});

test('shell widening, missing mission binding and extra source evidence fail closed', () => {
  const gatewayPath = OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1[1];
  const scoutPath = OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1[2];
  const alteredSources = sources({
    [gatewayPath]: contentFor(gatewayPath).replace("text(item?.missionId).toLowerCase() !== missionId", 'mission-binding-removed'),
    [scoutPath]: contentFor(scoutPath).replace('shell: false', 'shell: true'),
  });
  alteredSources.push({ ...alteredSources[0] });
  const result = analyzeOpenClawBuilderProviderSpecialistReviewV1(input({ sources: alteredSources }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc1-mission-binding-missing'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc1-shell-denial-missing'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc1-dynamic-code-forbidden'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc1-source-evidence-estate-mismatch'));
});
