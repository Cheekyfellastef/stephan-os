import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';
import { buildIndependentReviewFindingsArtifact } from './operatorMergeReviewArtifactV1.mjs';

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
${'import'} { toSharedWorkspaceExecutionReceipt, validateExecutionReceipt } from './executionReceiptV1.mjs';
${'import'} { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';
const OPENCLAW_QUALIFICATION_ISSUE = 1725;
function canonicalJson(value) { return JSON.stringify(value); }
function snapshot(value) { return value; }
function blockedAuthority(reason) {
  return Object.freeze({
    valid: false,
    reason,
    authorityReceiptId: '',
    realWorkReceiptId: '',
    proofRefs: Object.freeze([]),
  });
}
export function validateOpenClawQualificationAuthorityChain(input, trustedHostContext, expected = {}) {
  const qualification = input;
  const host = snapshot(trustedHostContext);
  const execution = host.realWorkExecutionReceipt;
  const canonicalWorkspace = toSharedWorkspaceExecutionReceipt(execution);
  const authority = host.qualificationAuthorityReceipt;
  const executionValidation = validateExecutionReceipt(execution, {
    repository: expected.repository,
    issueNumber: OPENCLAW_QUALIFICATION_ISSUE,
    expectedHead: expected.sourceHead,
    executionId: qualification.receipt.realWorkTaskId,
  });
  validateSharedWorkspaceRecord(authority);
  if (!executionValidation.valid
    || execution.workerType !== 'openclaw'
    || execution.state !== 'completed'
    || execution.operatorActionRequired !== false
    || canonicalJson(host.realWorkWorkspaceReceipt) !== canonicalJson(canonicalWorkspace.record)
    || authority.participantId !== 'stephanos'
    || authority.relatedIssue !== String(OPENCLAW_QUALIFICATION_ISSUE)
    || authority.receivedRecordId !== execution.receiptId
    || authority.disposition !== OPENCLAW_PRODUCTION_ELIGIBLE_DISPOSITION) {
    return blockedAuthority('OPENCLAW_PRODUCTION_ELIGIBILITY_AUTHORITY_INVALID');
  }
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
  if (!selectOpenClaw) {
    const blockers = [];
    return Object.freeze({
      ...base,
      providerPoolPreference: preference,
      openClawPoolEligible,
      openClawQualification: qualification,
      openClawQualificationAuthority: authority,
      openClawCapacity: capacity,
      providerPoolBlockers: Object.freeze(blockers),
    });
  }
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
${'import'} {
  OPENCLAW_PROVIDER_ROUTE,
  routeWithQualifiedOpenClawProvider,
  validateOpenClawProviderCapacity,
  validateOpenClawQualificationAuthorityChain,
} from './openClawProviderPoolQualificationV1.mjs';
test('requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt', () => {
  assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), trustedHostContext(), expected).valid, true);
  assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), trustedHostContext({}), expected).valid, false);
});
test('capacity is unusable without the exact validated qualification authority, worker and task class', () => {
  assert.equal(validateOpenClawProviderCapacity(capacity(), expected).valid, true);
  assert.equal(validateOpenClawProviderCapacity(capacity({ qualificationIds: ['foreign-qualification'] }), expected).valid, false);
});
test('caller-shaped qualification, capacity and fake authority evidence cannot self-admit OpenClaw', () => {
  const result = routeWithQualifiedOpenClawProvider(routeInput());
  assert.notEqual(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.equal(result.openClawPoolEligible, false);
});
test('syntactically valid trusted qualification without canonical authority cannot route', () => {
  const result = routeWithQualifiedOpenClawProvider(routeInput());
  assert.notEqual(result.route, OPENCLAW_PROVIDER_ROUTE);
  assert.ok(result.providerPoolBlockers.includes('openclaw-qualification-authority-not-proven'));
});
test('existing mutation owner is preserved even when OpenClaw is canonically qualified', () => {
  const result = routeWithQualifiedOpenClawProvider(routeInput());
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.adapter, 'chatgpt-github');
});
test('normal AUTO routing does not silently replace a healthy existing provider policy', () => {
  const result = routeWithQualifiedOpenClawProvider(routeInput());
  assert.equal(result.route, 'CODEX');
  assert.equal(result.openClawPoolEligible, true);
});
test('selects canonically qualified OpenClaw before Codex exhaustion when the scheduler prefers it', () => {
  const result = routeWithQualifiedOpenClawProvider(routeInput());
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.leaseSeizureAllowed, false);
  assert.equal(result.duplicateDispatchAllowed, false);
});
`;
  throw new Error(`unexpected provider-pool core path ${path}`);
}

function analysis(paths = OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1) {
  const findings = paths.map((path) => ({
      severity: 'P0',
      code: 'unsupported-high-risk-surface',
      summary: 'This high-risk surface requires a separate qualified specialist reviewer.',
      path,
    }));
  return {
    schemaVersion: 'stephanos.independent-security-analysis.v1',
    findings,
    counts: { P0: findings.length, P1: 0, P2: 0 },
    verdict: 'findings',
    proofRefs: paths.map((path) => `proofs/changed-file/${path}`),
    finalVerdict: 'INDEPENDENT_SECURITY_REVIEW_FINDINGS',
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
  const input = {
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
  if (!Object.hasOwn(overrides, 'findingsArtifactEvidence')) {
    let artifact;
    try {
      artifact = buildIndependentReviewFindingsArtifact({
        repository: input.repository,
        prNumber: input.prNumber,
        branch: input.branch,
        sourceHead: input.sourceHead,
        baseSha: input.baseSha,
        workflowRunId: 32911603137,
        workflowRunAttempt: 1,
        createdAtUtc: '2026-08-25T23:37:50.352Z',
        analysis: input.analysis,
      });
    } catch {
      artifact = buildIndependentReviewFindingsArtifact({
        repository: REPOSITORY,
        prNumber: SUCCESSOR_PR,
        branch: 'codex/five-builder-flywheel-repair',
        sourceHead: SUCCESSOR_HEAD,
        baseSha: SUCCESSOR_BASE,
        workflowRunId: 32911603137,
        workflowRunAttempt: 1,
        createdAtUtc: '2026-08-25T23:37:50.352Z',
        analysis: input.analysis,
      });
    }
    input.analysis = artifact.analysis;
    input.findingsArtifactEvidence = artifact;
  }
  return input;
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
  assert.equal(result.proofRefs.length, OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.length + 1);
  assert.equal(result.finalVerdict, 'OPENCLAW_BUILDER_PROVIDER_SPECIALIST_CLEAN');
});

test('trusted provider bindings cannot be shadowed or reassigned behind matching authority tokens', () => {
  const hostileSources = sources();
  const content = hostileSources[0].content.replace(
    'export function validateOpenClawQualificationAuthorityChain(input, trustedHostContext, expected = {}) {',
    `export function validateOpenClawQualificationAuthorityChain(input, trustedHostContext, expected = {}) {
      const snapshot = () => ({
        realWorkExecutionReceipt: { receiptId: 'forged' },
        realWorkWorkspaceReceipt: {},
        qualificationAuthorityReceipt: {},
      });
      const validateExecutionReceipt = () => ({ valid: true });
      const toSharedWorkspaceExecutionReceipt = () => ({ record: {} });
      input = { receipt: { realWorkTaskId: 'forged' } };`,
  );
  hostileSources[0] = {
    ...hostileSources[0],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => (
    item.code === 'openclaw-provider-pool-trusted-binding-resolution-invalid'
  )));

  const destructuringSources = sources();
  const destructuringContent = destructuringSources[0].content.replace(
    'const qualification = input;',
    `({ validateExecutionReceipt } = attackerBindings);
  const qualification = input;`,
  );
  destructuringSources[0] = {
    ...destructuringSources[0],
    size: Buffer.byteLength(destructuringContent, 'utf8'),
    blobSha: blobSha(destructuringContent),
    content: destructuringContent,
  };
  const destructuring = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({
    sources: destructuringSources,
  }));
  assert.equal(destructuring.clean, false);
  assert.ok(destructuring.findings.some((item) => (
    item.code === 'openclaw-provider-pool-trusted-binding-resolution-invalid'
  )));
});

test('required test assertions must resolve to the trusted node assert binding', () => {
  const hostileSources = sources();
  const content = hostileSources[1].content.replaceAll(
    '() => {',
    `() => {
      const assert = Object.freeze({ equal() {}, notEqual() {}, ok() {} });`,
  );
  hostileSources[1] = {
    ...hostileSources[1],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => (
    item.code === 'openclaw-provider-pool-test-trusted-binding-resolution-invalid'
  )));
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

test('digest-bound review evidence cannot be replayed onto another PR or branch', () => {
  const exact = successorInput();
  const replayed = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1({
    ...exact,
    prNumber: SUCCESSOR_PR + 1,
    branch: 'codex/replayed-provider-review',
  });
  assert.equal(replayed.eligible, true);
  assert.equal(replayed.clean, false);
  assert.equal(replayed.findings[0].code, 'openclaw-provider-pool-review-artifact-identity-invalid');
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

test('computed authority remains visible across member, binding, and reflective access forms', () => {
  for (const hostileSource of [
    "export function widened(injected, empty) { const run = injected?.['sp' + empty + 'awn']; run?.('cmd.exe'); }",
    "export function widened(injected, empty) { const { ['sp' + empty + 'awn']: run } = injected; run('cmd.exe'); }",
    "export function widened(injected, empty) { function pick({ ['sp' + empty + 'awn']: run }) { run('cmd.exe'); } pick(injected); }",
    "export function widened(injected, empty) { const run = Reflect.get(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = Reflect?.get(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = Reflect['g' + empty + 'et'](injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = Reflect['g' + empty + 'et']?.(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = (Reflect['g' + empty + 'et'])?.(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = ((Reflect.get))?.(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = Reflect.get.call(null, injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = (Reflect['get']).call?.(null, injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = Reflect.get.apply(null, [injected, 'sp' + empty + 'awn']); run('cmd.exe'); }",
    "export function widened(injected, empty) { const getter = Reflect.get; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const getter = (0, Reflect.get); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const getter = (null, (false, Reflect.get)); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const getter = true && Reflect.get; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const getter = empty ? Reflect.get : () => null; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const getter = [Reflect.get][0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const getter = Reflect.get; const borrowed = getter; const run = borrowed.call(null, injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const getter = Reflect.get.bind(Reflect); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = Reflect.get.bind(Reflect, injected)('sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; [getter] = [Reflect.get]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; ([getter] = [(0, Reflect.get)]); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let ignored, getter; [ignored, getter] = [null, Reflect.get]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; [[getter]] = [[Reflect.get]]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; [getter = Reflect.get] = []; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; [[getter] = [Reflect.get]] = []; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; [{ get: getter } = Reflect] = []; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const R = Reflect; let getter; [{ get: getter } = R] = []; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; ({ get: getter } = Reflect); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let get; ({ get } = (Reflect)); const run = get(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const R = Reflect; let getter; ({ get: getter } = R); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const R0 = Reflect; const R1 = (0, R0); let getter; ({ get: getter } = ((R1))); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const methods = [Reflect.get]; let getter; [getter] = methods; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const methods0 = [Reflect.get]; const methods1 = (0, methods0); let getter; [getter] = methods1; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const groups = [[Reflect.get]]; let getter; [[getter]] = groups; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const receivers = [Reflect]; let R; [R] = receivers; let getter; ({ get: getter } = R); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const groups = [[Reflect.get]]; let methods; [methods] = groups; let getter; [getter] = methods; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const groups = [[Reflect]]; let receivers; [receivers] = groups; let R; [R] = receivers; let getter; ({ get: getter } = R); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getters; [...getters] = [Reflect.get]; const getter = getters[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const helper = { render() {} }; let getters; [, ...getters] = [helper.render, Reflect.get]; const getter = getters[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const helper = { render() {} }; const methods = [helper.render, Reflect.get]; let getters; [, ...getters] = methods; const getter = getters[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const groups = [[Reflect.get]]; let methods; [...methods] = groups; let getters; [...getters] = methods[0]; const getter = getters[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const methods = [Reflect.get]; const getter = methods[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const methods = [Reflect.get]; const getter = methods?.[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const methods = [Reflect.get]; const getter = (0, methods)[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const methods = [Reflect.get]; const getter = methods[empty]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const safe = []; const methods = [...safe, Reflect.get]; const getter = methods[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let methods = [Reflect.get]; methods = [helper.render]; const getter = methods[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; [getter = Reflect.get] = [undefined]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty, maybe) { let getter; [getter = Reflect.get] = [maybe]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let values = []; values = [helper.render]; let getter; [getter = Reflect.get] = values; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const receivers = [Reflect]; const R = receivers[0]; let getter; ({ get: getter } = R); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const groups = [[Reflect.get]]; const methods = groups[0]; let getter; [getter] = methods; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const { get: getter } = Reflect; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const { get } = Reflect; const run = get(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const { ['g' + empty + 'et']: getter } = Reflect; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const run = Object.getOwnPropertyDescriptor(injected, 'sp' + empty + 'awn').value; run('cmd.exe'); }",
  ]) {
    const result = analyzeProviderPoolInjection(hostileSource);
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false, hostileSource);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
  }
});

test('container value possibilities fail closed without activating unreachable defaults', () => {
  for (const hostileSource of [
    "export function widened(injected, empty, values) { const methods = [...values, helper.render]; const getter = methods[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty, values) { let getter; [getter] = [...values]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty, values) { let getter; [getter = Reflect.get] = [...values, helper.render]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty, maybe) { let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; maybe.value = undefined; let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; maybe['value'] = undefined; let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; delete maybe.value; let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const alias = maybe; alias.value = undefined; let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; Object.defineProperty(maybe, 'value', { value: undefined }); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); return maybe; }",
    "export function widened(injected, empty, maybe) { let getter; [getter = Reflect.get] = maybe; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; [{ render: getter = Reflect.get }] = [{}]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { let getter; [{ nested: { render: getter = Reflect.get } = {} }] = [{ nested: {} }]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty, values) { let getter; ({ render: getter } = { ...values }); const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
  ]) {
    const result = analyzeProviderPoolInjection(hostileSource);
    assert.equal(result.clean, false, hostileSource);
    assert.ok(result.findings.some((item) => (
      item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'
    )));
  }

  for (const benignSource of [
    "const helper = { render() {} }; let getter; [{ render: getter = Reflect.get }] = [{ render: helper.render }]; getter();",
    "let getter; [{ render: getter = Reflect.get }] = [{ render() {} }]; getter();",
    "const helper = { render() {} }; const safe = []; let getter; [getter = Reflect.get] = [...safe, helper.render]; getter();",
  ]) {
    const result = analyzeProviderPoolInjection(benignSource);
    assert.equal(result.clean, true, `${benignSource}: ${JSON.stringify(result.findings)}`);
  }
});

test('container value possibilities traverse every bounded source and target element', () => {
  for (const width of [31, 32, 33, 64]) {
    const safeValues = Array.from({ length: width - 1 }, () => 'helper.render');
    const indexedSource = `export function widened(injected, empty) { const helper = { render() {} }; const methods = [${[
      ...safeValues,
      'Reflect.get',
    ].join(',')}]; const getter = methods[${width - 1}]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }`;
    const indexedResult = analyzeProviderPoolInjection(indexedSource);
    assert.equal(indexedResult.clean, false, `indexed width ${width}`);
    assert.ok(indexedResult.findings.some((item) => (
      item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'
    )));

    const targets = [
      ...Array.from({ length: width - 1 }, (_, index) => `safe${index}`),
      'getter = Reflect.get',
    ];
    const destructuredSource = `export function widened(injected, empty) { const helper = { render() {} }; const [${targets.join(',')}] = [${[
      ...safeValues,
      'undefined',
    ].join(',')}]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }`;
    const destructuredResult = analyzeProviderPoolInjection(destructuredSource);
    assert.equal(destructuredResult.clean, false, `destructured width ${width}`);
    assert.ok(destructuredResult.findings.some((item) => (
      item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'
    )));

    const restSource = `export function widened(injected, empty) { const helper = { render() {} }; const methods = [${[
      ...safeValues,
      'Reflect.get',
    ].join(',')}]; let getters; [${Array.from({ length: width - 1 }, () => '').join(',')}, ...getters] = methods; const getter = getters[0]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }`;
    const restResult = analyzeProviderPoolInjection(restSource);
    assert.equal(restResult.clean, false, `rest width ${width}`);
    assert.ok(restResult.findings.some((item) => (
      item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'
    )));
  }
});

test('fixed numeric computed keys remain benign across JavaScript literal forms', () => {
  for (const benignSource of [
    "const receipts = []; const first = receipts[0];",
    "const receipts = []; const first = receipts?.[0];",
    "const receipts = []; const first = receipts[0x0];",
    "const receipts = []; const first = receipts[0Xf];",
    "const receipts = []; const first = receipts[0b0];",
    "const receipts = []; const first = receipts[0o0];",
    "const receipts = []; const first = receipts[0n];",
    "const receipts = []; const first = receipts[0xFF_FFn];",
    "const receipts = []; const first = receipts[1_000];",
    "const receipts = []; const first = receipts[1e3];",
    "const receipts = []; const first = receipts[.5];",
    "const receipts = []; const { [0x0]: first } = receipts;",
    "const receipts = []; const first = Reflect.get(receipts, 0n);",
  ]) {
    const result = analyzeProviderPoolInjection(benignSource);
    assert.equal(result.eligible, true);
    assert.equal(result.clean, true, `${benignSource}: ${JSON.stringify(result.findings)}`);
  }
});

test('successor profile rejects global network capabilities without rejecting inert network text', () => {
  for (const hostileSource of [
    "export async function widened() { return fetch('https://example.invalid'); }",
    "export function widened() { const socket = new WebSocket('wss://example.invalid'); socket.send('proof'); }",
    "export function widened(input) { return new input.WebSocket('wss://example.invalid'); }",
    "export function widened(input) { return new input['Web' + 'Socket']('wss://example.invalid'); }",
    "export function widened(input) { return input['fe' + 'tch']('https://example.invalid'); }",
    "export function widened() { return new EventSource('https://example.invalid/events'); }",
    "const client = {}; client.fetch();",
  ]) {
    const hostile = analyzeProviderPoolInjection(hostileSource);
    assert.equal(hostile.clean, false, hostileSource);
    assert.ok(hostile.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
  }

  for (const benignSource of [
    "const networkFixture = Object.freeze({ operation: 'fetch', url: 'https://example.invalid' });",
    "const client = { fetch() { return 'proof'; } }; client.fetch();",
    "const helper = { render() { return 'proof'; } }; helper['render']();",
    "const helper = {}; const detached = helper['render'];",
    "const helper = {}; const detached = helper?.['render']; detached?.();",
    "const helper = { render() {} }; const { ['render']: detached } = helper; detached();",
    "const helper = { render() {} }; const detached = Reflect.get(helper, 'render'); detached();",
    "const helper = { render() {} }; const detached = Reflect['get'](helper, 'render'); detached();",
    "const helper = { render() {} }; const detached = Reflect.get.call(null, helper, 'render'); detached();",
    "const helper = { render() {} }; const detached = Reflect.get.apply(null, [helper, 'render']); detached();",
    "const helper = { render() {} }; const getter = Reflect.get; const detached = getter(helper, 'render'); detached();",
    "const helper = { render() {} }; const getter = (0, Reflect.get); const detached = getter(helper, 'render'); detached();",
    "const helper = { render() {} }; const getter = Reflect.get.bind(Reflect); const detached = getter(helper, 'render'); detached();",
    "const helper = { render() {} }; const detached = Reflect.get.bind(Reflect)(helper, 'render'); detached();",
    "const helper = { render() {} }; const getter = Reflect.get.bind(Reflect, helper); const detached = getter('render'); detached();",
    "const helper = { render() {} }; const detached = Reflect.get.bind(Reflect, helper)('render'); detached();",
    "const helper = { render() {} }; let detached; [detached] = [helper.render]; detached();",
    "const helper = { render() {} }; let detached; ({ render: detached } = helper); detached();",
    "const helper = { render() {} }; const methods = [helper.render]; const alias = (0, methods); let detached; [detached] = alias; detached();",
    "const helper = { render() {} }; const methods = [helper.render, Reflect.get]; const detached = methods[0]; detached();",
    "const helper = { render() {} }; let methods; [...methods] = [helper.render]; const detached = methods[0]; detached();",
    "const helper = { render() {} }; let methods; [, ...methods] = [Reflect.get, helper.render]; const detached = methods[0]; detached();",
    "const helper = { render() {} }; const safe = []; const methods = [helper.render, ...safe, Reflect.get]; const detached = methods[0]; detached();",
    "const helper = { render() {} }; let getter; [getter = Reflect.get] = [helper.render]; getter();",
    "const helper = { render() {} }; let getter; [[getter] = [Reflect.get]] = [[helper.render]]; getter();",
    "const helper = { render() {} }; const receivers = [helper, Reflect]; const receiver = receivers[0]; let detached; ({ render: detached } = receiver); detached();",
    "let x; [{ x } = {}] = [input];",
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

test('authority predicates must be top-level failure guards rather than inert operands', () => {
  const hostileSources = sources();
  const content = hostileSources[0].content.replace(
    "|| execution.workerType !== 'openclaw'",
    "|| (false && execution.workerType !== 'openclaw')",
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
});

test('denial helper and execution receipt validation must have closed direct semantics that dominate success', () => {
  const validationBinding = `const executionValidation = validateExecutionReceipt(execution, {
    repository: expected.repository,
    issueNumber: OPENCLAW_QUALIFICATION_ISSUE,
    expectedHead: expected.sourceHead,
    executionId: qualification.receipt.realWorkTaskId,
  });`;
  for (const { mutate, code } of [
    {
      mutate: (content) => content.replace('valid: false,', 'valid: true,'),
      code: 'openclaw-provider-pool-blocked-authority-semantics-invalid',
    },
    {
      mutate: (content) => content.replace(
        validationBinding,
        `if (false) { ${validationBinding} }
        const executionValidation = Object.freeze({ valid: true });`,
      ),
      code: 'openclaw-provider-pool-execution-validator-missing',
    },
    {
      mutate: (content) => content.replace(
        '!executionValidation.valid',
        'false && (!executionValidation.valid)',
      ),
      code: 'openclaw-provider-pool-authority-success-not-gate-dominated',
    },
  ]) {
    const hostileSources = sources();
    const content = mutate(hostileSources[0].content);
    assert.notEqual(content, hostileSources[0].content, code);
    hostileSources[0] = {
      ...hostileSources[0],
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    };
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
    assert.equal(result.clean, false, code);
    assert.ok(result.findings.some((item) => item.code === code), JSON.stringify(result.findings));
  }
});

test('route success is structurally dominated by the negative provider-selection exit', () => {
  const hostileSources = sources();
  const requiredGuard = `  if (!selectOpenClaw) {
    const blockers = [];
    return Object.freeze({
      ...base,
      providerPoolPreference: preference,
      openClawPoolEligible,
      openClawQualification: qualification,
      openClawQualificationAuthority: authority,
      openClawCapacity: capacity,
      providerPoolBlockers: Object.freeze(blockers),
    });
  }
`;
  assert.ok(hostileSources[0].content.includes(requiredGuard));
  for (const replacement of [
    '',
    `  if (false) {\n${requiredGuard}  }\n`,
    `  if (false) ${requiredGuard}`,
    `  while (false) ${requiredGuard}`,
    `  for (; false;) ${requiredGuard}`,
    `  label: ${requiredGuard}`,
    requiredGuard.replace('return Object.freeze', 'if (false) return Object.freeze'),
    requiredGuard.replace('return Object.freeze', 'while (false) return Object.freeze'),
    requiredGuard.replace('if (!selectOpenClaw)', 'if (false && !selectOpenClaw)'),
  ]) {
    const content = hostileSources[0].content.replace(requiredGuard, replacement);
    const mutatedSources = [...hostileSources];
    mutatedSources[0] = {
      ...hostileSources[0],
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    };
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: mutatedSources }));
    assert.equal(result.clean, false, replacement);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-route-success-not-gate-dominated'));
  }
});

test('every JavaScript line terminator after return detaches the following success expression', () => {
  for (const returnPrefix of [
    'return\n  ',
    'return\r  ',
    'return\r\n  ',
    'return\u2028  ',
    'return\u2029  ',
    'return /*\n  */ ',
    'return /*\u2028*/ ',
    'return // detached\n  ',
    'return // detached\u2029  ',
  ]) {
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

test('property enumeration cannot recover caller-supplied execution authority', () => {
  for (const hostileSource of [
    "export function widened(input) { Object.values(input)[0]('cmd.exe'); }",
    "export function widened(input) { Object.entries(input)[0][1]('cmd.exe'); }",
    "export function widened(input) { Object.getOwnPropertyDescriptors(input).only.value('cmd.exe'); }",
    "export function widened(input) { const enumerate = Object['val' + 'ues']; enumerate(input)[0]('cmd.exe'); }",
    "export function widened(input) { const { values: enumerate } = Object; enumerate(input)[0]('cmd.exe'); }",
  ]) {
    const result = analyzeProviderPoolInjection(hostileSource);
    assert.equal(result.clean, false, hostileSource);
    assert.ok(result.findings.some((item) => (
      item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'
    )));
  }

  const keysOnly = analyzeProviderPoolInjection(
    'export function listKeys(input) { return Object.keys(input); }',
  );
  assert.equal(keysOnly.clean, true, JSON.stringify(keysOnly.findings));
});

test('required adversarial callbacks cannot be skipped or marked todo', () => {
  for (const option of ['skip', 'todo']) {
    const hostileSources = sources();
    const content = hostileSources[1].content.replaceAll(
      "', () => {",
      `', { ${option}: true }, () => {`,
    );
    assert.notEqual(content, hostileSources[1].content);
    hostileSources[1] = {
      ...hostileSources[1],
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    };
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
    assert.equal(result.clean, false, option);
    assert.ok(result.findings.some((item) => (
      item.code === 'openclaw-provider-pool-authority-chain-positive-test-missing'
    )), option);
  }
});

