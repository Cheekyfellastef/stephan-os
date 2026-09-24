import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  appendExecutionReceipt,
  createExecutionReceipt,
} from '../../shared/agents/executionReceiptV1.mjs';
import {
  createSharedWorkspaceProofRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  buildStephanosNativeTestExecutionId,
  buildStephanosNativeTestProofRef,
  createStephanosNativeStagingReceipt,
  stageStephanosNativeModelResult,
  verifyStephanosNativeTestAndScopeProof,
} from '../../shared/agents/stephanosNativeStagingExecutorV1.mjs';
import {
  STEPHANOS_NATIVE_ADAPTER,
  STEPHANOS_NATIVE_ROUTE,
} from '../../shared/agents/stephanosNativeCapacityReceiptV1.mjs';
import { readVerifiedStephanosNativeRoutingCandidate } from '../../shared/agents/stephanosNativeCapacityRoutingAdmissionV1.mjs';
import { readSourceMutationLease } from './programmeAuthorityService.js';

export const STEPHANOS_NATIVE_MISSION_EXECUTOR_SCHEMA = 'stephanos.native-mission-executor.v1';
export const STEPHANOS_NATIVE_FOCUSED_TASK_CLASS = 'FOCUSED_REPAIR';

const SHA40 = /^[0-9a-f]{40}$/;
const SAFE_MODEL = /^[a-z0-9][a-z0-9._:@/-]{2,239}$/i;
const SAFE_SOURCE_PATH = /^(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._@+ -]+(?:\/[A-Za-z0-9._@+ -]+)*$/;
const FORBIDDEN_PATH = /(^|\/)(?:\.git|node_modules|runtime|runtime-data|stephanos-server\/data)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:pem|pfx|key)$/i;
const DIRECT_NODE_TEST = /^node --test ([A-Za-z0-9._/@+-]+(?: [A-Za-z0-9._/@+-]+)*)$/;
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 768 * 1024;

function text(value) { return String(value ?? '').trim(); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function frozen(value) { return Object.freeze(value); }
function nowUtc(options = {}) { return options.now instanceof Date ? options.now.toISOString() : new Date().toISOString(); }
function within(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}
function safeSourcePath(value) {
  const normalized = text(value).replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!SAFE_SOURCE_PATH.test(normalized) || FORBIDDEN_PATH.test(normalized) || /[*?\[\]]/.test(normalized)) return '';
  return normalized;
}
function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
}
function successful(result) { return !result?.error && result?.status === 0; }
function gitText(run, worktreePath, args, env, label) {
  const result = run('git.exe', ['-C', worktreePath, ...args], { cwd: worktreePath, env });
  if (!successful(result)) throw new Error(`${label}:${text(result?.error?.message || result?.stderr || result?.status)}`);
  return text(result.stdout);
}

export function parseStephanosNativeFocusedTestCommand(command) {
  const normalized = text(command);
  const matched = DIRECT_NODE_TEST.exec(normalized);
  if (!matched) return frozen({ ok: false, reason: 'STEPHANOS_NATIVE_TEST_COMMAND_NOT_ALLOWLISTED', command: normalized, args: frozen([]), testId: '' });
  const paths = matched[1].split(' ').map(safeSourcePath).filter(Boolean);
  if (!paths.length || paths.length !== matched[1].split(' ').length) {
    return frozen({ ok: false, reason: 'STEPHANOS_NATIVE_TEST_PATH_INVALID', command: normalized, args: frozen([]), testId: '' });
  }
  return frozen({
    ok: true,
    reason: 'STEPHANOS_NATIVE_TEST_COMMAND_ALLOWED',
    command: normalized,
    args: frozen(['--test', ...paths]),
    testId: `test-${sha256(normalized).slice(0, 24)}`,
  });
}

function exactAllowedFile(action = {}) {
  const values = Array.isArray(action.allowedFiles) ? action.allowedFiles.map(safeSourcePath).filter(Boolean) : [];
  if (values.length !== 1 || values.length !== action.allowedFiles?.length) return '';
  return values[0];
}

function focusedTests(action = {}) {
  const commands = Array.isArray(action.requiredTests) ? action.requiredTests : [];
  if (!commands.length || commands.length > 4) return null;
  const parsed = commands.map(parseStephanosNativeFocusedTestCommand);
  return parsed.every((entry) => entry.ok) ? parsed : null;
}

