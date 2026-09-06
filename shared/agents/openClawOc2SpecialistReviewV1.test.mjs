import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  OPENCLAW_OC2_SPECIALIST_PATHS_V1,
  analyzeOpenClawOc2SpecialistReviewV1,
} from './openClawOc2SpecialistReviewV1.mjs';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const REPOSITORY = 'Cheekyfellastef/stephan-os';

function sha1Blob(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function source(path, content) {
  return {
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref: HEAD,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: sha1Blob(content),
    content,
  };
}

function analysis() {
  return {
    findings: OPENCLAW_OC2_SPECIALIST_PATHS_V1.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path,
    })),
  };
}

function lineage() {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository: REPOSITORY,
    sourceHead: HEAD,
    sourceCommitSha: HEAD,
    baseSha: BASE,
    liveMainBeforeSha: BASE,
    liveMainAfterSha: BASE,
    parents: [BASE],
    comparison: {
      status: 'ahead',
      aheadBy: 1,
      behindBy: 0,
      baseCommitSha: BASE,
      mergeBaseCommitSha: BASE,
    },
  };
}

const INDEX = [
  'OPENCLAW_OC2_GATEWAY_METHOD',
  'executeOpenClawOc2GatewayRequest',
  'executingInsideOpenClawGateway: true',
  "pluginId: 'stephanos-builder-provider'",
  'providerInstance: `openclaw-gateway:${process.pid}`',
  'api.registerGatewayMethod(',
  'OPENCLAW_OC2_GATEWAY_METHOD,',
  'async (params) => executeOpenClawOc2GatewayRequest(params, {',
  'gatewayContext(OPENCLAW_OC2_GATEWAY_METHOD)',
  "{ scope: 'operator.write' }",
  'Qualification is reserved for canonical Mission Worker claims executed by the OpenClaw Gateway plugin.',
].join('\n');

const EXECUTOR = [
  "export const OPENCLAW_OC2_TASK_CLASS = 'OC2_DETERMINISTIC_TEST_BUILD';",
  "export const OPENCLAW_OC2_OPERATION = 'oc2-provider-regression-v1';",
  "export const OPENCLAW_OC2_PROVIDER = 'openclaw-standalone';",
  "export const OPENCLAW_OC2_PROVIDER_VERSION = '1.0.0';",
  'export const OPENCLAW_OC2_ISSUE = 1725;',
  "const REPOSITORY = 'Cheekyfellastef/stephan-os';",
  "const BRANCH = 'main';",
  'const MAX_OUTPUT_BYTES = 1024 * 1024;',
  "testId: 'OC2_PROVIDER_SOURCE_PARSE_V1'",
  "'integrations/openclaw/stephanos-builder-provider/lib/oc2-deterministic-test-build.mjs'",
  "testId: 'OC2_PROVIDER_REGRESSION_V1'",
  "'integrations/openclaw/stephanos-builder-provider/oc2-deterministic-test-build.test.mjs'",
  "'integrations/openclaw/stephanos-builder-provider/oc2-gateway-provider.test.mjs'",
  "'scripts/mission-orchestrator-worker.oc2.test.mjs'",
  'BATTLE_BRIDGE_WINDOWS_HOST.git',
  'BATTLE_BRIDGE_WINDOWS_HOST.node',
  'shell: false',
  'windowsHide: true',
  'timeout = 120_000',
  '15_000',
  "grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'",
  'grant?.boundedActionCount !== 1',
  'grant?.mergeAuthority !== false',
  'grant?.leaseSeizureAllowed !== false',
  "text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'",
  'text(grant?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION',
  'text(grant?.repository) !== REPOSITORY',
  'FULL_SHA.test(text(grant?.sourceRevision).toLowerCase())',
  "claim?.item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'",
  "action?.schemaVersion !== 'stephanos.mission-worker-action.v1'",
  "action?.actionKind !== 'agent-handoff'",
  'claim.item.payload !== action',
  'JSON.stringify(persisted) !== JSON.stringify(claim.item)',
  'classifyDirt',
  'if (sourceHead !== task.requestedSourceHead)',
  'if (finalHead !== sourceHead)',
  'if (statusAfter !== statusBefore)',
  "if (platform !== 'win32')",
  'createExecutionReceipt',
  'toSharedWorkspaceExecutionReceipt',
  'createSharedWorkspaceMessageRecord',
  'writeAtomicJson',
  'sourceMutationPerformed: false',
  'arbitraryShellAllowed: false',
  'arbitraryCommandAllowed: false',
  'mergeAllowed: false',
  'deploymentAllowed: false',
  'selfQualificationAllowed: false',
  "workerType: 'openclaw'",
  "channel: 'openclaw-provider-qualification'",
  'for (const plan of OPENCLAW_OC2_FIXED_PLAN) {',
  'runFixed(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.node, [...plan.args], repoRoot, env)',
  'requestedSourceHead !== text(grant.sourceRevision).toLowerCase()',
  'qualificationEligible: true',
  'providerInstance',
  'exactInputIdentity',
  'exactOutputIdentity',
].join('\n');

