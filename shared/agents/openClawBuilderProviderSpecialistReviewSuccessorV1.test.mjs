import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1,
  OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const BRANCH = 'fix/battle-bridge-canonical-git-hardlink-v1';
const OC9_BRANCH = 'agent/1415-openclaw-update-preflight-v1';
const HEAD = '1111111111111111111111111111111111111111';
const BASE = '2222222222222222222222222222222222222222';
const PATH = 'scripts/windows/restart-approved-stephanos-runtime.ps1';

function analysis() {
  return {
    findings: [{ severity: 'P0', code: 'unsupported-high-risk-surface', path: PATH }],
  };
}

function oc9Analysis() {
  return {
    findings: OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1.map((path) => ({
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
    parents: [BASE],
    comparison: {
      status: 'ahead',
      aheadBy: 1,
      behindBy: 0,
      baseCommitSha: BASE,
      mergeBaseCommitSha: BASE,
    },
    ...overrides,
  };
}

function blobSha(content) {
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
    blobSha: blobSha(content),
    content,
  };
}

function testSource(titles) {
  return titles.map((title) => `test('${title}', () => { assert.equal(true, true); });`).join('\n');
}

function oc9Contents(overrides = {}) {
  return {
    '.github/workflows/openclaw-update-preflight-proof.yml': [
      'permissions:',
      '  contents: read',
      'node --check shared/agents/openClawUpdatePreflightV1.mjs',
      'node --check scripts/openclaw-update-preflight.mjs',
      'node --test shared/agents/openClawUpdatePreflightV1.test.mjs scripts/openclaw-update-preflight.test.mjs',
      'git diff --check',
    ].join('\n'),
    'scripts/openclaw-update-preflight.mjs': [
      'const MAX_INPUT_BYTES = 256 * 1024;',
      'const result = buildOpenClawUpdatePreflightV1(input);',
      'stderr.write(`OPENCLAW_UPDATE_PREFLIGHT_ERROR=${error}`);',
      "return result.status === OPENCLAW_UPDATE_PREFLIGHT_STATUS.BLOCKED_WITH_RESTORE_PATH ? 2 : 0;",
    ].join('\n'),
    'scripts/openclaw-update-preflight.test.mjs': testSource([
      'CLI reads one bounded JSON observation from stdin and writes no mutation claim',
      'CLI exits 2 for a blocked preflight while still returning the rollback packet',
      'CLI rejects malformed JSON without emitting a packet',
      'CLI entrypoint detection handles Windows paths without depending on file URL spelling',
    ]),
    'shared/agents/openClawUpdatePreflightV1.mjs': [
      "const STATUS = { APPROVAL_REQUIRED: 'APPROVAL_REQUIRED', BLOCKED_WITH_RESTORE_PATH: 'BLOCKED_WITH_RESTORE_PATH' };",
      "const CLASS = { MANUAL_ONLY: 'MANUAL_ONLY' };",
      'const SECRET_PATH_PATTERN = /secret/;',
      "const OPENCLAW_GATEWAY_APPROVED_ENDPOINT = 'http://127.0.0.1:18789';",
      "const OPENCLAW_GATEWAY_STARTUP_SOURCE = 'source';",
      'getOpenClawGatewayStartupCommand();',
      'const safety = { mutationAllowed: false, updateAttempted: false, absolutePathsPublished: false };',
      "const dryRun = [{ action: 'REQUEST_EXACT_OPERATOR_APPROVAL' }];",
      "const rollback = [{ action: 'RESTORE_PREVIOUS_PINNED_OPENCLAW_PACKAGE' }, { action: 'RESTORE_PROTECTED_CONFIG_SOURCE_AND_RUNTIME_IDENTITIES' }];",
    ].join('\n'),
    'shared/agents/openClawUpdatePreflightV1.test.mjs': testSource([
      'builds a deterministic approval-required manifest without publishing absolute paths',
      'blocks unknown and secret-bearing inventory paths while retaining a rollback plan',
      'fails closed on gateway identity drift and unpinned update packets',
      'requires digests for protected identities but not rebuildable generated output',
      'rejects conflicting duplicate path identities with order-independent blocked evidence',
      'fails closed on links, malformed existence evidence, invalid sizes and stale absent digests',
      'reports no update needed when the pinned target version already matches',
    ]),
    ...overrides,
  };
}

function oc9Sources(overrides = {}) {
  const contents = oc9Contents(overrides);
  return OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1.map((path) => source(path, contents[path]));
}

function oc9Review({ lineageEvidence = lineage(), overrides = {} } = {}) {
  return analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1654,
    branch: OC9_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence,
    analysis: oc9Analysis(),
    sources: oc9Sources(overrides),
  });
}

