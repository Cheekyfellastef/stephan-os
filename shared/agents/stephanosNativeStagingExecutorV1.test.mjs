import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  appendExecutionReceipt,
  createExecutionReceipt,
} from './executionReceiptV1.mjs';
import {
  createSharedWorkspaceProofRecord,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import {
  STEPHANOS_NATIVE_STAGING_REQUEST_SCHEMA,
  STEPHANOS_NATIVE_MODEL_RESULT_SCHEMA,
  buildStephanosNativeStagingPlan,
  buildStephanosNativeTestExecutionId,
  buildStephanosNativeTestProofRef,
  createStephanosNativeStagingReceipt,
  validateStephanosNativeModelResult,
  validateStephanosNativeStagingRequest,
  verifyStephanosNativeTestAndScopeProof,
} from './stephanosNativeStagingExecutorV1.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const HEAD = 'a'.repeat(40);
const NOW_UTC = '2026-09-15T15:50:00.000Z';
const NOW_MS = Date.parse(NOW_UTC);
const REPO_ROOT = resolve('.');

function fixture(overrides = {}) {
  const one = 'export const one = 1;\n';
  const two = 'export const two = 2;\n';
  const request = {
    schemaVersion: STEPHANOS_NATIVE_STAGING_REQUEST_SCHEMA,
    missionId: 'critical-2007-elastic-goal',
    actionId: 'native-action-1',
    workerId: 'stephanos-native-battle-bridge',
    repository: 'Cheekyfellastef/stephan-os',
    branch: 'stephanos/native-canary-2007',
    baseHead: HEAD,
    leaseId: 'lease-native-2007',
    allowedFiles: ['shared/agents/a.mjs','shared/agents/b.mjs'],
    requiredTestIds: ['native-focused-test'],
    sourceSnapshots: [
      { path:'shared/agents/a.mjs', content:one, sha256:hash(one) },
      { path:'shared/agents/b.mjs', content:two, sha256:hash(two) },
    ],
    ...(overrides.request || {}),
  };
  const result = {
    schemaVersion: STEPHANOS_NATIVE_MODEL_RESULT_SCHEMA,
    missionId: request.missionId,
    actionId: request.actionId,
    baseHead: request.baseHead,
    replacements: [{ path:'shared/agents/a.mjs', beforeSha256:hash(one), content:'export const one = 3;\n' }],
    summary:'bounded source repair',
    ...(overrides.result || {}),
  };
  return { request, result, one, two };
}

function proofFor(request, two, outputSha256 = hash('pass'), overrides = {}) {
  return {
    baseHead: HEAD,
    leaseId: request.leaseId,
    changedFiles:['shared/agents/a.mjs'],
    testOutputs:[{ testId:'native-focused-test', outputSha256 }],
    sourceAfter:[
      { path:'shared/agents/a.mjs', sha256:hash('export const one = 3;\n') },
      { path:'shared/agents/b.mjs', sha256:hash(two) },
    ],
    ...overrides,
  };
}

async function withWorkspace(action) {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'stephanos-native-staging-'));
  try {
    return await action(workspaceRoot);
  } finally {
    await rm(workspaceRoot, { recursive:true, force:true });
  }
}

