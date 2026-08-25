import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SUCCESSOR_PR = 1999;
const SUCCESSOR_HEAD = '76ef0a47750275ac48a3cfafa11ec9b7843e7304';
const SUCCESSOR_BASE = 'f60765af26d44f73290e148e882ec13f608a7087';

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function providerPoolCoreContentFor(path) {
  if (path.endsWith('/openClawProviderPoolQualificationV1.mjs')) return `
${'import'} { routeMissionControllerCapacity } from './missionControllerCapacityRouterV1.mjs';
${'import'} { createHash as allowedHash } from 'node:crypto';
${'import'} { toSharedWorkspaceExecutionReceipt, validateExecutionReceipt as allowedReceipt } from './executionReceiptV1.mjs';
${'import'} { validateSharedWorkspaceRecord as allowedWorkspace } from './sharedAgentWorkspaceStore.mjs';
const OPENCLAW_QUALIFICATION_ISSUE = 1725;
function canonicalJson(value) { return JSON.stringify(value); }
function snapshot(value) { return value; }
function blockedAuthority(reason) { return { valid: false, reason }; }
export function validateOpenClawQualificationAuthorityChain(input, trustedHostContext, expected = {}) {
  const host = snapshot(trustedHostContext);
  const execution = host.realWorkExecutionReceipt;
  const canonicalWorkspace = toSharedWorkspaceExecutionReceipt(execution);
  const authority = host.qualificationAuthorityReceipt;
  allowedReceipt(execution, { issueNumber: OPENCLAW_QUALIFICATION_ISSUE });
  allowedWorkspace(authority);
  if (execution.workerType !== 'openclaw'
    || execution.state !== 'completed'
    || execution.operatorActionRequired !== false
    || canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)
    || authority.participantId !== 'stephanos'
    || authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)
    || authority.receivedRecordId !== execution.receiptId
    || authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION) return blockedAuthority('OPENCLAW_PRODUCTION_ELIGIBILITY_AUTHORITY_INVALID');
  const proofRefs = [];
  return Object.freeze({
    valid: true,
    reason: 'OPENCLAW_QUALIFICATION_AUTHORITY_CHAIN_VALID',
    authorityReceiptId: authority.receiptId,
    realWorkReceiptId: execution.receiptId,
    proofRefs,
  });
}
export function validateOpenClawProviderCapacity(candidate, expected = {}) {
  return candidate.qualificationAuthorityReceiptId === expected.authorityReceiptId;
}
export function routeWithQualifiedOpenClawProvider(input = {}, trustedHostContext = {}) {
  const base = routeMissionControllerCapacity(input);
  const preference = 'AUTO';
  const expected = {};
  const host = snapshot(trustedHostContext);
  const qualification = validateOpenClawProviderQualification(host?.qualificationReceipt, expected);
  const authority = { valid: Boolean(host.qualificationAuthorityReceipt) };
  const capacity = { valid: Boolean(host.capacityReceipt), receipt: { workerId: 'openclaw', receiptId: 'capacity', proofRefs: [] } };
  const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;
  const explicitOpenClawPreference = false;
  const baseUnavailable = false;
  const selectOpenClaw = openClawPoolEligible && (explicitOpenClawPreference || baseUnavailable);
  return Object.freeze({
    ...base,
    route: OPENCLAW_PROVIDER_ROUTE,
    adapter: OPENCLAW_PROVIDER_ADAPTER,
    workerId: capacity.receipt.workerId,
    dispatchAllowed: true,
    selectedCapacityReceiptId: capacity.receipt.receiptId,
    selectedQualificationReceiptId: qualification.receipt.qualificationId,
    selectedQualificationAuthorityReceiptId: authority.authorityReceiptId,
    proofRefs: Object.freeze([...new Set([
      ...authority.proofRefs,
      ...capacity.receipt.proofRefs,
    ])]),
    blockers: Object.freeze([]),
    providerPoolPreference: preference,
    openClawPoolEligible: true,
    openClawQualification: qualification,
    openClawQualificationAuthority: authority,
    openClawCapacity: capacity,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
    finalVerdict: 'MISSION_CONTROLLER_OPENCLAW_POOL_ROUTE_READY',
  });
}
`;
  if (path.endsWith('/openClawProviderPoolQualificationV1.test.mjs')) return `
${'import'} assert from 'node:assert/strict';
${'import'} test from 'node:test';
const result = { mergeAuthority: false, leaseSeizureAllowed: false, duplicateDispatchAllowed: false };
test('requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt', () => {});
test('capacity is unusable without the exact validated qualification authority, worker and task class', () => {});
test('caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw', () => {});
test('syntactically valid trusted qualification without canonical authority cannot route', () => {});
test('existing mutation owner is preserved even when OpenClaw is canonically qualified', () => {});
test('normal AUTO routing does not silently replace a healthy existing provider policy', () => {});
assert.equal(result.mergeAuthority, false);
assert.equal(result.leaseSeizureAllowed, false);
assert.equal(result.duplicateDispatchAllowed, false);
`;
  throw new Error(`unexpected provider-pool core path ${path}`);
}