test('successor specialist owns only the exact #2048 authority-bearing path', () => {
  assert.deepEqual(OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1, [PATH]);
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 2048,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: analysis(),
    sources: [],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.clean, false);
  assert.deepEqual(result.reviewedPaths, [PATH]);
  assert.equal(result.findings[0].code, 'battle-bridge-hardlink-exact-source-proof-invalid');
});

test('successor specialist refuses a different PR, branch, finding estate, or lineage', () => {
  for (const input of [
    { prNumber: 2049 },
    { branch: 'fix/other' },
    { analysis: { findings: [] } },
  ]) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
      repository: REPOSITORY,
      prNumber: 2048,
      branch: BRANCH,
      sourceHead: HEAD,
      baseSha: BASE,
      lineageEvidence: lineage(),
      analysis: analysis(),
      sources: [],
      ...input,
    });
    assert.equal(result.eligible, false);
    assert.equal(result.clean, false);
  }

  const stale = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 2048,
    branch: BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage({ liveMainAfterSha: '3333333333333333333333333333333333333333' }),
    analysis: analysis(),
    sources: [],
  });
  assert.equal(stale.eligible, true);
  assert.equal(stale.clean, false);
  assert.equal(stale.findings[0].code, 'battle-bridge-hardlink-reconciliation-lineage-invalid');
});

test('OC9 successor specialist reviews only the exact five-file #1654 estate and can return clean', () => {
  assert.deepEqual(OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1, [
    '.github/workflows/openclaw-update-preflight-proof.yml',
    'scripts/openclaw-update-preflight.mjs',
    'scripts/openclaw-update-preflight.test.mjs',
    'shared/agents/openClawUpdatePreflightV1.mjs',
    'shared/agents/openClawUpdatePreflightV1.test.mjs',
  ]);
  const result = oc9Review();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.finalVerdict, 'OPENCLAW_UPDATE_PREFLIGHT_SPECIALIST_CLEAN');
  assert.deepEqual(result.reviewedPaths, OPENCLAW_UPDATE_PREFLIGHT_SUCCESSOR_SPECIALIST_PATHS_V1);
  assert.equal(result.findings.length, 0);
  assert.equal(result.proofRefs.length, 5);
});

test('OC9 successor specialist accepts valid multi-commit ahead-only lineage', () => {
  const result = oc9Review({
    lineageEvidence: lineage({
      parents: ['3333333333333333333333333333333333333333'],
      comparison: { ...lineage().comparison, aheadBy: 3 },
    }),
  });
  assert.equal(result.clean, true);
});

test('OC9 successor specialist rejects any workflow write permission', () => {
  const baseWorkflow = oc9Contents()['.github/workflows/openclaw-update-preflight-proof.yml'];
  for (const widened of [
    `${baseWorkflow}\npermissions: write-all`,
    `${baseWorkflow}\njobs:\n  proof:\n    permissions:\n      id-token: write`,
    `${baseWorkflow}\njobs:\n  proof:\n    permissions: { contents: read, issues: write }`,
  ]) {
    const result = oc9Review({ overrides: { '.github/workflows/openclaw-update-preflight-proof.yml': widened } });
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'oc9-workflow-write-permission-forbidden'));
  }
});

test('OC9 successor specialist rejects dynamic child-process imports and process execution APIs', () => {
  const baseCli = oc9Contents()['scripts/openclaw-update-preflight.mjs'];
  for (const widened of [
    `${baseCli}\nconst child = await import('node:child_process');\nchild.execFileSync('powershell.exe', []);`,
    `${baseCli}\nconst child = require('child_process');\nchild.spawnSync('powershell.exe', []);`,
  ]) {
    const result = oc9Review({ overrides: { 'scripts/openclaw-update-preflight.mjs': widened } });
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'oc9-cli-process-filesystem-network-authority-forbidden'));
  }
});

test('OC9 successor specialist rejects markers moved into comments or inert strings', () => {
  const baseCli = oc9Contents()['scripts/openclaw-update-preflight.mjs'];
  const inertCli = baseCli.replace(
    'const result = buildOpenClawUpdatePreflightV1(input);',
    "const marker = 'buildOpenClawUpdatePreflightV1(input)';",
  );
  const cliResult = oc9Review({ overrides: { 'scripts/openclaw-update-preflight.mjs': inertCli } });
  assert.equal(cliResult.clean, false);
  assert.ok(cliResult.findings.some((item) => item.code === 'oc9-cli-canonical-model-call-missing'));

  const inertTests = [
    'CLI reads one bounded JSON observation from stdin and writes no mutation claim',
    'CLI exits 2 for a blocked preflight while still returning the rollback packet',
    'CLI rejects malformed JSON without emitting a packet',
    'CLI entrypoint detection handles Windows paths without depending on file URL spelling',
  ].map((title) => `'${title}';`).join('\n');
  const testResult = oc9Review({ overrides: { 'scripts/openclaw-update-preflight.test.mjs': inertTests } });
  assert.equal(testResult.clean, false);
  assert.ok(testResult.findings.some((item) => item.code === 'oc9-cli-test-mutation-denial-missing'));

  const model = oc9Contents()['shared/agents/openClawUpdatePreflightV1.mjs'];
  const commentedModel = model.replace(
    'const safety = { mutationAllowed: false, updateAttempted: false, absolutePathsPublished: false };',
    'const safety = { mutationAllowed: true, updateAttempted: false, absolutePathsPublished: false };\n// mutationAllowed: false',
  );
  const modelResult = oc9Review({ overrides: { 'shared/agents/openClawUpdatePreflightV1.mjs': commentedModel } });
  assert.equal(modelResult.clean, false);
  assert.ok(modelResult.findings.some((item) => item.code === 'oc9-model-mutation-denial-missing'));
});

