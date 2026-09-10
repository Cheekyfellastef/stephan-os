import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { validateIndependentReviewArtifact } from './operatorMergeReviewArtifactV1.mjs';
import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import {
  APPROVAL_BOUNDARY_PATHS_V2,
  WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1,
} from './operatorMergeApprovalBoundaryV2.mjs';
import {
  PROTECTED_MERGE_REQUIRED_WORKFLOWS,
  validateProtectedMergeCheckRows,
} from './protectedMergeCheckClassifierV1.mjs';
import {
  CANONICAL_REPOSITORY,
  CANONICAL_REVIEW_WORKFLOW_PATH,
} from './independentReviewWorkflowDispatchAdmissionV1.mjs';
import {
  independentReviewWorkflowDispatchRunNameV1,
} from './independentReviewWorkflowDispatchLaunchReceiptV1.mjs';

export const PROTECTED_OPENCLAW_MERGE_OPERATION = 'EXECUTE_PROTECTED_OPENCLAW_PR_MERGE';
export const PROTECTED_OPENCLAW_MERGE_MODE = 'qualified-operator-bootstrap';
export const PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE = 'clean-independent';
export const PROTECTED_OPENCLAW_MERGE_FINDING = 'approval-boundary-v2-self-change-requires-qualified-review';
export const PROTECTED_OPENCLAW_MERGE_MAX_BOOTSTRAP_FINDINGS = 20;
export const PROTECTED_OPENCLAW_MERGE_REQUIRED_WORKFLOWS = PROTECTED_MERGE_REQUIRED_WORKFLOWS;
export const PROTECTED_OPERATOR_MERGE_WORKFLOW = 'operator-merge-approval-gate.yml';
export const PROTECTED_OPERATOR_MERGE_WORKFLOW_MODE = 'user-owned-protected-squash';

const PROTECTED_OPENCLAW_BOOTSTRAP_PATHS = new Set([
  ...APPROVAL_BOUNDARY_PATHS_V2,
  ...WINDOWS_AUTHORITY_SPECIALIST_BOUNDARY_PATHS_V1,
]);

const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const API_DIGEST = /^sha256:[a-f0-9]{64}$/;
const INTEGER = /^[1-9][0-9]*$/;
const LEGACY_PULL_REQUEST_TARGET_BINDING = 'legacy-pull-request-target';
const CANONICAL_REPOSITORY_API_URL = 'https://api.github.com/repos/' + CANONICAL_REPOSITORY;
const FORBIDDEN_FIELDS = Object.freeze([
  'command', 'commands', 'executable', 'args', 'arguments', 'shell', 'powershell',
  'script', 'path', 'privateKey', 'publicKey', 'credential', 'cookie', 'session',
  'url', 'uri', 'environment', 'env',
]);
const COMMAND_FIELDS = Object.freeze([
  'prNumber', 'expectedBase', 'reviewRunId', 'reviewRunAttempt', 'reviewJobId',
  'reviewArtifactId', 'reviewArtifactDigest', 'reviewPayloadSha256', 'reviewMode',
  'reviewFindingCode', 'mergeMethod', 'mergeApprovalToken',
]);

function fail(blocker, details = {}) {
  return Object.freeze({ ok: false, blocker, details: Object.freeze(details) });
}

function positiveInteger(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  const text = String(value || '');
  return INTEGER.test(text) ? Number(text) : 0;
}

function parseJson(output, blocker) {
  try { return JSON.parse(String(output || '')); }
  catch { throw new Error(blocker); }
}

function bootstrapApprovalToken(prNumber, headSha) {
  return 'APPROVE_OPENCLAW_SQUASH_MERGE:' + prNumber + ':' + headSha;
}

function workflowApprovalToken(prNumber, headSha) {
  return 'APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:' + prNumber + ':' + headSha;
}

export function protectedOpenClawMergeFields() {
  return COMMAND_FIELDS.filter((field) => field !== 'prNumber');
}