test('named adversarial tests require their executable assertions inside the corresponding callback', () => {
  const hostileSources = sources();
  const content = hostileSources[1].content.replace(
    /test\('requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt', \(\) => \{[\s\S]*?\n\}\);/,
    "test('requires canonical completed OpenClaw execution, exact Shared Workspace projection, and Stephanos promotion receipt', () => {});",
  );
  hostileSources[1] = {
    ...hostileSources[1],
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  };
  const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
  assert.equal(result.clean, false);
  assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-authority-chain-positive-test-missing'));
});

test('named adversarial assertions inside an unreachable callback branch do not count as proof', () => {
  const positive = 'assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), trustedHostContext(), expected).valid, true);';
  const negative = 'assert.equal(validateOpenClawQualificationAuthorityChain(qualification(), trustedHostContext({}), expected).valid, false);';
  for (const mutate of [
    (content) => content
      .replace(positive, `if (false) { ${positive} }`)
      .replace(negative, `if (false) { ${negative} }`),
    (content) => content.replace(positive, `if (true) return;\n  ${positive}`),
  ]) {
    const hostileSources = sources();
    const content = mutate(hostileSources[1].content);
    hostileSources[1] = {
      ...hostileSources[1],
      size: Buffer.byteLength(content, 'utf8'),
      blobSha: blobSha(content),
      content,
    };
    const result = analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(successorInput({ sources: hostileSources }));
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-authority-chain-positive-assertion-missing'));
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-authority-chain-negative-assertion-missing'));
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
    "export {} from 'data:text/javascript,globalThis.__probe__%3D1';",
    "export * from 'node:child_process';",
    "export { spawn as run } from 'node:child_process';",
    "export { writeAtomicJson as save } from './sharedAgentWorkspaceStore.mjs';",
    "export { createHash as safeHash } from 'node:crypto' with { type: 'json' };",
    "import { createHash as safeHash } from 'node:crypto' with { type: 'json' };",
  ]) {
    const result = analyzeProviderPoolInjection(injection);
    assert.equal(result.clean, false);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
  }

  const approvedReExport = analyzeProviderPoolInjection(
    "export { createHash as independentlyBoundHash } from 'node:crypto';",
  );
  assert.equal(approvedReExport.clean, true, JSON.stringify(approvedReExport.findings));
});