test('OC9 successor specialist fails closed on stale lineage, widened source estate, or hidden authority', () => {
  const stale = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1654,
    branch: OC9_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage({ comparison: { ...lineage().comparison, behindBy: 1 } }),
    analysis: oc9Analysis(),
    sources: oc9Sources(),
  });
  assert.equal(stale.eligible, true);
  assert.equal(stale.clean, false);
  assert.equal(stale.findings[0].code, 'oc9-update-preflight-reconciliation-lineage-invalid');

  const widened = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1654,
    branch: OC9_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: oc9Analysis(),
    sources: [...oc9Sources(), source('extra.txt', 'extra')],
  });
  assert.equal(widened.clean, false);
  assert.ok(widened.findings.some((item) => item.code === 'oc9-update-preflight-source-evidence-estate-mismatch'));

  const hiddenAuthority = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    repository: REPOSITORY,
    prNumber: 1654,
    branch: OC9_BRANCH,
    sourceHead: HEAD,
    baseSha: BASE,
    lineageEvidence: lineage(),
    analysis: oc9Analysis(),
    sources: oc9Sources({
      'shared/agents/openClawUpdatePreflightV1.mjs': `${oc9Contents()['shared/agents/openClawUpdatePreflightV1.mjs']}\nspawn('powershell.exe')`,
    }),
  });
  assert.equal(hiddenAuthority.clean, false);
  assert.ok(hiddenAuthority.findings.some((item) => item.code === 'oc9-model-dynamic-execution-forbidden'));
});

{
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
    size: Buffer.byteLength(content),
    blobSha: sha1Blob(content),
    content,
  };
}

function analysis() {
  return {
    findings: OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
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
    [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[0]]: INDEX,
    [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[1]]: EXECUTOR,
    [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[2]]: GATEWAY,
    [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[3]]: EXECUTOR_TEST,
    [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[4]]: GATEWAY_TEST,
    [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[5]]: PLUGIN,
    ...overrides,
  };
  return OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1.map((path) => source(path, contents[path]));
}

function input(overrides = {}) {
  return { repository: REPOSITORY, prNumber: 1931, branch: CANONICAL_OC2_BRANCH, sourceHead: HEAD, baseSha: BASE, lineageEvidence: lineage(), analysis: analysis(), sources: sources(), ...overrides };
}

test('OC2 specialist cleanly reviews the exact closed OC2 surfaces', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true, JSON.stringify(result.findings));
  assert.equal(result.findings.length, 0);
});

test('OC2 specialist is not applicable to another PR, branch, or incomplete escalation', () => {
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({ prNumber: 1905 })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({ branch: 'replayed/oc2' })).eligible, false);
  const incomplete = analysis();
  incomplete.findings.pop();
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({ analysis: incomplete })).eligible, false);
});

test('OC2 specialist rejects every direct extra process route', () => {
  for (const injected of ['spawn(userExecutable, userArgs);', 'spawnSync(userExecutable, userArgs);', 'spawnSyncFn(userExecutable, userArgs);']) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({
      sources: sources({ [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[1]]: `${EXECUTOR}\n${injected}` }),
    }));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-unbounded-process-authority-forbidden'));
  }
});

test('OC2 specialist rejects aliased, bound, object, array, and property-stored process invocation', () => {
  for (const injected of [
    'const invoke = spawnSyncFn; invoke(userExecutable, userArgs);',
    'const invoke = spawnSyncFn.bind(null); invoke(userExecutable, userArgs);',
    'const holder = { run: spawnSyncFn }; holder.run(userExecutable, userArgs);',
    'const holder = [spawnSyncFn]; holder[0](userExecutable, userArgs);',
    'const holder = {}; holder.run = spawnSyncFn; holder.run(userExecutable, userArgs);',
  ]) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({
      sources: sources({ [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[1]]: `${EXECUTOR}\n${injected}` }),
    }));
    assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-unbounded-process-authority-forbidden'));
  }
});

