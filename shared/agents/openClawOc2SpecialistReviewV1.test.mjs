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
const CANONICAL_OC2_BRANCH = 'agent/openclaw-oc2-deterministic-test-build-v1';

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
    findings: OPENCLAW_OC2_SPECIALIST_PATHS_V1.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
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
    comparison: { status: 'ahead', aheadBy: 1, behindBy: 0, baseCommitSha: BASE, mergeBaseCommitSha: BASE },
  };
}

const INDEX = `
${'import'} { OPENCLAW_OC1_GATEWAY_METHOD } from './oc1.mjs';
${'import'} { OPENCLAW_OC2_GATEWAY_METHOD, executeOpenClawOc2GatewayRequest } from './oc2.mjs';
function gatewayContext(method) { return { executingInsideOpenClawGateway: true, pluginId: 'stephanos-builder-provider', method, providerInstance: \`openclaw-gateway:\${process.pid}\` }; }
export default { register(api) {
  api.registerGatewayMethod(OPENCLAW_OC1_GATEWAY_METHOD, async () => ({}), { scope: 'operator.write' });
  api.registerGatewayMethod(OPENCLAW_OC2_GATEWAY_METHOD, async (params) => executeOpenClawOc2GatewayRequest(params, { gatewayRuntimeContext: gatewayContext(OPENCLAW_OC2_GATEWAY_METHOD) }), { scope: 'operator.write' });
  api.registerCommand({ description: 'Qualification is reserved for canonical Mission Worker claims executed by the OpenClaw Gateway plugin.' });
} };
`;

const EXECUTOR = `
export const OPENCLAW_OC2_TASK_CLASS = 'OC2_DETERMINISTIC_TEST_BUILD';
export const OPENCLAW_OC2_OPERATION = 'oc2-provider-regression-v1';
export const OPENCLAW_OC2_PROVIDER = 'openclaw-standalone';
export const OPENCLAW_OC2_PROVIDER_VERSION = '1.0.0';
export const OPENCLAW_OC2_ISSUE = 1725;
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'main';
const MAX_OUTPUT_BYTES = 1024 * 1024;
const OPENCLAW_OC2_FIXED_PLAN = [{ testId: 'OC2_PROVIDER_SOURCE_PARSE_V1' }, { testId: 'OC2_PROVIDER_REGRESSION_V1' }];
const BATTLE_BRIDGE_WINDOWS_HOST = { git: 'git.exe', node: 'node.exe' };
function runFixed(spawnSyncFn, executable, args, repoRoot, env, timeout = 120_000) {
  return spawnSyncFn(executable, args, { cwd: repoRoot, env, shell: false, windowsHide: true, timeout });
}
function runGit(spawnSyncFn, repoRoot, args, env) { return runFixed(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.git, args, repoRoot, env, 15_000); }
async function validate(grant, claim, action, persisted) {
  if (grant?.schemaVersion !== 'stephanos.mission-worker-action-grant.v1'
    || grant?.boundedActionCount !== 1
    || grant?.mergeAuthority !== false
    || grant?.leaseSeizureAllowed !== false
    || grant?.adapter.toLowerCase() !== 'openclaw-readonly'
    || grant?.operation.toLowerCase() !== OPENCLAW_OC2_OPERATION
    || grant?.repository !== REPOSITORY
    || !FULL_SHA.test(text(grant?.sourceRevision).toLowerCase())) return false;
  if (claim?.item?.schemaVersion !== 'stephanos.mission-worker-queue-item.v1') return false;
  if (action?.schemaVersion !== 'stephanos.mission-worker-action.v1') return false;
  if (claim.item.payload !== action) return false;
  if (JSON.stringify(persisted) !== JSON.stringify(claim.item)) return false;
  return true;
}
async function execute(platform, task, spawnSyncFn, repoRoot, env) {
  if (platform !== 'win32') return false;
  const sourceHead = 'a';
  if (sourceHead !== task.requestedSourceHead) return false;
  const results = [];
  for (const plan of OPENCLAW_OC2_FIXED_PLAN) {
    results.push(runFixed(spawnSyncFn, BATTLE_BRIDGE_WINDOWS_HOST.node, [...plan.args], repoRoot, env));
  }
  const finalHead = sourceHead;
  const statusBefore = '';
  const statusAfter = '';
  if (finalHead !== sourceHead) return false;
  if (statusAfter !== statusBefore) return false;
  return { qualificationEligible: true, providerInstance, exactInputIdentity, exactOutputIdentity, createExecutionReceipt, toSharedWorkspaceExecutionReceipt, createSharedWorkspaceMessageRecord, writeAtomicJson, sourceMutationPerformed: false, arbitraryShellAllowed: false, arbitraryCommandAllowed: false, mergeAllowed: false, deploymentAllowed: false, selfQualificationAllowed: false, workerType: 'openclaw', channel: 'openclaw-provider-qualification' };
}
function classifyDirt() {}
`;