function missionIssueNumber(claim = {}) {
  const value = Number(claim?.item?.executionBinding?.issueNumber ?? claim?.item?.actionGrant?.issueNumber);
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

function missionPrNumber(claim = {}) {
  const value = Number(claim?.item?.executionBinding?.prNumber ?? claim?.item?.actionGrant?.prNumber);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function executionBinding(claim = {}) {
  const binding = claim?.item?.executionBinding;
  const grant = claim?.item?.actionGrant;
  if (!binding || !grant) return null;
  const sourceHead = text(binding.headSha || binding.sourceRevision).toLowerCase();
  if (!SHA40.test(sourceHead) || !text(binding.leaseKey) || !missionIssueNumber(claim)) return null;
  return frozen({ binding, grant, sourceHead, issueNumber: missionIssueNumber(claim), prNumber: missionPrNumber(claim) });
}

function modelPrompt(action, request) {
  return [
    'You are the bounded Stephanos-native source repair model.',
    'Return JSON only. Do not use markdown.',
    'You have no shell, Git, test, lease, merge or deployment authority.',
    'Return exactly this shape:',
    '{"schemaVersion":"stephanos.native-model-result.v1","missionId":"...","actionId":"...","baseHead":"40hex","replacements":[{"path":"exact/path","beforeSha256":"64hex","content":"complete replacement text"}],"summary":"short summary"}',
    'Change only the exact allowed file. Return at least one real replacement and no extra keys.',
    `Mission ID: ${request.missionId}`,
    `Action ID: ${request.actionId}`,
    `Base head: ${request.baseHead}`,
    `Operator intent: ${text(action.operatorIntent)}`,
    `Intended outcome: ${text(action.intendedOutcome)}`,
    `Required tests: ${JSON.stringify(action.requiredTests || [])}`,
    `Source snapshot: ${JSON.stringify(request.sourceSnapshots)}`,
  ].join('\n');
}

async function callNativeModel(candidate, action, request, options = {}) {
  const endpoint = text(candidate.endpoint);
  const model = text(candidate.model);
  if (!['http://127.0.0.1:11434', 'http://localhost:11434'].includes(endpoint)
    || candidate.provider !== 'ollama-local'
    || candidate.transport !== 'http-loopback-fixed'
    || !SAFE_MODEL.test(model)) throw new Error('STEPHANOS_NATIVE_MODEL_IDENTITY_INVALID');
  const prompt = modelPrompt(action, request);
  if (Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) throw new Error('STEPHANOS_NATIVE_MODEL_PROMPT_TOO_LARGE');
  const requestBody = {
    model,
    stream: false,
    format: 'json',
    keep_alive: '5m',
    options: { temperature: 0 },
    messages: [
      { role: 'system', content: 'Follow the bounded replacement JSON contract exactly.' },
      { role: 'user', content: prompt },
    ],
  };
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('STEPHANOS_NATIVE_FETCH_UNAVAILABLE');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetchImpl(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`STEPHANOS_NATIVE_MODEL_HTTP_${response.status}`);
    let envelope;
    try { envelope = JSON.parse(raw); } catch { throw new Error('STEPHANOS_NATIVE_MODEL_ENVELOPE_INVALID'); }
    if (text(envelope?.model) !== model) throw new Error('STEPHANOS_NATIVE_MODEL_SUBSTITUTION_DETECTED');
    let result;
    try { result = JSON.parse(text(envelope?.message?.content).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')); }
    catch { throw new Error('STEPHANOS_NATIVE_MODEL_RESULT_INVALID_JSON'); }
    return frozen({ result, requestSha256: sha256(JSON.stringify(requestBody)), responseSha256: sha256(raw), model });
  } finally {
    clearTimeout(timer);
  }
}

async function persistNativeTestEvidence({ request, plan, parsedTest, outputSha256, claim, timestampUtc, workspaceRoot, repoRoot }) {
  const executionId = buildStephanosNativeTestExecutionId(request.missionId, request.actionId, parsedTest.testId);
  const proofRef = buildStephanosNativeTestProofRef(outputSha256);
  const missionRef = `proof/native-mission-${sha256(request.missionId)}.sha256`;
  const stagedRefs = [
    `proof/native-staged-tree-${plan.stagedTreeSha256}.sha256`,
    `proof/native-staged-diff-${plan.diffSha256}.sha256`,
  ];
  if (!executionId || !proofRef) throw new Error('STEPHANOS_NATIVE_TEST_EVIDENCE_ID_INVALID');
  const receipt = createExecutionReceipt({
    receiptId: `receipt-${executionId}`,
    repository: request.repository,
    issueNumber: missionIssueNumber(claim),
    prNumber: missionPrNumber(claim),
    branch: request.branch,
    sourceHead: request.baseHead,
    workerId: request.workerId,
    workerType: 'orchestration-engine',
    executionId,
    leaseKey: request.leaseId,
    state: 'completed',
    phase: `native-test:${parsedTest.testId}`,
    sequence: 1,
    timestampUtc,
    proofRefs: [proofRef, missionRef, ...stagedRefs],
    expectedNextAction: '',
  });
  const appended = await appendExecutionReceipt(workspaceRoot, receipt, { repoRoot, nowMs: Date.parse(timestampUtc) });
  if (appended?.ok !== true) throw new Error(`STEPHANOS_NATIVE_TEST_RECEIPT_BLOCKED:${appended?.reason || 'unknown'}`);
  const proofRecord = createSharedWorkspaceProofRecord({
    proofId: `native-test-${outputSha256}`,
    participantId: request.workerId,
    timestampUtc,
    correlationId: executionId,
    relatedIssue: String(missionIssueNumber(claim)),
    relatedPr: missionPrNumber(claim) ? String(missionPrNumber(claim)) : '',
    status: 'passed',
    summary: `Persisted native focused test ${parsedTest.testId}.`,
    refs: [
      `mission:${request.missionId}`,
      `action:${request.actionId.toLowerCase()}`,
      `test:${parsedTest.testId}`,
      `output-sha256:${outputSha256}`,
      `source-head:${request.baseHead}`,
      `lease:${request.leaseId.toLowerCase()}`,
      `staged-tree-sha256:${plan.stagedTreeSha256}`,
      `diff-sha256:${plan.diffSha256}`,
    ],
    proofRefs: [proofRef, missionRef, ...stagedRefs],
  });
  const written = await writeAtomicJson(workspaceRoot, ['proof', `native-test-${outputSha256}.json`], proofRecord, { repoRoot, nowMs: Date.parse(timestampUtc) });
  if (written?.ok !== true) throw new Error(`STEPHANOS_NATIVE_TEST_PROOF_BLOCKED:${written?.reason || 'unknown'}`);
  return frozen({ testId: parsedTest.testId, outputSha256, executionId, proofRef });
}

function sourceTestReceipt(parsedTest, outputSha256, timestampUtc) {
  return frozen({
    receiptId: `native-source-test-${sha256(`${parsedTest.command}\n${outputSha256}`).slice(0, 24)}`,
    requirement: 'source deterministic test',
    testCommand: parsedTest.command,
    source: 'stephanos-native',
    evidenceType: 'source-test-command',
    verified: true,
    commandOutputHash: outputSha256,
    createdAt: timestampUtc,
  });
}

function missionEvidenceReceipts(action, testReceipts, timestampUtc) {
  const requirements = Array.isArray(action.requiredEvidence) ? action.requiredEvidence.map(text).filter(Boolean) : [];
  const first = testReceipts[0];
  return requirements.map((requirement) => frozen({
    receiptId: `native-evidence-${sha256(`${action.actionId}\n${requirement}`).slice(0, 24)}`,
    requirement,
    source: 'stephanos-native',
    evidenceType: 'command-output',
    verified: true,
    exitCode: 0,
    testCommand: first?.testCommand || '',
    commandOutputHash: first?.commandOutputHash || '',
    createdAt: timestampUtc,
  }));
}

export async function executeStephanosNativeAction(action, claim, options = {}) {
  if (action?.actionKind !== 'agent-handoff' || action?.adapter !== STEPHANOS_NATIVE_ADAPTER) throw new Error('STEPHANOS_NATIVE_ACTION_UNSUPPORTED');
  const identity = executionBinding(claim);
  if (!identity) throw new Error('STEPHANOS_NATIVE_EXECUTION_BINDING_INVALID');
  const worktreePath = resolve(text(action.worktreePath));
  const allowedFile = exactAllowedFile(action);
  const tests = focusedTests(action);
  if (!text(action.repository) || !text(action.branch) || !text(action.missionId) || !text(action.actionId)
    || !worktreePath || !allowedFile || !tests) throw new Error('STEPHANOS_NATIVE_ACTION_IDENTITY_INVALID');
  if (action.capacityRoute !== STEPHANOS_NATIVE_ROUTE || text(action.capacityReceiptId) !== text(identity.grant.capacityReceiptId)) {
    throw new Error('STEPHANOS_NATIVE_CAPACITY_BINDING_INVALID');
  }

  const env = options.env || process.env;
  const run = options.runCommand || defaultRun;
  const timestampUtc = nowUtc(options);
  const workspaceRoot = text(options.sharedWorkspaceRoot || env.STEPHANOS_SHARED_AGENT_WORKSPACE);
  const repoRoot = text(options.repoRoot || env.STEPHANOS_MISSION_WORKER_REPOSITORY_ROOT || process.cwd());
  if (!workspaceRoot || !repoRoot) throw new Error('STEPHANOS_NATIVE_WORKSPACE_IDENTITY_REQUIRED');

  const readCandidate = options.testOnly === true && typeof options.readVerifiedCandidate === 'function'
    ? options.readVerifiedCandidate
    : readVerifiedStephanosNativeRoutingCandidate;
  const admission = await readCandidate({
    root: workspaceRoot,
    repoRoot,
    nowUtc: timestampUtc,
    repository: action.repository,
    sourceHead: identity.sourceHead,
    taskClass: STEPHANOS_NATIVE_FOCUSED_TASK_CLASS,
    env,
  });
  const candidate = admission?.candidate;
  if (admission?.ok !== true || !candidate
    || candidate.adapter !== STEPHANOS_NATIVE_ADAPTER
    || candidate.route !== STEPHANOS_NATIVE_ROUTE
    || candidate.workerId !== text(identity.grant.workerId)
    || candidate.capacityReceiptId !== text(action.capacityReceiptId)
    || candidate.sourceHead !== identity.sourceHead
    || candidate.repository !== action.repository) {
    throw new Error(`STEPHANOS_NATIVE_CAPACITY_REVERIFY_BLOCKED:${text(admission?.reason || 'identity-mismatch')}`);
  }

  const exactHead = gitText(run, worktreePath, ['rev-parse', 'HEAD'], env, 'STEPHANOS_NATIVE_GIT_HEAD').toLowerCase();
  const exactBranch = gitText(run, worktreePath, ['rev-parse', '--abbrev-ref', 'HEAD'], env, 'STEPHANOS_NATIVE_GIT_BRANCH');
  const dirty = gitText(run, worktreePath, ['status', '--porcelain'], env, 'STEPHANOS_NATIVE_GIT_STATUS');
  if (exactHead !== identity.sourceHead || exactBranch !== action.branch || dirty) throw new Error('STEPHANOS_NATIVE_WORKTREE_NOT_EXACT_CLEAN_HEAD');

  const absoluteFile = resolve(worktreePath, allowedFile);
  if (!within(worktreePath, absoluteFile)) throw new Error('STEPHANOS_NATIVE_SOURCE_PATH_ESCAPE_BLOCKED');
  const before = await readFile(absoluteFile, 'utf8');
  if (Buffer.byteLength(before, 'utf8') > MAX_SOURCE_BYTES) throw new Error('STEPHANOS_NATIVE_SOURCE_FILE_TOO_LARGE');
  const request = frozen({
    schemaVersion: 'stephanos.native-staging-request.v1',
    missionId: action.missionId,
    actionId: action.actionId,
    workerId: candidate.workerId,
    repository: action.repository,
    branch: action.branch,
    baseHead: identity.sourceHead,
    leaseId: identity.binding.leaseKey,
    allowedFiles: frozen([allowedFile]),
    requiredTestIds: frozen(tests.map((entry) => entry.testId)),
    sourceSnapshots: frozen([{ path: allowedFile, content: before, sha256: sha256(before) }]),
  });

  const modelCall = await callNativeModel(candidate, action, request, options);
  const stage = await stageStephanosNativeModelResult(request, modelCall.result, {
    workspaceRoot,
    repoRoot,
    observedAtUtc: timestampUtc,
    relatedIssue: String(identity.issueNumber),
    relatedPr: identity.prNumber ? String(identity.prNumber) : '',
    nowMs: Date.parse(timestampUtc),
  });
  if (stage?.ok !== true || stage.plan?.changedFiles?.length !== 1 || stage.plan.changedFiles[0] !== allowedFile) {
    throw new Error(`STEPHANOS_NATIVE_STAGE_BLOCKED:${text(stage?.reason || 'changed-scope-invalid')}`);
  }

  const readLease = options.testOnly === true && typeof options.readSourceMutationLease === 'function'
    ? options.readSourceMutationLease
    : readSourceMutationLease;
  const mutationLease = await readLease({ root: workspaceRoot, repoRoot, nowUtc: timestampUtc });
  const released = mutationLease?.present === true && mutationLease?.validation?.active === false
    && mutationLease?.validation?.finalVerdict === 'SOURCE_MUTATION_LEASE_RELEASED';
  if (mutationLease?.present === true && !released) {
    throw new Error(`STEPHANOS_NATIVE_MUTATION_LEASE_CONFLICT:${text(mutationLease?.record?.leaseId || mutationLease?.reason || 'active')}`);
  }
  if (mutationLease?.ok !== true && mutationLease?.present !== false && !released) {
    throw new Error(`STEPHANOS_NATIVE_MUTATION_LEASE_UNPROVEN:${text(mutationLease?.reason || 'unknown')}`);
  }

  const replacement = stage.plan.replacements[0];
  const sourceTests = [];
  const testOutputs = [];
  let promoted = false;
  try {
    await writeFile(absoluteFile, replacement.content, 'utf8');
    promoted = true;
    if (sha256(await readFile(absoluteFile, 'utf8')) !== replacement.afterSha256) throw new Error('STEPHANOS_NATIVE_PROMOTION_READBACK_MISMATCH');
    const changed = gitText(run, worktreePath, ['diff', '--name-only', 'HEAD', '--'], env, 'STEPHANOS_NATIVE_CHANGED_SCOPE')
      .split(/\r?\n/).map((item) => item.trim().replace(/\\/g, '/')).filter(Boolean);
    if (changed.length !== 1 || changed[0] !== allowedFile) throw new Error('STEPHANOS_NATIVE_PROMOTION_SCOPE_DRIFT');

    for (const parsedTest of tests) {
      const result = run(process.execPath, parsedTest.args, { cwd: worktreePath, env });
      const output = `${result?.stdout || ''}\n${result?.stderr || ''}`;
      const outputSha256 = sha256(output);
      if (!successful(result)) throw new Error(`STEPHANOS_NATIVE_FOCUSED_TEST_FAILED:${parsedTest.testId}`);
      const testTimestamp = nowUtc(options);
      const persisted = await persistNativeTestEvidence({
        request,
        plan: stage.plan,
        parsedTest,
        outputSha256,
        claim,
        timestampUtc: testTimestamp,
        workspaceRoot,
        repoRoot,
      });
      testOutputs.push(frozen({ testId: persisted.testId, outputSha256 }));
      sourceTests.push(sourceTestReceipt(parsedTest, outputSha256, testTimestamp));
    }

    const proof = frozen({
      baseHead: identity.sourceHead,
      leaseId: identity.binding.leaseKey,
      changedFiles: frozen([...stage.plan.changedFiles]),
      testOutputs: frozen(testOutputs),
      sourceAfter: frozen([...stage.sourceAfter]),
    });
    const verification = await verifyStephanosNativeTestAndScopeProof(request, modelCall.result, proof, {
      workspaceRoot,
      repoRoot,
      nowMs: Date.parse(nowUtc(options)),
    });
    if (!verification.valid) throw new Error(`STEPHANOS_NATIVE_TEST_SCOPE_PROOF_BLOCKED:${verification.errors[0] || 'unknown'}`);
    const stagingReceipt = await createStephanosNativeStagingReceipt(request, modelCall.result, proof, {
      workspaceRoot,
      repoRoot,
      observedAtUtc: nowUtc(options),
      nowMs: Date.parse(nowUtc(options)),
    });
    if (!stagingReceipt?.promotionEligible || stagingReceipt?.mergeAuthority !== false || stagingReceipt?.leaseSeizureAllowed !== false) {
      throw new Error('STEPHANOS_NATIVE_STAGING_RECEIPT_BLOCKED');
    }

    const completedAt = nowUtc(options);
    const evidenceReceipts = missionEvidenceReceipts(action, sourceTests, completedAt);
    const proofRefs = [stage.proofRef, ...testOutputs.map((item) => buildStephanosNativeTestProofRef(item.outputSha256))];
    return frozen({
      schemaVersion: STEPHANOS_NATIVE_MISSION_EXECUTOR_SCHEMA,
      success: true,
      error: '',
      resultId: `stephanos-native-${action.actionId}`,
      changedFiles: frozen([...stage.plan.changedFiles]),
      completedAt,
      stage: 'TESTED',
      testsPassed: true,
      receipt: frozen({
        receiptId: `native-result-${action.actionId}`.slice(0, 128),
        requirement: 'stephanos native result',
        source: 'stephanos-native',
        evidenceType: 'native-staging-receipt',
        verified: true,
        commandOutputHash: sha256(JSON.stringify(stagingReceipt)),
        createdAt: completedAt,
      }),
      evidenceReceipts: frozen(evidenceReceipts),
      sourceTestReceipts: frozen(sourceTests),
      proofRefs: frozen(proofRefs),
      nativeStagingReceipt: stagingReceipt,
      modelRequestSha256: modelCall.requestSha256,
      modelResponseSha256: modelCall.responseSha256,
      mergeAuthority: false,
      leaseSeizureAllowed: false,
      arbitraryCommandAllowed: false,
    });
  } catch (error) {
    if (promoted) await writeFile(absoluteFile, before, 'utf8').catch(() => {});
    throw error;
  }
}