test('OC2 specialist rejects authority checks preserved only in comments or decoys', () => {
  const weakened = EXECUTOR.replace('grant?.boundedActionCount !== 1', 'true')
    .concat('\n// grant?.boundedActionCount !== 1\nfunction decoy(){ return grant?.boundedActionCount !== 1; }');
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({
    sources: sources({ [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[1]]: weakened }),
  }));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-bounded-action-gate-missing'));
});

test('OC2 specialist binds rejecting predicates to their own consequent', () => {
  const weakened = EXECUTOR.replace('|| grant?.boundedActionCount !== 1', '|| false')
    .concat('\nfunction decoy(grant) { if (grant?.boundedActionCount !== 1) { audit(grant); } if (true) return false; }');
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({
    sources: sources({ [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[1]]: weakened }),
  }));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-bounded-action-gate-missing'));
});

test('OC2 specialist rejects direct, aliased, and computed additional gateway registrations', () => {
  const direct = INDEX.replace(
    'api.registerCommand',
    "api.registerGatewayMethod('unexpected.method', async () => ({}), { scope: 'operator.write' });\n  api.registerCommand",
  );
  const aliased = INDEX.replace(
    'api.registerCommand',
    "const add = api.registerGatewayMethod.bind(api); add('unexpected.method', async () => ({}), { scope: 'operator.write' });\n  api.registerCommand",
  );
  const computed = INDEX.replace(
    'api.registerCommand',
    "api['registerGatewayMethod']('unexpected.method', async () => ({}), { scope: 'operator.write' });\n  api.registerCommand",
  );
  for (const widened of [direct, aliased, computed]) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({
      sources: sources({ [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[0]]: widened }),
    }));
    assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-index-gateway-registration-set-not-closed'));
  }
});

test('OC2 specialist rejects filesystem and network authority widening including aliases, computed access, and dynamic imports', () => {
  for (const injected of [
    "writeFileSync('/tmp/outside', 'x');",
    "fetch('https://example.com');",
    "import http from 'node:http';\nhttp.get(url);",
    "import { writeFileSync as save } from 'node:fs';\nsave('/tmp/outside', 'x');",
    "const { get: send } = await import('node:https');\nsend(url);",
    "const moduleName = 'node:https'; const { get: send } = await import(moduleName); send(url);",
    "https['get'](url);",
    "fs['writeFileSync']('/tmp/outside', 'x');",
  ]) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({
      sources: sources({ [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[1]]: `${EXECUTOR}\n${injected}` }),
    }));
    assert.equal(result.clean, false);
  }
});

test('OC2 specialist rejects skipped, commented, early-return, return-expression, and nested advertised regressions', () => {
  const variants = [
    EXECUTOR_TEST.replace("test('OC2 admits only", "test.skip('OC2 admits only"),
    EXECUTOR_TEST.replace('assert.deepEqual(result.changedFiles, []);', '// assert.deepEqual(result.changedFiles, []);'),
    EXECUTOR_TEST.replace('assert.deepEqual(result.changedFiles, []);', 'return; assert.deepEqual(result.changedFiles, []);'),
    EXECUTOR_TEST.replace('assert.deepEqual(result.changedFiles, []);', 'return false; assert.deepEqual(result.changedFiles, []);'),
    EXECUTOR_TEST.replace('assert.deepEqual(result.changedFiles, []);', '(() => { assert.deepEqual(result.changedFiles, []); })();'),
  ];
  for (const weakened of variants) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({
      sources: sources({ [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[3]]: weakened }),
    }));
    assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-test-active-regression-missing'));
  }
});

test('OC2 specialist rejects executor calls outside the registered OC2 callback and executor aliases', () => {
  const variants = [
    INDEX.replace('api.registerCommand', 'executeOpenClawOc2GatewayRequest({}, {});\n  api.registerCommand'),
    INDEX.replace('api.registerCommand', 'const runOc2 = executeOpenClawOc2GatewayRequest; runOc2({}, {});\n  api.registerCommand'),
    INDEX.replace(
      'api.registerCommand',
      'Reflect.apply(executeOpenClawOc2GatewayRequest, null, [params, { gatewayRuntimeContext: gatewayContext(OPENCLAW_OC2_GATEWAY_METHOD) }]);\n  api.registerCommand',
    ),
  ];
  for (const widened of variants) {
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({
      sources: sources({ [OPENCLAW_OC2_SUCCESSOR_SPECIALIST_PATHS_V1[0]]: widened }),
    }));
    assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-index-executor-binding-incomplete'));
  }
});

test('OC2 specialist fails closed on source evidence drift', () => {
  const drifted = sources();
  drifted[0] = { ...drifted[0], blobSha: 'c'.repeat(40) };
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input({ sources: drifted }));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-oc2-source-evidence-invalid'));
});
}