async function persistTestEvidence(workspaceRoot, request, options = {}) {
  const testId = options.testId || 'native-focused-test';
  const outputSha256 = options.outputSha256 || hash('pass');
  const executionId = buildStephanosNativeTestExecutionId(request.actionId, testId);
  const proofRef = buildStephanosNativeTestProofRef(outputSha256);
  const workerId = options.workerId || request.workerId;
  const phase = options.phase || `native-test:${testId}`;
  const receipt = createExecutionReceipt({
    receiptId:`receipt-${executionId}`,
    repository:request.repository,
    issueNumber:2007,
    prNumber:2239,
    branch:request.branch,
    sourceHead:HEAD,
    workerId,
    workerType:'orchestration-engine',
    executionId,
    leaseKey:request.leaseId,
    state:'completed',
    phase,
    sequence:1,
    timestampUtc:'2026-09-15T15:49:00.000Z',
    heartbeatExpiresAtUtc:'2026-09-15T15:51:00.000Z',
    blocker:'',
    operatorActionRequired:false,
    proofRefs:[proofRef],
    expectedNextAction:'',
  });
  if (options.persistReceipt !== false) {
    const written = await appendExecutionReceipt(workspaceRoot, receipt, { repoRoot:REPO_ROOT, nowMs:NOW_MS });
    assert.equal(written.ok, true, written.reason);
  }
  if (options.persistProof !== false) {
    const proofRecord = createSharedWorkspaceProofRecord({
      proofId:`native-test-${outputSha256}`,
      participantId:workerId,
      timestampUtc:'2026-09-15T15:49:00.000Z',
      correlationId:executionId,
      relatedIssue:'2007',
      relatedPr:'2239',
      status:'passed',
      summary:`Persisted native focused test ${testId}.`,
      refs:[
        `action:${request.actionId.toLowerCase()}`,
        `test:${testId.toLowerCase()}`,
        `output-sha256:${outputSha256}`,
        `source-head:${HEAD}`,
        `lease:${request.leaseId.toLowerCase()}`,
      ],
      proofRefs:[proofRef],
    });
    const write = await writeAtomicJson(
      workspaceRoot,
      ['proof', `native-test-${outputSha256}.json`],
      proofRecord,
      { repoRoot:REPO_ROOT, nowMs:NOW_MS },
    );
    assert.equal(write.ok, true, write.reason);
  }
  return { outputSha256, executionId, proofRef, receipt };
}

const verifyOptions = (workspaceRoot) => ({ workspaceRoot, repoRoot:REPO_ROOT, nowMs:NOW_MS });

test('persisted canonical execution receipt plus persisted proof makes bounded staging promotion-eligible', async () => withWorkspace(async (workspaceRoot) => {
  const { request, result, two } = fixture();
  assert.equal(validateStephanosNativeStagingRequest(request).valid, true);
  assert.equal(validateStephanosNativeModelResult(result, request).valid, true);
  const plan = buildStephanosNativeStagingPlan(request, result);
  assert.equal(plan.ok, true);
  assert.equal(plan.modelMayPromote, false);
  const evidence = await persistTestEvidence(workspaceRoot, request);
  const proof = proofFor(request, two, evidence.outputSha256);
  const verification = await verifyStephanosNativeTestAndScopeProof(request, result, proof, verifyOptions(workspaceRoot));
  assert.equal(verification.valid, true, verification.errors.join(','));
  const receipt = await createStephanosNativeStagingReceipt(request, result, proof, {
    ...verifyOptions(workspaceRoot),
    observedAtUtc:NOW_UTC,
  });
  assert.ok(receipt);
  assert.equal(receipt.sourceChanged, true);
  assert.equal(receipt.testsPassed, true);
  assert.equal(receipt.promotionEligible, true);
  assert.equal(receipt.mergeAuthority, false);
}));

test('caller-created execution receipt object is rejected because testOutputs is closed-world', async () => withWorkspace(async (workspaceRoot) => {
  const { request, result, two } = fixture();
  const outputSha256 = hash('pass');
  const forged = proofFor(request, two, outputSha256, {
    testOutputs:[{
      testId:'native-focused-test',
      outputSha256,
      executionReceipt:createExecutionReceipt({
        receiptId:'fake', repository:request.repository, issueNumber:2007, prNumber:2239,
        branch:request.branch, sourceHead:HEAD, workerId:request.workerId,
        workerType:'orchestration-engine', executionId:'fake', leaseKey:request.leaseId,
        state:'completed', phase:'native-test:native-focused-test', sequence:1,
        timestampUtc:NOW_UTC, heartbeatExpiresAtUtc:'2026-09-15T15:52:00.000Z',
        blocker:'', operatorActionRequired:false, proofRefs:[], expectedNextAction:'',
      }),
    }],
  });
  const verdict = await verifyStephanosNativeTestAndScopeProof(request, result, forged, verifyOptions(workspaceRoot));
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.includes('test-output-set-invalid'));
}));