export function validateProtectedOpenClawMergeCommand(command = {}, { now = new Date() } = {}) {
  const unsafeField = FORBIDDEN_FIELDS.find((field) => command[field] !== undefined && command[field] !== null && command[field] !== '');
  if (unsafeField) return fail('PROTECTED_MERGE_UNSAFE_FIELD_PRESENT', { field: unsafeField });
  const prNumber = positiveInteger(command.prNumber);
  const expectedHead = String(command.expectedHead || '').toLowerCase();
  const expectedBase = String(command.expectedBase || '').toLowerCase();
  const reviewRunId = positiveInteger(command.reviewRunId);
  const reviewRunAttempt = positiveInteger(command.reviewRunAttempt);
  const reviewJobId = positiveInteger(command.reviewJobId);
  const reviewArtifactId = positiveInteger(command.reviewArtifactId);
  const reviewArtifactDigest = String(command.reviewArtifactDigest || '').toLowerCase();
  const reviewPayloadSha256 = String(command.reviewPayloadSha256 || '').toLowerCase();
  const reviewMode = String(command.reviewMode || '');
  const reviewFindingCode = String(command.reviewFindingCode || '');
  const mergeMethod = String(command.mergeMethod || '');
  const mergeApprovalToken = String(command.mergeApprovalToken || '');
  const nowMs = now instanceof Date ? now.getTime() : new Date(now).getTime();
  const expiresAtMs = Date.parse(String(command.expiresAt || ''));

  if (!prNumber) return fail('PROTECTED_MERGE_PR_NUMBER_INVALID');
  if (!SHA40.test(expectedHead)) return fail('PROTECTED_MERGE_HEAD_INVALID');
  if (!SHA40.test(expectedBase)) return fail('PROTECTED_MERGE_BASE_INVALID');
  if (!reviewRunId || !reviewRunAttempt || !reviewJobId || !reviewArtifactId) return fail('PROTECTED_MERGE_REVIEW_IDENTITY_INVALID');
  if (!API_DIGEST.test(reviewArtifactDigest)) return fail('PROTECTED_MERGE_ARTIFACT_DIGEST_INVALID');
  if (!SHA256.test(reviewPayloadSha256)) return fail('PROTECTED_MERGE_PAYLOAD_DIGEST_INVALID');
  if (![PROTECTED_OPENCLAW_MERGE_MODE, PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE].includes(reviewMode)) {
    return fail('PROTECTED_MERGE_REVIEW_MODE_INVALID');
  }
  if (reviewMode === PROTECTED_OPENCLAW_MERGE_MODE
    && reviewFindingCode !== PROTECTED_OPENCLAW_MERGE_FINDING) {
    return fail('PROTECTED_MERGE_FINDING_INVALID');
  }
  if (reviewMode === PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE && reviewFindingCode !== '') {
    return fail('PROTECTED_MERGE_FINDING_NOT_ALLOWED');
  }
  if (mergeMethod !== 'squash') return fail('PROTECTED_MERGE_METHOD_INVALID');
  const expectedToken = reviewMode === PROTECTED_OPENCLAW_MERGE_MODE
    ? bootstrapApprovalToken(prNumber, expectedHead)
    : workflowApprovalToken(prNumber, expectedHead);
  if (mergeApprovalToken !== expectedToken) return fail('PROTECTED_MERGE_APPROVAL_TOKEN_INVALID');
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) return fail('PROTECTED_MERGE_EXPIRED');

  return Object.freeze({
    ok: true,
    command: Object.freeze({
      prNumber,
      expectedBase,
      reviewRunId,
      reviewRunAttempt,
      reviewJobId,
      reviewArtifactId,
      reviewArtifactDigest,
      reviewPayloadSha256,
      reviewMode,
      reviewFindingCode,
      mergeMethod: 'squash',
      mergeApprovalToken,
    }),
  });
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 120000,
    maxBuffer: options.maxBuffer || 2 * 1024 * 1024,
  });
}

function runOk(runCommand, executable, args, options, blocker) {
  const result = runCommand(executable, args, options);
  if (result?.error || result?.status !== 0) {
    throw new Error(blocker + ':' + (result?.error?.message || result?.stderr || result?.status || 'unknown'));
  }
  return result;
}