const GATEWAY = `
export const OPENCLAW_OC2_GATEWAY_METHOD = 'stephanos-builder-provider.oc2Qualification';
export const OPENCLAW_OC2_GATEWAY_REQUEST_SCHEMA = 'stephanos.openclaw-oc2-gateway-request.v1';
export const OPENCLAW_OC2_GATEWAY_RESULT_SCHEMA = 'stephanos.openclaw-oc2-gateway-result.v1';
const REPOSITORY = 'Cheekyfellastef/stephan-os';
const REQUEST_KEYS = new Set(['schemaVersion', 'actionGrant']);
function gatewayInstance(context) { const providerInstance = context.providerInstance; return context?.executingInsideOpenClawGateway === true && context?.pluginId === 'stephanos-builder-provider' && context?.method === OPENCLAW_OC2_GATEWAY_METHOD && GATEWAY_INSTANCE.test(providerInstance); }
async function execute(request, options, queueRoot, grant, result) {
  if (grant?.boundedActionCount !== 1 || grant?.mergeAuthority !== false || grant?.leaseSeizureAllowed !== false) return false;
  const processingRoot = path.resolve(queueRoot, 'openclaw-readonly', 'processing');
  await executeClaimedOpenClawOc2DeterministicTestBuild();
  return { taskClass: OPENCLAW_OC2_TASK_CLASS, providerVersion: OPENCLAW_OC2_PROVIDER_VERSION, executionSurface: 'openclaw-gateway-plugin', qualificationEligible: result.success === true && result.qualificationEligible === true };
}
`;

const EXECUTOR_TEST = `
test('OC2 admits only the exact canonical claimed action and fixed operation', async () => { const valid = { task: { arbitraryCommandAuthority: false } }; assert.equal(valid.task.arbitraryCommandAuthority, false); });
test('OC2 executes only fixed node test IDs and proves source state unchanged', async () => { const result = { changedFiles: [] }; assert.deepEqual(result.changedFiles, []); assert.ok(nodeCalls.every((call) => call.options.shell === false)); });
test('OC2 fails closed if a fixed test changes repository source state', async () => { const result = { error: 'OPENCLAW_OC2_SOURCE_STATE_CHANGED' }; assert.equal(result.error, 'OPENCLAW_OC2_SOURCE_STATE_CHANGED'); });
`;

const GATEWAY_TEST = `
test('OC2 gateway rejects execution outside the actual OpenClaw Gateway plugin', async () => { const result = { success: false }; assert.equal(result.success, false); });
test('OC2 gateway rejects caller-selected operation or extra request fields', async () => { const extra = { error: 'OPENCLAW_OC2_GATEWAY_REQUEST_SHAPE_INVALID' }; assert.equal(extra.error, 'OPENCLAW_OC2_GATEWAY_REQUEST_SHAPE_INVALID'); });
test('OC2 gateway binds the persisted claimed item and executes the fixed plan', async () => { const result = { executionSurface: 'openclaw-gateway-plugin', result: { changedFiles: [] } }; assert.equal(result.executionSurface, 'openclaw-gateway-plugin'); assert.equal(result.result.changedFiles.length, 0); });
`;

const PLUGIN = JSON.stringify({ id: 'stephanos-builder-provider', description: 'OC2 deterministic test/build', activation: { onStartup: true }, configSchema: { type: 'object', additionalProperties: false, properties: {} } });

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
  return { repository: REPOSITORY, prNumber: 1931, branch: CANONICAL_OC2_BRANCH, sourceHead: HEAD, baseSha: BASE, lineageEvidence: lineage(), analysis: analysis(), sources: sources(), ...overrides };
}