test('missing persisted execution history or proof artifact blocks promotion', async () => withWorkspace(async (workspaceRoot) => {
  const { request, result, two } = fixture();
  const outputSha256 = hash('pass');
  const proof = proofFor(request, two, outputSha256);
  let verdict = await verifyStephanosNativeTestAndScopeProof(request, result, proof, verifyOptions(workspaceRoot));
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.some((error) => error.includes('required-test-invalid:native-focused-test')));

  await persistTestEvidence(workspaceRoot, request, { outputSha256, persistProof:false });
  verdict = await verifyStephanosNativeTestAndScopeProof(request, result, proof, verifyOptions(workspaceRoot));
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.some((error) => error.includes('persisted-test-proof-missing')));
}));

test('persisted evidence with wrong worker or phase cannot prove tests passed', async () => withWorkspace(async (workspaceRoot) => {
  const { request, result, two } = fixture();
  const outputSha256 = hash('wrong-worker');
  await persistTestEvidence(workspaceRoot, request, { outputSha256, workerId:'other-worker' });
  let verdict = await verifyStephanosNativeTestAndScopeProof(request, result, proofFor(request, two, outputSha256), verifyOptions(workspaceRoot));
  assert.equal(verdict.valid, false);
  assert.ok(verdict.errors.some((error) => error.includes('persisted-execution-receipt-binding-invalid')));
}));

test('normalized duplicate test ids and unprovable execution identities fail request admission', () => {
  const duplicate = fixture({ request:{ requiredTestIds:['native-focused-test',' native-focused-test '] } }).request;
  assert.equal(validateStephanosNativeStagingRequest(duplicate).valid, false);
  for (const [key, value] of [
    ['actionId','bad:id'],
    ['workerId','bad/worker'],
    ['leaseId','bad:lease'],
    ['actionId',`a${'x'.repeat(81)}`],
    ['branch',`feature/${'x'.repeat(181)}`],
  ]) {
    const request = fixture({ request:{ [key]:value } }).request;
    assert.equal(validateStephanosNativeStagingRequest(request).valid, false, `${key}=${value} must fail`);
  }
});

test('forged validation flags, traversal, out-of-scope writes and before-digest drift fail closed', () => {
  const { request, result } = fixture();
  assert.equal(validateStephanosNativeModelResult({ ...result, valid:true }, request).valid, false);
  assert.equal(validateStephanosNativeModelResult({ ...result, replacements:[{ ...result.replacements[0], path:'../AGENTS.md' }] }, request).valid, false);
  assert.equal(validateStephanosNativeModelResult({ ...result, replacements:[{ ...result.replacements[0], path:'package.json' }] }, request).valid, false);
  assert.equal(validateStephanosNativeModelResult({ ...result, replacements:[{ ...result.replacements[0], beforeSha256:'b'.repeat(64) }] }, request).valid, false);
});

test('protected main aliases and protected or generated source paths cannot enter staging', () => {
  const { request } = fixture();
  for (const branch of ['main','refs/heads/main']) {
    const verdict = validateStephanosNativeStagingRequest({ ...request, branch });
    assert.equal(verdict.valid, false);
    assert.ok(verdict.errors.includes('branch-invalid'));
  }
  for (const protectedPath of ['.git/config','.env','node_modules/x/index.js','runtime/state.json','apps/stephanos/dist/index.js']) {
    const content='blocked\n';
    const verdict=validateStephanosNativeStagingRequest({
      ...request,
      allowedFiles:[protectedPath],
      sourceSnapshots:[{path:protectedPath,content,sha256:hash(content)}],
    });
    assert.equal(verdict.valid,false,`${protectedPath} must be rejected`);
    assert.ok(verdict.errors.includes('allowed-file-path-invalid'));
  }
});