function validateLivePullRequest(pull, command) {
  return Boolean(
    pull?.state === 'open'
    && pull?.draft === false
    && pull?.mergeable === true
    && pull?.head?.sha === command.expectedHead
    && pull?.base?.ref === 'main'
    && pull?.base?.sha === command.expectedBase
    && Number(pull?.number) === command.prNumber
  );
}

function exactPullRequestRunAssociation(pr, pull, command) {
  return Boolean(
    Number(pr?.number) === command.prNumber
    && pr?.head?.sha === command.expectedHead
    && pr?.head?.ref === pull?.head?.ref
    && pr?.head?.repo?.url === CANONICAL_REPOSITORY_API_URL
    && pr?.base?.sha === command.expectedBase
    && pr?.base?.ref === 'main'
    && pr?.base?.repo?.url === CANONICAL_REPOSITORY_API_URL
  );
}

function expectedReviewRunName(command, binding) {
  return independentReviewWorkflowDispatchRunNameV1({
    prNumber: command.prNumber,
    sourceHead: command.expectedHead,
    handoffBindingSha256: binding,
  });
}

export function validateProtectedOpenClawReviewRunIdentity(run, pull, command) {
  const prs = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
  const common = Boolean(
    Number(run?.id) === command.reviewRunId
    && Number(run?.run_attempt) === command.reviewRunAttempt
    && run?.path === CANONICAL_REVIEW_WORKFLOW_PATH
    && run?.status === 'completed'
    && run?.conclusion === 'success'
    && run?.repository?.full_name === CANONICAL_REPOSITORY
    && run?.head_repository?.full_name === CANONICAL_REPOSITORY
    && pull?.head?.repo?.full_name === CANONICAL_REPOSITORY
    && pull?.base?.repo?.full_name === CANONICAL_REPOSITORY
    && typeof pull?.head?.ref === 'string'
    && pull.head.ref.length > 0
  );
  if (!common || run?.name !== run?.display_title) return false;

  if (run?.event === 'pull_request_target') {
    return run.name === expectedReviewRunName(command, LEGACY_PULL_REQUEST_TARGET_BINDING)
      && run?.head_sha === command.expectedHead
      && run?.head_branch === pull.head.ref
      && prs.length === 1
      && exactPullRequestRunAssociation(prs[0], pull, command);
  }

  if (run?.event === 'workflow_dispatch') {
    const prefix = expectedReviewRunName(command, '');
    const binding = String(run.name).startsWith(prefix) ? String(run.name).slice(prefix.length) : '';
    return SHA256.test(binding)
      && run.name === expectedReviewRunName(command, binding)
      && run?.head_sha === command.expectedBase
      && run?.head_branch === 'main'
      && prs.length === 0;
  }

  return false;
}

function validateReviewJob(payload, command) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.some((job) => (
    Number(job?.id) === command.reviewJobId
    && Number(job?.run_id) === command.reviewRunId
    && job?.name === 'independent-security-review'
    && job?.status === 'completed'
    && job?.conclusion === 'success'
  ));
}

export function validateProtectedOpenClawReviewArtifactMetadata(artifact, command, reviewRun) {
  const expectedWorkflowHead = reviewRun?.event === 'workflow_dispatch'
    ? command.expectedBase
    : command.expectedHead;
  const expectedWorkflowBranch = reviewRun?.event === 'workflow_dispatch'
    ? 'main'
    : reviewRun?.head_branch;
  return Boolean(
    Number(artifact?.id) === command.reviewArtifactId
    && artifact?.name === 'stephanos-independent-review-' + command.reviewRunId + '-attempt-' + command.reviewRunAttempt
    && artifact?.expired === false
    && String(artifact?.digest || '').toLowerCase() === command.reviewArtifactDigest
    && Number(artifact?.workflow_run?.id) === command.reviewRunId
    && artifact?.workflow_run?.head_sha === expectedWorkflowHead
    && artifact?.workflow_run?.head_branch === expectedWorkflowBranch
  );
}

export const validateProtectedOpenClawMergeChecks = validateProtectedMergeCheckRows;