function analysis(paths = OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1) {
  return {
    findings: paths.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      path,
    })),
  };
}

function sources(head = SUCCESSOR_HEAD) {
  return OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.map((path) => {
    const content = providerPoolCoreContentFor(path);
    return {
      schemaVersion: 'stephanos.windows-authority-source.v1',
      repository: REPOSITORY,
      path,
      ref: head,
      exists: true,
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    };
  });
}

function lineage(head = SUCCESSOR_HEAD, base = SUCCESSOR_BASE, overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository: REPOSITORY,
    sourceHead: head,
    sourceCommitSha: head,
    baseSha: base,
    liveMainBeforeSha: base,
    liveMainAfterSha: base,
    parents: ['1111111111111111111111111111111111111111', base],
    comparison: {
      status: 'ahead',
      aheadBy: 1,
      behindBy: 0,
      baseCommitSha: base,
      mergeBaseCommitSha: base,
    },
    ...overrides,
  };
}

function successorInput(overrides = {}) {
  return {
    repository: REPOSITORY,
    prNumber: SUCCESSOR_PR,
    branch: 'codex/five-builder-flywheel-repair',
    sourceHead: SUCCESSOR_HEAD,
    baseSha: SUCCESSOR_BASE,
    lineageEvidence: lineage(),
    analysis: analysis(),
    sources: sources(),
    ...overrides,
  };
}

function analyzeProviderPoolInjection(injection) {
  const hostileSources = sources();
  const content = `${hostileSources[0].content}\n${injection}\n`;
  hostileSources[0] = {
    ...hostileSources[0],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  return analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
}

function analyzeProviderPoolTestInjection(injection) {
  const hostileSources = sources();
  const content = `${hostileSources[1].content}\n${injection}\n`;
  hostileSources[1] = {
    ...hostileSources[1],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  return analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
}

test('standalone successor specialist covers only the exact two-file provider-pool core escalation', () => {
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput());
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.deepEqual(result.reviewedPaths, OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1);
  assert.equal(result.proofRefs.length, OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length);
  assert.equal(result.finalVerdict, 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_CLEAN');
});

test('successor profile rejects invalid PR identity, unsafe branch identity, incomplete scope and widened four-file scope', () => {
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ prNumber: 0 })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ prNumber: 1905 })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ prNumber: 1910 })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ branch: '../escape' })).eligible, false);
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({
    analysis: analysis(OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.slice(0, 1)),
  })).eligible, false);

  const widened = [
    ...OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
    'shared/agents/openClawTaskClassPromotionCandidateV1.mjs',
    'shared/agents/openClawTaskClassPromotionCandidateV1.test.mjs',
  ];
  assert.equal(analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({
    analysis: analysis(widened),
  })).eligible, false);
});