test('malformed allowedFiles fails closed without throwing', () => {
  const { request } = fixture();
  assert.doesNotThrow(() => validateStephanosNativeStagingRequest({ ...request, allowedFiles:'shared/agents/a.mjs' }));
  const verdict=validateStephanosNativeStagingRequest({ ...request, allowedFiles:'shared/agents/a.mjs' });
  assert.equal(verdict.valid,false);
  assert.ok(verdict.errors.includes('allowed-files-invalid'));
});

test('validated head and lease identities are canonicalized into the plan', () => {
  const { request, result } = fixture();
  const paddedRequest={...request,baseHead:`  ${HEAD}  `,leaseId:'  lease-native-2007  '};
  const paddedResult={...result,baseHead:` ${HEAD} `};
  const plan=buildStephanosNativeStagingPlan(paddedRequest,paddedResult);
  assert.equal(plan.ok,true);
  assert.equal(plan.baseHead,HEAD);
  assert.equal(plan.leaseId,'lease-native-2007');
});

test('test omission, unexpected changed scope and untouched-file drift block promotion', async () => withWorkspace(async (workspaceRoot) => {
  const { request, result, two } = fixture();
  const evidence = await persistTestEvidence(workspaceRoot, request);
  const noTests=proofFor(request,two,evidence.outputSha256,{testOutputs:[]});
  assert.equal((await verifyStephanosNativeTestAndScopeProof(request,result,noTests,verifyOptions(workspaceRoot))).valid,false);
  const widened=proofFor(request,two,evidence.outputSha256,{changedFiles:['shared/agents/a.mjs','package.json']});
  assert.equal((await verifyStephanosNativeTestAndScopeProof(request,result,widened,verifyOptions(workspaceRoot))).valid,false);
  const drifted=proofFor(request,two,evidence.outputSha256,{sourceAfter:[
    {path:'shared/agents/a.mjs',sha256:hash('export const one = 3;\n')},
    {path:'shared/agents/b.mjs',sha256:hash('drift')},
  ]});
  assert.equal((await verifyStephanosNativeTestAndScopeProof(request,result,drifted,verifyOptions(workspaceRoot))).valid,false);
}));

test('accessor-bearing expected request field is rejected without invoking accessors', () => {
  let invoked = 0;
  const request = fixture().request;
  const descriptors=Object.fromEntries(Object.entries(request).map(([key,value]) => [key,{ value, enumerable:true,writable:true,configurable:true }]));
  descriptors.schemaVersion={ get(){ invoked += 1; throw new Error('must-not-run'); }, enumerable:true, configurable:true };
  const hostile=Object.create(Object.prototype,descriptors);
  const validation=validateStephanosNativeStagingRequest(hostile);
  assert.equal(validation.valid,false);
  assert.ok(validation.errors.includes('request-shape-invalid'));
  assert.equal(invoked,0);
});

test('accessor-bearing extra test evidence is rejected without invoking it', async () => withWorkspace(async (workspaceRoot) => {
  let invoked = 0;
  const { request, result, two } = fixture();
  const outputSha256=hash('pass');
  const hostile=Object.create(Object.prototype,{
    testId:{value:'native-focused-test',enumerable:true,writable:true,configurable:true},
    outputSha256:{value:outputSha256,enumerable:true,writable:true,configurable:true},
    executionReceipt:{get(){invoked+=1;throw new Error('must-not-run');},enumerable:true,configurable:true},
  });
  const verdict=await verifyStephanosNativeTestAndScopeProof(
    request,
    result,
    proofFor(request,two,outputSha256,{testOutputs:[hostile]}),
    verifyOptions(workspaceRoot),
  );
  assert.equal(verdict.valid,false);
  assert.equal(invoked,0);
});