export function validateProtectedOpenClawBootstrapFindings(findings, expectedCode = PROTECTED_OPENCLAW_MERGE_FINDING) {
  if (!Array.isArray(findings)
    || findings.length < 1
    || findings.length > PROTECTED_OPENCLAW_MERGE_MAX_BOOTSTRAP_FINDINGS) return false;
  const paths = new Set();
  for (const finding of findings) {
    const path = String(finding?.path || '').trim();
    if (finding?.severity !== 'P0'
      || finding?.code !== expectedCode
      || !path
      || !PROTECTED_OPENCLAW_BOOTSTRAP_PATHS.has(path)
      || paths.has(path)) return false;
    paths.add(path);
  }
  return true;
}

function validateArtifactPayload(artifact, pull, command) {
  const validation = validateIndependentReviewArtifact(artifact, {
    repository: 'Cheekyfellastef/stephan-os',
    prNumber: command.prNumber,
    branch: pull.head.ref,
    expectedHead: command.expectedHead,
    expectedBaseSha: command.expectedBase,
    expectedPayloadSha256: command.reviewPayloadSha256,
    workflowRunId: command.reviewRunId,
    workflowRunAttempt: command.reviewRunAttempt,
  });
  const findings = Array.isArray(artifact?.receipt?.findings) ? artifact.receipt.findings : [];
  if (!validation.valid
    || artifact?.reviewMode !== command.reviewMode
    || artifact?.receipt?.riskTier !== 'high'
    || artifact?.receipt?.assuranceMode !== 'specialist'
    || artifact?.receipt?.blocker !== '') return false;

  if (command.reviewMode === PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE) {
    return artifact?.receipt?.verdict === 'clean' && findings.length === 0;
  }

  return Boolean(
    artifact?.receipt?.verdict === 'findings'
    && Array.isArray(artifact?.receipt?.reviewScope)
    && artifact.receipt.reviewScope.includes('operator-protected-bootstrap-required')
    && validateProtectedOpenClawBootstrapFindings(findings, command.reviewFindingCode)
  );
}

export function buildProtectedOpenClawMergePlan(command = {}, options = {}) {
  const validation = validateProtectedOpenClawMergeCommand(command, options);
  if (!validation.ok) return validation;
  const normalized = { ...command, ...validation.command };
  const userProfile = resolve(options.userProfile || process.env.USERPROFILE || homedir());
  const repositoryRoot = resolve(options.repositoryRoot || join(userProfile, 'Documents', 'GitHub', 'stephan-os'));
  const missionRoot = resolve(options.missionRoot || join(userProfile, 'Documents', 'OpenClaw-Standalone', 'mission-runner'));
  const authorizationId = 'protected-merge-pr-' + normalized.prNumber + '-' + normalized.expectedHead.slice(0, 12);
  const artifactName = 'stephanos-independent-review-' + normalized.reviewRunId + '-attempt-' + normalized.reviewRunAttempt;
  const requestRoot = resolve(missionRoot, 'requests', authorizationId);
  const issuedAt = options.now instanceof Date ? options.now.toISOString() : new Date().toISOString();
  const expiresAt = new Date(Math.min(Date.parse(normalized.expiresAt), Date.parse(issuedAt) + 10 * 60 * 1000)).toISOString();
  const claims = Object.freeze({
    authorizationId,
    missionId: 'goal-1574-pr-' + normalized.prNumber + '-protected-merge',
    operation: 'merge-pr',
    repository: 'Cheekyfellastef/stephan-os',
    repositoryRoot,
    defaultBranch: 'main',
    baseBranch: 'main',
    branch: 'openclaw/protected-merge-pr-' + normalized.prNumber,
    worktreePath: repositoryRoot,
    allowedFiles: [],
    changedFiles: [],
    prNumber: normalized.prNumber,
    expectedHeadSha: normalized.expectedHead,
    singleUse: true,
    issuedAt,
    expiresAt,
  });
  return Object.freeze({
    ok: true,
    normalized: Object.freeze(normalized),
    repositoryRoot,
    missionRoot,
    requestRoot,
    claimsPath: resolve(requestRoot, 'claims.json'),
    requestPath: resolve(requestRoot, 'request.json'),
    artifactRoot: resolve(requestRoot, 'review-artifact'),
    artifactPath: resolve(requestRoot, 'review-artifact', 'independent-review-result.json'),
    privateKeyPath: resolve(missionRoot, 'keys', 'stephanos-github-authorization-private.pem'),
    issuerScript: resolve(repositoryRoot, 'scripts', 'stephanos-issue-openclaw-github-authorization.mjs'),
    bridgeScript: resolve(repositoryRoot, 'scripts', 'windows', 'invoke-openclaw-github-operator-bridge.ps1'),
    artifactName,
    claims,
  });
}