test('every split point of authority names remains visible across computed access forms', () => {
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
        for (const hostileSource of [
          `export function widened(injected, maybe) { injected[\`${left}${substitution}${right}\`]('cmd.exe'); }`,
          `export function widened(injected, maybe) { const { [\`${left}${substitution}${right}\`]: run } = injected; run('cmd.exe'); }`,
          `export function widened(injected, maybe) { const run = Reflect.get(injected, \`${left}${substitution}${right}\`); run('cmd.exe'); }`,
          `export function widened(injected, maybe) { const run = (Reflect['get'])?.(injected, \`${left}${substitution}${right}\`); run('cmd.exe'); }`,
          `export function widened(injected, maybe) { const run = Reflect['g' + maybe + 'et']?.(injected, \`${left}${substitution}${right}\`); run('cmd.exe'); }`,
          `export function widened(injected, maybe) { const run = Reflect.get.call(null, injected, \`${left}${substitution}${right}\`); run('cmd.exe'); }`,
          `export function widened(injected, maybe) { const getter = Reflect.get; const run = getter(injected, \`${left}${substitution}${right}\`); run('cmd.exe'); }`,
          `export function widened(injected, maybe) { const getter = (0, Reflect.get); const run = getter(injected, \`${left}${substitution}${right}\`); run('cmd.exe'); }`,
          `export function widened(injected, maybe) { const getter = Reflect.get.bind(Reflect, injected); const run = getter(\`${left}${substitution}${right}\`); run('cmd.exe'); }`,
        ]) {
          const result = analyzeProviderPoolInjection(hostileSource);
          assert.equal(result.clean, false, `${authorityName}:${split}:${substitution}:${hostileSource}`);
          assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
        }
      }
    }
  }
});

test('caller-completed computed names cannot recover forbidden network capabilities', () => {
  for (const hostileSource of [
    "export function widened(input, suffix) { return input['fet' + suffix]('https://example.invalid'); }",
    "export function widened(input, suffix) { return new input['Event' + suffix]('https://example.invalid'); }",
    "export function widened(input, suffix) { return new input['Web' + suffix]('wss://example.invalid'); }",
  ]) {
    const result = analyzeProviderPoolInjection(hostileSource);
    assert.equal(result.clean, false, hostileSource);
    assert.ok(result.findings.some((item) => (
      item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'
    )));
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