const GATEWAY = [
  "export const OPENCLAW_OC2_GATEWAY_METHOD = 'stephanos-builder-provider.oc2Qualification';",
  "export const OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA = 'stephanos.openclaw-oc2-gateway-request.v1';",
  "export const OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA = 'stephanos.openclaw-oc2-gateway-result.v1';",
  "const REPOSITORY = 'Cheekyfellastef/stephan-os';",
  "const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);",
  'context?.executingInsideOpenClawGateway === true',
  "context?.pluginId === 'stephanos-builder-provider'",
  'context?.method === OPENCLAW_OC2_GATEWAY_METHOD',
  'GATEWAY_INSTANCE.test(providerInstance)',
  "grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'",
  'grant?.boundedActionCount !== 1',
  'grant?.mergeAuthority !== false',
  'grant?.leaseSeizureAllowed !== false',
  "text(grant?.adapter).toLowerCase() !== 'openclaw-readonly'",
  'text(grant?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION',
  "path.resolve(queueRoot, 'openclaw-readonly', 'processing')",
  "item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1'",
  'text(item?.missionId).toLowerCase() !== missionId',
  'text(item?.actionId).toLowerCase() !== taskId',
  'text(item?.payload?.operation).toLowerCase() !== OPENCLAW_OC2_OPERATION',
  'executeClaimedOpenClawOc2DeterministicTestBuild',
  'taskClass: OPENCLAW_OC2_TASK_CLASS',
  'providerVersion: OPENCLAW_OC2_PROVIDER_VERSION',
  "executionSurface: 'openclaw-gateway-plugin'",
  'qualificationEligible: result.success === true && result.qualificationEligible === true',
].join('\n');

const EXECUTOR_TEST = [
  'OC2 admits only the exact canonical claimed action and fixed operation',
  'OC2 executes only fixed node test IDs and proves source state unchanged',
  'OC2 fails closed if a fixed test changes repository source state',
  'assert.equal(valid.task.arbitraryCommandAuthority, false)',
  'assert.deepEqual(result.changedFiles, [])',
  'assert.ok(nodeCalls.every((call) => call.options.shell === false))',
  "assert.equal(result.error, 'OPENCLAW_OC2_SOURCE_STATE_CHANGED')",
].join('\n');

const GATEWAY_TEST = [
  'OC2 gateway rejects execution outside the actual OpenClaw Gateway plugin',
  'OC2 gateway rejects caller-selected operation or extra request fields',
  'OC2 gateway binds the persisted claimed item and executes the fixed plan',
  "assert.equal(result.executionSurface, 'openclaw-gateway-plugin')",
  'assert.equal(result.result.changedFiles.length, 0)',
  "assert.equal(extra.error, 'OPENCLAW_OC2_GATEWAY_REQUEST_SHAPE_INVALID')",
].join('\n');

const PLUGIN = JSON.stringify({
  id: 'stephanos-builder-provider',
  name: 'Stephanos Builder Provider',
  description: 'Adds authenticated fixed OC1 repository-scout and OC2 deterministic test/build task families for OpenClaw provider qualification.',
  activation: { onStartup: true },
  configSchema: { type: 'object', additionalProperties: false, properties: {} },
}, null, 2);

function sources(overrides = {}) {
  const contents = {
    [OPENCLAW_OC2_SPECIALIST_PATHS_V1[0]]: INDEX,
    [OPENCLAW_OC2_SPECIALIST_PATHS_V1[1]]: EXECUTOR,
    [OPENCLAW_OC2_SPECIALIST_PATHS_V1[2]]: GATEWAY,
    [OPENCLAW_OC2_SPECIALIST_PATHS_V1[3]]: EXECUTOR_TEST,
    [OPENCLAW_OC2_SPECIALIST_PATHS_V1[4]]: GATEWAY_TEST,
    [OPENCLAW_OC2_SPECIALIST_PATHS_V1[5]]: PLUGIN,
    ...overrides,
  };
  return OPENCLAW_OC2_SPECIALIST_PATHS_V1.map((path) => source(path, contents[path]));
}

function input(overrides = {}) {
  return {
    repository: REPOSITORY,
    prNumber: 1931,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: analysis(),
    sources: sources(),
    ...overrides,
  };
}

test('OC2 specialist cleanly reviews only the exact six unsupported high-risk OC2 surfaces', () => {
  const result = analyzeOpenClawOc2SpecialistReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'OPENCLAW_OC2_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths, OPENCLAW_OC2_SPECIALIST_PATHS_V1);
  assert.equal(result.findings.length, 0);
  assert.equal(result.proofRefs.length, 6);
});

test('OC2 specialist is not applicable to another PR or an incomplete escalation estate', () => {
  assert.equal(analyzeOpenClawOc2SpecialistReviewV1(input({ prNumber: 1905 })).eligible, false);
  const incomplete = analysis();
  incomplete.findings.pop();
  assert.equal(analyzeOpenClawOc2SpecialistReviewV1(input({ analysis: incomplete })).eligible, false);
});

test('OC2 specialist fails closed on execution authority widening or exact-source drift', () => {
  const widened = sources({
    [OPENCLAW_OC2_SPECIALIST_PATHS_V1[1]]: `${EXECUTOR}\nshell: true`,
  });
  const result = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: widened }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-dynamic-code-forbidden'));

  const drifted = sources();
  drifted[0] = { ...drifted[0], blobSha: 'c'.repeat(40) };
  const drift = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: drifted }));
  assert.ok(drift.findings.some((item) => item.code === 'openclaw-oc2-source-evidence-invalid'));
});

test('OpenClaw specialist wrapper composes the separately governed OC2 specialist without replacing the existing specialist', () => {
  const wrapper = readFileSync(new URL('../../scripts/independent-merge-security-review-with-openclaw-specialist-v1.mjs', import.meta.url), 'utf8');
  assert.match(wrapper, /analyzeOpenClawBuilderProviderSpecialistReviewV1/);
  assert.match(wrapper, /analyzeOpenClawOc2SpecialistReviewV1/);
  assert.match(wrapper, /specialistAnalyzer = analyzeOpenClawOc2SpecialistReviewV1/);
});