test('OC2 specialist cleanly reviews the exact closed OC2 surfaces', () => {
  const result = analyzeOpenClawOc2SpecialistReviewV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.findings.length, 0);
});

test('OC2 specialist is not applicable to another PR or incomplete escalation', () => {
  assert.equal(analyzeOpenClawOc2SpecialistReviewV1(input({ prNumber: 1905 })).eligible, false);
  const incomplete = analysis(); incomplete.findings.pop();
  assert.equal(analyzeOpenClawOc2SpecialistReviewV1(input({ analysis: incomplete })).eligible, false);
});

test('OC2 specialist rejects every extra process route', () => {
  for (const injected of ['spawn(userExecutable, userArgs);', 'spawnSync(userExecutable, userArgs);', 'spawnSyncFn(userExecutable, userArgs);']) {
    const result = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: sources({ [OPENCLAW_OC2_SPECIALIST_PATHS_V1[1]]: `${EXECUTOR}\n${injected}` }) }));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-unbounded-process-authority-forbidden'));
  }
});

test('OC2 specialist does not accept authority checks preserved only in comments', () => {
  const weakened = EXECUTOR.replace('grant?.boundedActionCount !== 1', 'true').concat('\n// grant?.boundedActionCount !== 1');
  const result = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: sources({ [OPENCLAW_OC2_SPECIALIST_PATHS_V1[1]]: weakened }) }));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-bounded-action-gate-missing'));
});

test('OC2 specialist rejects an additional gateway registration', () => {
  const widened = INDEX.replace('api.registerCommand', "api.registerGatewayMethod('unexpected.method', async () => ({}), { scope: 'operator.write' });\n  api.registerCommand");
  const result = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: sources({ [OPENCLAW_OC2_SPECIALIST_PATHS_V1[0]]: widened }) }));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-index-gateway-registration-set-not-closed'));
});

test('OC2 specialist rejects filesystem and network authority widening', () => {
  for (const injected of ["writeFileSync('/tmp/outside', 'x');", "fetch('https://example.com');", "import http from 'node:http';\nhttp.get(url);"]) {
    const result = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: sources({ [OPENCLAW_OC2_SPECIALIST_PATHS_V1[1]]: `${EXECUTOR}\n${injected}` }) }));
    assert.equal(result.clean, false);
  }
});

test('OC2 specialist rejects skipped or inert advertised regressions', () => {
  const skipped = EXECUTOR_TEST.replace("test('OC2 admits only", "test.skip('OC2 admits only");
  const result = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: sources({ [OPENCLAW_OC2_SPECIALIST_PATHS_V1[3]]: skipped }) }));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-test-active-regression-missing'));

  const commented = EXECUTOR_TEST.replace('assert.deepEqual(result.changedFiles, []);', '// assert.deepEqual(result.changedFiles, []);');
  const result2 = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: sources({ [OPENCLAW_OC2_SPECIALIST_PATHS_V1[3]]: commented }) }));
  assert.ok(result2.findings.some((item) => item.code === 'openclaw-oc2-test-active-regression-missing'));
});

test('OC2 specialist fails closed on source evidence drift', () => {
  const drifted = sources(); drifted[0] = { ...drifted[0], blobSha: 'c'.repeat(40) };
  const result = analyzeOpenClawOc2SpecialistReviewV1(input({ sources: drifted }));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-source-evidence-invalid'));
});

test('OpenClaw wrapper keeps the existing specialist and separately governed OC2 fallback', () => {
  const wrapper = readFileSync(new URL('../../scripts/independent-merge-security-review-with-openclaw-specialist-v1.mjs', import.meta.url), 'utf8');
  assert.match(wrapper, /analyzeOpenClawBuilderProviderSpecialistReviewV1/);
  assert.match(wrapper, /analyzeOpenClawOc2SpecialistReviewV1/);
  assert.match(wrapper, /specialistAnalyzer = analyzeOpenClawOc2SpecialistReviewV1/);
});