test('successor profile remains exact-lineage and exact-source bound', () => {
  const linearSuccessor = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({
    lineageEvidence: lineage(SUCCESSOR_HEAD, SUCCESSOR_BASE, {
      parents: ['1111111111111111111111111111111111111111'],
    }),
  }));
  assert.equal(linearSuccessor.clean, true);

  const movedMain = '2222222222222222222222222222222222222222';
  const drift = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({
    lineageEvidence: lineage(SUCCESSOR_HEAD, SUCCESSOR_BASE, { liveMainAfterSha: movedMain }),
  }));
  assert.equal(drift.eligible, true);
  assert.equal(drift.clean, false);
  assert.equal(drift.findings[0].code, 'openclaw-provider-pool-reconciliation-lineage-invalid');

  const tampered = sources();
  tampered[0] = { ...tampered[0], blobSha: '3333333333333333333333333333333333333333' };
  const badSource = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: tampered }));
  assert.equal(badSource.eligible, true);
  assert.equal(badSource.clean, false);
  assert.ok(badSource.findings.some((item) => item.code === 'openclaw-provider-pool-source-evidence-invalid'));

  for (const parents of [
    [],
    [SUCCESSOR_HEAD],
    ['1111111111111111111111111111111111111111', '1111111111111111111111111111111111111111'],
    ['1111111111111111111111111111111111111111', '2222222222222222222222222222222222222222', '3333333333333333333333333333333333333333'],
  ]) {
    const invalidParents = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({
      lineageEvidence: lineage(SUCCESSOR_HEAD, SUCCESSOR_BASE, { parents }),
    }));
    assert.equal(invalidParents.clean, false);
    assert.equal(invalidParents.findings[0].code, 'openclaw-provider-pool-reconciliation-lineage-invalid');
  }
});

test('successor profile lexically rejects aliased, commented, escaped, dynamic, and process-builtin authority', () => {
  for (const processImport of [
    "import { spawn as run } from 'child_process'; run('cmd.exe');",
    "import { execFile as run } from 'node:child_process'; run('cmd.exe');",
    "const { spawn: run } = await import('child_process'); run('cmd.exe');",
    "const { spawn: run } = await import /* comment */ ('node:child_process'); run('cmd.exe');",
    "const { spawn: run } = await import('child_pro\\u0063ess'); run('cmd.exe');",
    "const moduleName = 'child_' + 'process'; const { spawn: run } = await import(moduleName); run('cmd.exe');",
    "process.getBuiltinModule('child_process').spawn('cmd.exe');",
    "const result = `${await import /* comment */ ('node:child_process')}`;",
    "import { request as send } from 'node:https'; send('https://example.invalid');",
    "globalThis['process']['getBuiltin' + 'Module']('child_' + 'process');",
    "globalThis['pro' + 'cess']['getBuiltin' + 'Module']('child_' + 'pro' + 'cess')['sp' + 'awn']('cmd.exe');",
    "globalThis[('pro' + ('ce' + 'ss'))]['getBuiltin' + 'Module']('child_' + ('pro' + 'cess'));",
    "export function widened(injected) { injected['sp' + 'awn']('cmd.exe'); }",
    "export function widened(injected, empty) { injected['sp' + empty + 'awn']('cmd.exe'); }",
    "export function widened(injected, empty) { const run = injected['sp' + empty + 'awn']; run('cmd.exe'); }",
    "export function widened(injected) { injected['exec' + 'FileSync']('cmd.exe'); }",
    "export function widened(injected) { injected[`sp${''}awn`]('cmd.exe'); }",
    "export function widened(injected, maybe) { injected[`sp${maybe}awn`]('cmd.exe'); }",
    "export function widened(injected) { injected[`sp\\u0061wn`]('cmd.exe'); }",
    "const moduleName = `child_${''}process`; const { run } = await import(moduleName); run('cmd.exe');",
    "const moduleName = `${`child_`}${`process`}`; const { run } = await import(moduleName); run('cmd.exe');",
    "const make = (() => {}).constructor; make('return globalThis')();",
    "const load = globalThis['require']; load('child_' + 'process');",
    "const innocent = /[/*]/; const result = await import /* comment */ ('node:child_process');",
  ]) {
    const result = analyzeProviderPoolInjection(processImport);
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
  }
});