export function buildProtectedOperatorWorkflowDispatchArgs(plan, pull, headTree) {
  if (!plan?.ok || plan.normalized?.reviewMode !== PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE
    || !pull?.head?.ref || !SHA40.test(String(headTree || '').toLowerCase())) return null;
  return Object.freeze([
    'workflow', 'run', PROTECTED_OPERATOR_MERGE_WORKFLOW,
    '--repo', 'Cheekyfellastef/stephan-os',
    '--ref', 'main',
    '-f', 'mode=' + PROTECTED_OPERATOR_MERGE_WORKFLOW_MODE,
    '-f', 'pr_number=' + plan.normalized.prNumber,
    '-f', 'expected_branch=' + pull.head.ref,
    '-f', 'expected_head=' + plan.normalized.expectedHead,
    '-f', 'expected_head_tree=' + String(headTree).toLowerCase(),
    '-f', 'expected_base=' + plan.normalized.expectedBase,
    '-f', 'independent_review_run_id=' + plan.normalized.reviewRunId,
    '-f', 'independent_review_run_attempt=' + plan.normalized.reviewRunAttempt,
    '-f', 'independent_review_artifact_id=' + plan.normalized.reviewArtifactId,
    '-f', 'independent_review_artifact_digest=' + plan.normalized.reviewArtifactDigest,
    '-f', 'independent_review_payload_sha256=' + plan.normalized.reviewPayloadSha256,
  ]);
}

function latestMatchingWorkflowRun(payload, plan) {
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  return runs.find((run) => (
    run?.name === 'Protected Operator Merge Queue Boundary'
    && run?.event === 'workflow_dispatch'
    && run?.head_sha === plan.normalized.expectedBase
    && String(run?.display_title || '').includes(plan.normalized.expectedHead)
  )) || null;
}

