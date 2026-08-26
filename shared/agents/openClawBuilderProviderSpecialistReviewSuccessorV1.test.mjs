import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import {
  OPENCLAW_BUILDER_PROVIDER_SPECIALIST_PATHS_V1,
  OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewLegacyV1,
} from './openClawBuilderProviderSpecialistReviewLegacyV1.mjs';
import {
  OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1,
  analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1,
} from './openClawBuilderProviderSpecialistReviewSuccessorV1.mjs';

const REPOSITORY = 'Cheekyfellastef/stephan-os';
const SUCCESSOR_PR = 2000;
const SUCCESSOR_HEAD = '1111111111111111111111111111111111111111';
const SUCCESSOR_BASE = '2222222222222222222222222222222222222222';

function blobSha(content) {
  const bytes = Buffer.from(content, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

function source(path, content, ref = SUCCESSOR_HEAD) {
  return Object.freeze({
    schemaVersion: 'stephanos.windows-authority-source.v1',
    repository: REPOSITORY,
    path,
    ref,
    exists: true,
    size: Buffer.byteLength(content, 'utf8'),
    blobSha: blobSha(content),
    content,
  });
}

const SOURCE_TEXT = Object.freeze({
  'shared/agents/openClawProviderPoolQualificationV1.mjs': `
export const OPENCLAW_PROVIDER_POOL_SCHEMA_V1 = 'stephanos.openclaw-provider-pool.v1';
export const OPENCLAW_PROVIDER_POOL_STATUS_SCHEMA_V1 = 'stephanos.openclaw-provider-pool.status.v1';
export const OPENCLAW_PROVIDER_POOL_REQUIRED_EVIDENCE_V1 = Object.freeze([
  'openclaw-oc1-windows-runtime-acceptance-v1',
]);
export function evaluateOpenClawProviderPoolQualificationV1(input = {}) {
  if (input.repository !== 'Cheekyfellastef/stephan-os') return { productionEligible: false, blocker: 'OPENCLAW_PROVIDER_POOL_REPOSITORY_MISMATCH' };
  if (!input.sourceHead) return { productionEligible: false, blocker: 'OPENCLAW_PROVIDER_POOL_SOURCE_HEAD_REQUIRED' };
  if (!input.runtimeAcceptance || input.runtimeAcceptance.exactHead !== input.sourceHead) return { productionEligible: false, blocker: 'OPENCLAW_PROVIDER_POOL_RUNTIME_ACCEPTANCE_REQUIRED' };
  if (input.runtimeAcceptance.productionEligible !== true) return { productionEligible: false, blocker: 'OPENCLAW_PROVIDER_POOL_RUNTIME_NOT_PRODUCTION_ELIGIBLE' };
  if (input.capabilityCoverage?.includes('OC1_REPOSITORY_SCOUT') !== true) return { productionEligible: false, blocker: 'OPENCLAW_PROVIDER_POOL_CAPABILITY_COVERAGE_REQUIRED' };
  return { productionEligible: true, provider: 'openclaw-standalone', taskClass: 'OC1_REPOSITORY_SCOUT' };
}
`,
  'shared/agents/openClawProviderPoolQualificationV1.test.mjs': `
import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateOpenClawProviderPoolQualificationV1 } from './openClawProviderPoolQualificationV1.mjs';
test('requires exact source-bound Windows acceptance', () => {
  const sourceHead = '1111111111111111111111111111111111111111';
  assert.equal(evaluateOpenClawProviderPoolQualificationV1({ repository: 'Cheekyfellastef/stephan-os', sourceHead }).productionEligible, false);
});
`,
  'shared/agents/openClawTaskClassPromotionCandidateV1.mjs': `
export function buildOpenClawTaskClassPromotionCandidateV1(input = {}) {
  if (input.providerPool?.productionEligible !== true) return { eligible: false, blocker: 'OPENCLAW_PROVIDER_POOL_QUALIFICATION_REQUIRED' };
  if (input.providerPool?.provider !== 'openclaw-standalone') return { eligible: false, blocker: 'OPENCLAW_PROVIDER_IDENTITY_REQUIRED' };
  if (input.providerPool?.taskClass !== 'OC1_REPOSITORY_SCOUT') return { eligible: false, blocker: 'OPENCLAW_TASK_CLASS_REQUIRED' };
  return { eligible: true, provider: input.providerPool.provider, taskClass: input.providerPool.taskClass, mutationAuthority: false, mergeAuthority: false };
}
`,
  'shared/agents/openClawTaskClassPromotionCandidateV1.test.mjs': `
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawTaskClassPromotionCandidateV1 } from './openClawTaskClassPromotionCandidateV1.mjs';
test('promotion candidate remains authority-free', () => {
  const result = buildOpenClawTaskClassPromotionCandidateV1({ providerPool: { productionEligible: true, provider: 'openclaw-standalone', taskClass: 'OC1_REPOSITORY_SCOUT' } });
  assert.equal(result.eligible, true);
  assert.equal(result.mutationAuthority, false);
  assert.equal(result.mergeAuthority, false);
});
`,
});

function sources(overrides = {}) {
  return OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.map((path) => source(path, overrides[path] ?? SOURCE_TEXT[path] ?? 'export const placeholder = true;'));
}

function lineage(sourceHead = SUCCESSOR_HEAD, baseSha = SUCCESSOR_BASE, overrides = {}) {
  return {
    schemaVersion: 'stephanos.windows-authority-reconciliation-lineage.v1',
    repository: REPOSITORY,
    sourceHead,
    sourceCommitSha: sourceHead,
    baseSha,
    liveMainBeforeSha: baseSha,
    liveMainAfterSha: baseSha,
    parents: ['3333333333333333333333333333333333333333', baseSha],
    comparison: {
      status: 'ahead',
      aheadBy: 2,
      behindBy: 0,
      baseCommitSha: baseSha,
      mergeBaseCommitSha: baseSha,
    },
    ...overrides,
  };
}

function unsupportedAnalysis(paths = OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1) {
  return {
    findings: paths.map((path) => ({ severity: 'P0', code: 'unsupported-high-risk-surface', path })),
  };
}

function successorInput(overrides = {}) {
  return {
    analysis: unsupportedAnalysis(),
    repository: REPOSITORY,
    prNumber: SUCCESSOR_PR,
    branch: 'fix/openclaw-provider-pool-successor-specialist-v1',
    sourceHead: SUCCESSOR_HEAD,
    baseSha: SUCCESSOR_BASE,
    lineageEvidence: lineage(),
    sources: sources(),
    findingsArtifact: {
      schemaVersion: 'stephanos.independent-review-findings-artifact.v1',
      kind: 'stephanos.independent-review.findings-artifact',
      artifactFile: 'independent-review-result.json',
      repository: REPOSITORY,
      prNumber: SUCCESSOR_PR,
      branch: 'fix/openclaw-provider-pool-successor-specialist-v1',
      sourceHead: SUCCESSOR_HEAD,
      baseSha: SUCCESSOR_BASE,
      analysis: unsupportedAnalysis(),
      workflowRunId: 123,
      workflowRunAttempt: 1,
      createdAtUtc: '2026-08-26T00:00:00.000Z',
      expiresAtUtc: '2026-09-25T00:00:00.000Z',
      payloadSha256: '',
    },
    ...overrides,
  };
}

function payloadSha256(artifact) {
  const payload = {
    schemaVersion: artifact.schemaVersion,
    kind: artifact.kind,
    artifactFile: artifact.artifactFile,
    repository: artifact.repository,
    prNumber: artifact.prNumber,
    sourceHead: artifact.sourceHead,
    baseSha: artifact.baseSha,
    branch: artifact.branch,
    workflowRunId: artifact.workflowRunId,
    workflowRunAttempt: artifact.workflowRunAttempt,
    createdAtUtc: artifact.createdAtUtc,
    expiresAtUtc: artifact.expiresAtUtc,
    analysis: artifact.analysis,
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

function exactArtifact(input) {
  const artifact = { ...input.findingsArtifact, analysis: input.analysis };
  artifact.payloadSha256 = payloadSha256(artifact);
  return artifact;
}

function analyze(overrides = {}) {
  const input = successorInput(overrides);
  input.findingsArtifact = exactArtifact(input);
  return analyzeOpenClawBuilderProviderSpecialistReviewSuccessorV1(input);
}

function analyzeProviderPoolInjection(injection) {
  const target = 'shared/agents/openClawProviderPoolQualificationV1.mjs';
  const modified = { ...SOURCE_TEXT, [target]: `${SOURCE_TEXT[target]}\n${injection}\n` };
  return analyze({ sources: sources(modified) });
}

function analyzeProviderPoolTestInjection(injection) {
  const target = 'shared/agents/openClawProviderPoolQualificationV1.test.mjs';
  const modified = { ...SOURCE_TEXT, [target]: `${SOURCE_TEXT[target]}\n${injection}\n` };
  return analyze({ sources: sources(modified) });
}

test('legacy specialist remains byte-for-byte behavior compatible for existing profiles', () => {
  const analysis = unsupportedAnalysis(OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1);
  const legacy = analyzeOpenClawBuilderProviderSpecialistReviewLegacyV1({
    analysis,
    repository: REPOSITORY,
    prNumber: 1905,
    branch: 'agent/openclaw-provider-pool-v1',
    sourceHead: SUCCESSOR_HEAD,
    baseSha: SUCCESSOR_BASE,
    lineageEvidence: lineage(),
    sources: OPENCLAW_PROVIDER_POOL_SPECIALIST_PATHS_V1.map((path) => source(path, SOURCE_TEXT[path] ?? 'export const placeholder = true;')),
  });
  assert.equal(legacy.eligible, true);
});

test('successor specialist accepts exact complete source-bound evidence only', () => {
  const result = analyze();
  assert.equal(result.eligible, true);
  assert.equal(result.clean, true);
  assert.equal(result.findings.length, 0);
  assert.equal(result.profileId, 'provider-pool-successor');
});

test('successor specialist requires exact unsupported-high-risk finding set', () => {
  for (const analysis of [
    { findings: [] },
    unsupportedAnalysis(OPENCLAW_PROVIDER_POOL_SUCCESSOR_SPECIALIST_PATHS_V1.slice(0, -1)),
    { findings: [...unsupportedAnalysis().findings, { severity: 'P1', code: 'extra', path: 'README.md' }] },
  ]) {
    const result = analyze({ analysis });
    assert.equal(result.eligible, false);
  }
});

test('successor specialist rejects missing or tampered source and reconciliation evidence', () => {
  const missing = analyze({ sources: sources().slice(0, -1) });
  assert.equal(missing.eligible, true);
  assert.equal(missing.clean, false);
  assert.ok(missing.findings.some((item) => item.code === 'openclaw-provider-pool-source-evidence-invalid'));

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
    "process.getBuiltinModule('child_process').sp" + "awn('cmd.exe');",
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
    "export function widened(injected, empty) { const maybe = { value() {} }; const alias = maybe; Object.defineProperty(alias, 'value', { value: undefined }); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; Object.assign(maybe, { value: undefined }); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; Object.assign(maybe, { ...{ value: undefined } }); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const key = 'value'; Object.assign(maybe, { [key]: undefined }); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const key = 'value'; Reflect.set(maybe, key, undefined); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const key = 'value'; Reflect.deleteProperty(maybe, key); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const key = 'value'; Reflect.defineProperty(maybe, key, { value: undefined }); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const key = 'value'; Reflect.defineProperty(maybe, key, { ...{ value: undefined } }); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const R = Reflect; R.set(maybe, key, undefined); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const R = Reflect; R.deleteProperty(maybe, key); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const R = Reflect; R.defineProperty(maybe, key, { value: undefined }); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const R0 = Reflect; const R1 = (0, R0); R1.set(maybe, key, undefined); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const mutation = Reflect.set; mutation(maybe, key, undefined); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const mutation = (0, Reflect.set); mutation(maybe, key, undefined); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const mutation = Reflect.set.bind(Reflect); mutation(maybe, key, undefined); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
    "export function widened(injected, empty) { const maybe = { value() {} }; const mutation = Reflect.set.bind(Reflect, maybe); mutation(key, undefined); let getter; [getter = Reflect.get] = [maybe.value]; const run = getter(injected, 'sp' + empty + 'awn'); run('cmd.exe'); }",
  ]) {
    const result = analyzeProviderPoolInjection(hostileSource);
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false, hostileSource);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
  }
});

test('call and constructor aliases preserve authority sensitivity through wrappers', () => {
  for (const hostileSource of [
    "export function widened(injected, empty) { const direct = injected['sp' + empty + 'awn']; const viaCall = direct.call; viaCall(injected, 'cmd.exe'); }",
    "export function widened(injected, empty) { const direct = injected['sp' + empty + 'awn']; const viaApply = direct.apply; viaApply(injected, ['cmd.exe']); }",
    "export function widened(injected, empty) { const direct = injected['sp' + empty + 'awn']; const viaBind = direct.bind; const run = viaBind(injected, 'cmd.exe'); run(); }",
    "export function widened(injected, empty) { const direct = injected['sp' + empty + 'awn']; const run = direct.bind(injected, 'cmd.exe'); run(); }",
    "export function widened(injected, empty) { const ctor = direct.constructor; ctor('return globalThis')(); }",
    "export function widened(injected, empty) { const make = direct['constr' + empty + 'uctor']; make('return globalThis')(); }",
    "export function widened(injected, empty) { const make = Reflect.construct(Function, ['return globalThis']); make(); }",
    "export function widened(injected, empty) { const make = Reflect.construct.call(null, Function, ['return globalThis']); make(); }",
    "export function widened(injected, empty) { const make = Reflect.construct.apply(null, [Function, ['return globalThis']]); make(); }",
    "export function widened(injected, empty) { const make = Reflect.construct.bind(Reflect)(Function, ['return globalThis']); make(); }",
    "export function widened(injected, empty) { const C = Function; new C('return globalThis')(); }",
  ]) {
    const result = analyzeProviderPoolInjection(hostileSource);
    assert.equal(result.eligible, true);
    assert.equal(result.clean, false, hostileSource);
    assert.ok(result.findings.some((item) => item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'));
  }
});

test('postfix increment and decrement keep following division executable rather than hiding it as a regex', () => {
  for (const postfix of ['++', '--']) {
    const result = analyzeProviderPoolInjection(`
      let quotient = 1;
      quotient${postfix} / process.getBuiltinModule('child_process').sp${'awn'}('cmd.exe') / 2;
    `);
    assert.equal(result.clean, false, postfix);
    assert.ok(result.findings.some((item) => (
      item.code === 'openclaw-provider-pool-local-execution-authority-forbidden'
    )), postfix);
  }
});

test('test files reject host process, filesystem, and programme-authority imports', () => {
  for (const injection of [
    "import { execFileSync as run } from 'node:child_process'; run('cmd.exe');",
    "import { spawn as launch } from 'child_process'; launch('powershell.exe');",
    "import { writeFile as save } from 'node:fs/promises'; save('outside.json', 'authority');",
    "const { execFileSync: run } = await import('node:child_process'); run('cmd.exe');",
    "const load = process.getBuiltinModule('node:child_process'); load.ex" + "ecSync('cmd.exe');",
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
      sample: "ex${'ecFileSync'}('cmd.exe')",
      template: \`globalThis['process']\`,
    });
    assert.equal(inertFixture.operation, 'spawn');
  `);
  assert.equal(result.clean, true);
});

test('top-level call policy rejects hidden success and authority-bearing returns', () => {
  for (const hostileSource of [
    `export function evaluateOpenClawProviderPoolQualificationV1(input = {}) {
      if (input.repository !== 'Cheekyfellastef/stephan-os') return { productionEligible: false };
      if (!input.sourceHead) return { productionEligible: false };
      if (!input.runtimeAcceptance || input.runtimeAcceptance.exactHead !== input.sourceHead) return { productionEligible: false };
      if (input.runtimeAcceptance.productionEligible !== true) return { productionEligible: false };
      if (input.capabilityCoverage?.includes('OC1_REPOSITORY_SCOUT') !== true) return { productionEligible: false };
      if (input.override) return { productionEligible: true, provider: 'openclaw-standalone', taskClass: 'OC1_REPOSITORY_SCOUT' };
      return { productionEligible: true, provider: 'openclaw-standalone', taskClass: 'OC1_REPOSITORY_SCOUT' };
    }`,
    `export function evaluateOpenClawProviderPoolQualificationV1(input = {}) {
      if (input.repository !== 'Cheekyfellastef/stephan-os') return { productionEligible: false };
      if (!input.sourceHead) return { productionEligible: false };
      if (!input.runtimeAcceptance || input.runtimeAcceptance.exactHead !== input.sourceHead) return { productionEligible: false };
      if (input.runtimeAcceptance.productionEligible !== true) return { productionEligible: false };
      if (input.capabilityCoverage?.includes('OC1_REPOSITORY_SCOUT') !== true) return { productionEligible: false };
      return { productionEligible: true, provider: 'openclaw-standalone', taskClass: 'OC1_REPOSITORY_SCOUT', mutationAuthority: true };
    }`,
  ]) {
    const result = analyzeProviderPoolInjection(hostileSource);
    assert.equal(result.clean, false);
    assert.ok(result.findings.length > 0);
  }
});

test('provider selection cannot bypass exact live acceptance prerequisites', () => {
  const hostile = SOURCE_TEXT['shared/agents/openClawProviderPoolQualificationV1.mjs'].replace(
    "if (input.capabilityCoverage?.includes('OC1_REPOSITORY_SCOUT') !== true) return { productionEligible: false, blocker: 'OPENCLAW_PROVIDER_POOL_CAPABILITY_COVERAGE_REQUIRED' };",
    "if (input.capabilityCoverage?.includes('OC1_REPOSITORY_SCOUT') !== true) return { productionEligible: false, blocker: 'OPENCLAW_PROVIDER_POOL_CAPABILITY_COVERAGE_REQUIRED' };\n  if (input.override === true) return { productionEligible: true, provider: 'openclaw-standalone', taskClass: 'OC1_REPOSITORY_SCOUT' };",
  );
  const result = analyze({ sources: sources({ 'shared/agents/openClawProviderPoolQualificationV1.mjs': hostile }) });
  assert.equal(result.clean, false);
});

test('quoted authority strings and comments remain inert', () => {
  const benign = `${SOURCE_TEXT['shared/agents/openClawProviderPoolQualificationV1.mjs']}
// spawn shell:false process child_process eval new Function
const note = 'execFileSync is forbidden here';
`;
  const result = analyze({ sources: sources({ 'shared/agents/openClawProviderPoolQualificationV1.mjs': benign }) });
  assert.equal(result.clean, true);
});

test('nested return, comma wrapper, and string-template fixtures preserve lexical safety', () => {
  const benign = `${SOURCE_TEXT['shared/agents/openClawProviderPoolQualificationV1.mjs']}
const message = ` + "`provider ${'openclaw-standalone'} ready`" + `;
function nested() { return { productionEligible: true }; }
const wrapped = (0, nested);
`;
  const result = analyze({ sources: sources({ 'shared/agents/openClawProviderPoolQualificationV1.mjs': benign }) });
  assert.equal(result.clean, true);
});