test('successor profile rejects direct global network execution without rejecting inert network text', () => {
  const hostile = analyzeProviderPoolInjection("export async function widened() { return fetch('https://example.invalid'); }");
  assert.equal(hostile.clean, false);
  assert.ok(hostile.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));

  for (const benignSource of [
    "const networkFixture = Object.freeze({ operation: 'fetch', url: 'https://example.invalid' });",
    "const client = {}; client.fetch();",
    "const helper = { render() { return 'proof'; } }; helper['render']();",
    "const helper = {}; const detached = helper['render'];",
    `const helper = {}; helper[\`render-${'${mode}'}\`]();`,
    `const helper = {}; const detached = helper[\`render-${'${mode}'}\`];`,
    `const proofRef = \`proofs/openclaw/${'${receiptId}'}\`;`,
  ]) {
    const benign = analyzeProviderPoolInjection(benignSource);
    assert.equal(benign.clean, true, `${benignSource}: ${JSON.stringify(benign.findings)}`);
  }
});

test('postfix increment and decrement keep following division executable rather than hiding it as a regex', () => {
  for (const postfix of ['++', '--']) {
    const result = analyzeProviderPoolInjection(`
      let quotient = 1;
      quotient${postfix} / process.getBuiltinModule('child_process').spawn('cmd.exe') / 2;
    `);
    assert.equal(result.clean, false, postfix);
    assert.ok(result.findings.some((item) => (
      item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'
    )), postfix);
  }
});

test('successful authority and route returns must be gate-dominated and match the closed return contract', () => {
  const hostileSources = sources();
  const content = hostileSources[0].content
    .replace(
      'export function validateOpenClawQualificationAuthorityChain(input, trustedHostContext, expected = {}) {',
      `export function validateOpenClawQualificationAuthorityChain(input, trustedHostContext, expected = {}) {
        return { valid: true };`,
    )
    .replace(
      'export function routeWithQualifiedOpenClawProvider(input = {}, trustedHostContext = {}) {',
      `export function routeWithQualifiedOpenClawProvider(input = {}, trustedHostContext = {}) {
        return { mergeAuthority: true, leaseSeizureAllowed: true, duplicateDispatchAllowed: true };`,
    );
  hostileSources[0] = {
    ...hostileSources[0],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-authority-return-shape-invalid'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-route-return-shape-invalid'));
});

test('an otherwise valid success return cannot be copied ahead of its authority gates', () => {
  const hostileSources = sources();
  const authoritySuccess = hostileSources[0].content.match(
    /return Object\.freeze\(\{\n    valid: true,[\s\S]*?\n  \}\);/,
  )?.[0];
  const routeSuccess = hostileSources[0].content.match(
    /return Object\.freeze\(\{\n    \.\.\.base,\n    route: OPENCLAW_PROVIDER_ROUTE,[\s\S]*?finalVerdict: 'MISSION_CONTROLLER_OPENCLAW_POOL_ROUTE_READY',\n  \}\);/,
  )?.[0];
  assert.ok(authoritySuccess);
  assert.ok(routeSuccess);
  const content = hostileSources[0].content
    .replace(
      'export function validateOpenClawQualificationAuthorityChain(input, trustedHostContext, expected = {}) {',
      `export function validateOpenClawQualificationAuthorityChain(input, trustedHostContext, expected = {}) {
        ${authoritySuccess}`,
    )
    .replace(
      'export function routeWithQualifiedOpenClawProvider(input = {}, trustedHostContext = {}) {',
      `export function routeWithQualifiedOpenClawProvider(input = {}, trustedHostContext = {}) {
        ${routeSuccess}`,
    );
  hostileSources[0] = {
    ...hostileSources[0],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-authority-success-not-gate-dominated'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-route-success-not-gate-dominated'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-authority-success-return-count-invalid'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-route-success-return-count-invalid'));
});

test('a line terminator after return cannot attach the following success expression', () => {
  for (const returnPrefix of ['return\n  ', 'return /*\n  */ ', 'return // detached\n  ']) {
    const hostileSources = sources();
    const content = hostileSources[0].content.replace(
      'return Object.freeze({\n    valid: true,',
      `${returnPrefix}Object.freeze({\n    valid: true,`,
    );
    hostileSources[0] = {
      ...hostileSources[0],
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    };
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
    assert.equal(result.clean, false, returnPrefix);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-authority-return-shape-invalid'));
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-authority-success-return-count-invalid'));
  }
});