export async function executeProtectedOpenClawMergeOnBattleBridge(command = {}, options = {}) {
  const plan = buildProtectedOpenClawMergePlan(command, options);
  if (!plan.ok) return plan;
  const platform = options.platform || process.platform;
  if (platform !== 'win32') return fail('PROTECTED_MERGE_WINDOWS_REQUIRED');
  const runCommand = options.runCommand || defaultRun;
  if (!existsSync(plan.repositoryRoot)) return fail('PROTECTED_MERGE_LOCAL_IDENTITY_MISSING', { path: plan.repositoryRoot });
  if (plan.normalized.reviewMode === PROTECTED_OPENCLAW_MERGE_MODE) {
    for (const path of [plan.privateKeyPath, plan.issuerScript, plan.bridgeScript]) {
      if (!existsSync(path)) return fail('PROTECTED_MERGE_LOCAL_IDENTITY_MISSING', { path });
    }
  }

  mkdirSync(plan.requestRoot, { recursive: true });
  try {
    const pull = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
      'api', 'repos/Cheekyfellastef/stephan-os/pulls/' + plan.normalized.prNumber,
    ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_PR_PREFLIGHT_FAILED').stdout, 'PROTECTED_MERGE_PR_JSON_INVALID');
    if (!validateLivePullRequest(pull, plan.normalized)) return fail('PROTECTED_MERGE_PR_IDENTITY_CHANGED');

    const checks = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
      'pr', 'checks', String(plan.normalized.prNumber), '--repo', 'Cheekyfellastef/stephan-os',
      '--json', 'name,state,workflow',
    ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_CHECKS_FAILED').stdout, 'PROTECTED_MERGE_CHECKS_JSON_INVALID');
    if (!validateProtectedOpenClawMergeChecks(checks)) return fail('PROTECTED_MERGE_CHECKS_NOT_ALL_SUCCESS');

    const reviewRun = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
      'api', 'repos/Cheekyfellastef/stephan-os/actions/runs/' + plan.normalized.reviewRunId,
    ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_REVIEW_RUN_FAILED').stdout, 'PROTECTED_MERGE_REVIEW_RUN_JSON_INVALID');
    if (!validateProtectedOpenClawReviewRunIdentity(reviewRun, pull, plan.normalized)) return fail('PROTECTED_MERGE_REVIEW_RUN_IDENTITY_CHANGED');

    const jobs = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
      'api', 'repos/Cheekyfellastef/stephan-os/actions/runs/' + plan.normalized.reviewRunId + '/jobs',
    ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_REVIEW_JOB_FAILED').stdout, 'PROTECTED_MERGE_REVIEW_JOB_JSON_INVALID');
    if (!validateReviewJob(jobs, plan.normalized)) return fail('PROTECTED_MERGE_REVIEW_JOB_IDENTITY_CHANGED');

    const artifact = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
      'api', 'repos/Cheekyfellastef/stephan-os/actions/artifacts/' + plan.normalized.reviewArtifactId,
    ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_ARTIFACT_METADATA_FAILED').stdout, 'PROTECTED_MERGE_ARTIFACT_METADATA_JSON_INVALID');
    if (!validateProtectedOpenClawReviewArtifactMetadata(artifact, plan.normalized, reviewRun)) return fail('PROTECTED_MERGE_ARTIFACT_IDENTITY_CHANGED');

    mkdirSync(plan.artifactRoot, { recursive: true });
    runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
      'run', 'download', String(plan.normalized.reviewRunId), '--repo', 'Cheekyfellastef/stephan-os',
      '--name', plan.artifactName, '--dir', plan.artifactRoot,
    ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_ARTIFACT_DOWNLOAD_FAILED');
    const artifactPayload = parseJson(readFileSync(plan.artifactPath, 'utf8'), 'PROTECTED_MERGE_ARTIFACT_PAYLOAD_JSON_INVALID');
    if (!validateArtifactPayload(artifactPayload, pull, plan.normalized)) return fail('PROTECTED_MERGE_ARTIFACT_PAYLOAD_CHANGED');

    const pullAgain = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
      'api', 'repos/Cheekyfellastef/stephan-os/pulls/' + plan.normalized.prNumber,
    ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_FINAL_PR_PREFLIGHT_FAILED').stdout, 'PROTECTED_MERGE_FINAL_PR_JSON_INVALID');
    if (!validateLivePullRequest(pullAgain, plan.normalized)) return fail('PROTECTED_MERGE_FINAL_PR_IDENTITY_CHANGED');

    if (plan.normalized.reviewMode === PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE) {
      const main = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
        'api', 'repos/Cheekyfellastef/stephan-os/branches/main',
      ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_MAIN_PREFLIGHT_FAILED').stdout, 'PROTECTED_MERGE_MAIN_JSON_INVALID');
      if (main?.commit?.sha !== plan.normalized.expectedBase) return fail('PROTECTED_MERGE_MAIN_IDENTITY_CHANGED');
      const headCommit = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
        'api', 'repos/Cheekyfellastef/stephan-os/git/commits/' + plan.normalized.expectedHead,
      ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_HEAD_TREE_FAILED').stdout, 'PROTECTED_MERGE_HEAD_TREE_JSON_INVALID');
      const headTree = String(headCommit?.tree?.sha || '').toLowerCase();
      const dispatchArgs = buildProtectedOperatorWorkflowDispatchArgs(plan, pullAgain, headTree);
      if (!dispatchArgs) return fail('PROTECTED_MERGE_WORKFLOW_INPUTS_INVALID');
      runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, dispatchArgs, {
        cwd: plan.repositoryRoot,
      }, 'PROTECTED_MERGE_WORKFLOW_DISPATCH_FAILED');
      const runs = parseJson(runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.githubCli, [
        'api', 'repos/Cheekyfellastef/stephan-os/actions/workflows/' + PROTECTED_OPERATOR_MERGE_WORKFLOW + '/runs?event=workflow_dispatch&per_page=20',
      ], { cwd: plan.repositoryRoot }, 'PROTECTED_MERGE_WORKFLOW_RUN_LOOKUP_FAILED').stdout, 'PROTECTED_MERGE_WORKFLOW_RUN_LOOKUP_JSON_INVALID');
      const run = latestMatchingWorkflowRun(runs, plan);
      return Object.freeze({
        ok: true,
        finalVerdict: 'PROTECTED_OPERATOR_MERGE_WORKFLOW_DISPATCHED',
        prNumber: plan.normalized.prNumber,
        expectedHead: plan.normalized.expectedHead,
        expectedHeadTree: headTree,
        expectedBase: plan.normalized.expectedBase,
        reviewRunId: plan.normalized.reviewRunId,
        reviewArtifactId: plan.normalized.reviewArtifactId,
        workflow: PROTECTED_OPERATOR_MERGE_WORKFLOW,
        workflowRunId: Number(run?.id || 0),
        workflowRunStatus: String(run?.status || 'queued'),
        workflowRunConclusion: String(run?.conclusion || ''),
        directMergePerformed: false,
        arbitraryShellAllowed: false,
        adminBypassAllowed: false,
        directMainWriteAllowed: false,
        forcePushAllowed: false,
      });
    }

    writeFileSync(plan.claimsPath, JSON.stringify(plan.claims, null, 2) + '\n', 'utf8');
    const issuer = runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.node, [plan.issuerScript, plan.claimsPath], {
      cwd: plan.repositoryRoot,
      env: { ...process.env, STEPHANOS_GITHUB_AUTH_PRIVATE_KEY_PATH: plan.privateKeyPath },
    }, 'PROTECTED_MERGE_AUTHORIZATION_ISSUE_FAILED');
    const authorization = parseJson(issuer.stdout, 'PROTECTED_MERGE_AUTHORIZATION_JSON_INVALID');
    if (authorization?.finalVerdict !== 'STEPHANOS_AUTHORIZATION_ISSUED') return fail('PROTECTED_MERGE_AUTHORIZATION_NOT_ISSUED');
    writeFileSync(plan.requestPath, JSON.stringify({
      authorization,
      approvalToken: plan.normalized.mergeApprovalToken,
    }, null, 2) + '\n', 'utf8');

    const bridge = runOk(runCommand, BATTLE_BRIDGE_WINDOWS_HOST.powershell, [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', plan.bridgeScript,
      '-RequestPath', plan.requestPath,
      '-StephanosRepositoryRoot', plan.repositoryRoot,
    ], { cwd: plan.repositoryRoot, timeout: 180000 }, 'PROTECTED_MERGE_OPENCLAW_BRIDGE_FAILED');
    const fields = String(bridge.stdout || '').split(/\r?\n/).reduce((result, line) => {
      const index = line.indexOf('=');
      if (index > 0) result[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      return result;
    }, {});
    if (fields.FINAL_VERDICT !== 'OPENCLAW_GITHUB_OPERATION_PASS' || fields.EXECUTOR_EXIT_CODE !== '0') {
      return fail('PROTECTED_MERGE_OPENCLAW_RECEIPT_INVALID');
    }
    return Object.freeze({
      ok: true,
      finalVerdict: 'PROTECTED_OPENCLAW_PR_MERGE_EXECUTED',
      prNumber: plan.normalized.prNumber,
      expectedHead: plan.normalized.expectedHead,
      expectedBase: plan.normalized.expectedBase,
      reviewRunId: plan.normalized.reviewRunId,
      reviewArtifactId: plan.normalized.reviewArtifactId,
      authorizationId: plan.claims.authorizationId,
      operationResultPath: String(fields.RESULT_PATH || ''),
      missionSnapshotPath: String(fields.SNAPSHOT_PATH || ''),
      arbitraryShellAllowed: false,
      adminBypassAllowed: false,
      directMainWriteAllowed: false,
      forcePushAllowed: false,
    });
  } catch (error) {
    return fail('PROTECTED_MERGE_EXECUTION_FAILED', { error: error?.message || String(error) });
  } finally {
    rmSync(plan.requestRoot, { recursive: true, force: true });
  }
}
