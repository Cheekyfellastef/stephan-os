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
${'import'} { validateExecutionReceipt as allowedReceipt } from './executionReceiptV1.mjs';
${'import'} { validateSharedWorkspaceRecord as allowedWorkspace } from './sharedAgentWorkspaceStore.mjs';
const allowedPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const allowedRatio = 1 / 2;
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