test('successor profile requires authority gates in executable function structure rather than comments', () => {
  const hostileSources = sources();
  const content = hostileSources[0].content
    .replace("execution.workerType !== 'openclaw'", "true /* execution.workerType !== 'openclaw' */")
    .replace('const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid;', `
      /* const openClawPoolEligible = qualification.valid && authority.valid && capacity.valid; */
      const openClawPoolEligible = true;`)
    .replace('mergeAuthority: false', '/* mergeAuthority: false */ mergeAuthority: true')
    .replace('leaseSeizureAllowed: false', '/* leaseSeizureAllowed: false */ leaseSeizureAllowed: true');
  hostileSources[0] = {
    ...hostileSources[0],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-worker-type-binding-missing'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-complete-chain-gate-missing'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-merge-denial-missing'));
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-lease-denial-missing'));
});

test('successor profile applies execution and filesystem authority review to the test source', () => {
  for (const injection of [
    "import { execFileSync as run } from 'node:child_process'; run('cmd.exe');",
    "import { spawn as launch } from 'child_process'; launch('powershell.exe');",
    "import { writeFile as save } from 'node:fs/promises'; save('outside.json', 'authority');",
    "const { execFileSync: run } = await import('node:child_process'); run('cmd.exe');",
    "const load = process.getBuiltinModule('node:child_process'); load.execSync('cmd.exe');",
    "import { readMissionControllerCapacityRoutingInput as readHost } from '../../stephanos-server/services/programmeAuthorityService.js'; readHost({});",
  ]) {
    const result = analyzeProviderPoolTestInjection(injection);
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
  }
});

test('successor profile preserves inert authority-name strings used as deterministic test data', () => {
  const result = analyzeProviderPoolTestInjection(`
    const inertFixture = Object.freeze({
      operation: 'spawn',
      specifier: 'node:child_process',
      sample: "execFileSync('cmd.exe')",
      template: \`globalThis['process']\`,
    });
    assert.equal(inertFixture.operation, 'spawn');
  `);
  assert.equal(result.clean, true);
});

test('successor profile allows only exact non-mutating imports from approved local modules', () => {
  for (const injection of [
    "import { writeAtomicJson as save } from './sharedAgentWorkspaceStore.mjs'; save(root, ['escape'], {});",
    "import { ensureSharedWorkspaceLayout as prepare } from './sharedAgentWorkspaceStore.mjs'; prepare({ root });",
    "import workspaceStore from './sharedAgentWorkspaceStore.mjs'; workspaceStore.writeAtomicJson(root, ['escape'], {});",
    "import * as workspaceStore from './sharedAgentWorkspaceStore.mjs'; workspaceStore.writeAtomicJson(root, ['escape'], {});",
  ]) {
    const result = analyzeProviderPoolInjection(injection);
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
  }
});

test('every split point of authority names remains visible through static and dynamic template substitutions', () => {
  for (const authorityName of [
    'AsyncFunction',
    'Bun',
    'Deno',
    'Function',
    'WebAssembly',
    '_linkedBinding',
    'binding',
    'child_process',
    'constructor',
    'createRequire',
    'dlopen',
    'eval',
    'exec',
    'execFile',
    'execFileSync',
    'execSync',
    'fork',
    'fs',
    'fs/promises',
    'getBuiltinModule',
    'global',
    'globalThis',
    'module',
    'node:child_process',
    'node:fs',
    'node:fs/promises',
    'node:module',
    'process',
    'require',
    'spawn',
    'spawnSync',
  ]) {
    for (let split = 1; split < authorityName.length; split += 1) {
      const left = authorityName.slice(0, split);
      const right = authorityName.slice(split);
      for (const substitution of ["${''}", '${maybe}']) {
        const result = analyzeProviderPoolInjection(`export function widened(injected, maybe) { injected[\`${left}${substitution}${right}\`]('cmd.exe'); }`);
        assert.equal(result.clean, false, `${authorityName}:${split}:${substitution}`);
        assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
      }
    }
  }
});

test('successor template analysis preserves benign dynamic proof strings', () => {
  const benignSources = sources();
  const content = `${benignSources[0].content}\nconst proofRef = \`proofs/openclaw/${'${receiptId}'}\`;\n`;
  benignSources[0] = {
    ...benignSources[0],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: benignSources }));
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
});
