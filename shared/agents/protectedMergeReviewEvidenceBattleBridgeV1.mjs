import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import { BATTLE_BRIDGE_WINDOWS_HOST } from './battleBridgeWindowsHosts.mjs';
import {
  INDEPENDENT_REVIEW_ARTIFACT_FILE,
  validateIndependentReviewArtifact,
  validateIndependentReviewArtifactSet,
} from './operatorMergeReviewArtifactV1.mjs';
import {
  PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
  validateProtectedOpenClawReviewArtifactMetadata,
  validateProtectedOpenClawReviewRunIdentity,
} from './protectedOpenClawMergeMailboxAdapter.mjs';

export const PROTECTED_MERGE_REVIEW_EVIDENCE_BATTLE_BRIDGE_SCHEMA =
  'stephanos.protected-merge-review-evidence-battle-bridge.v1';
export const PROTECTED_MERGE_REVIEW_WORKFLOW_PATH =
  '.github/workflows/independent-merge-security-review.yml';
export const PROTECTED_MERGE_REPOSITORY = 'Cheekyfellastef/stephan-os';

const SHA40 = /^[a-f0-9]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

function integer(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function defaultRun(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 60_000,
    maxBuffer: options.maxBuffer || 8 * 1024 * 1024,
  });
}

function fail(blocker, details = {}) {
  return Object.freeze({
    schemaVersion: PROTECTED_MERGE_REVIEW_EVIDENCE_BATTLE_BRIDGE_SCHEMA,
    ok: false,
    blocker,
    ...details,
  });
}

function jsonCommand(runCommand, executable, args, blocker, options = {}) {
  const result = runCommand(executable, args, options);
  if (result?.error || Number(result?.status) !== 0) {
    return fail(blocker, { error: text(result?.error?.message || result?.stderr || result?.stdout) });
  }
  try {
    return Object.freeze({ ok: true, payload: JSON.parse(String(result.stdout || '')) });
  } catch {
    return fail(`${blocker}_JSON_INVALID`);
  }
}

function provisionalCommand({ prNumber, expectedHead, expectedBase, run }) {
  return {
    prNumber,
    expectedHead,
    expectedBase,
    reviewRunId: integer(run?.id),
    reviewRunAttempt: integer(run?.run_attempt),
    reviewJobId: 1,
    reviewArtifactId: 1,
    reviewArtifactDigest: `sha256:${'0'.repeat(64)}`,
    reviewPayloadSha256: '0'.repeat(64),
    reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
    reviewFindingCode: '',
    mergeMethod: 'squash',
    mergeApprovalToken: `APPROVE_PROTECTED_WORKFLOW_SQUASH_MERGE:${prNumber}:${expectedHead}`,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

function candidateReviewRun(runs = [], pull = {}, identity = {}) {
  return (Array.isArray(runs) ? runs : [])
    .filter((run) => run?.status === 'completed' && run?.conclusion === 'success')
    .sort((left, right) => (
      Date.parse(text(right?.updated_at || right?.created_at)) - Date.parse(text(left?.updated_at || left?.created_at))
    ))
    .find((run) => validateProtectedOpenClawReviewRunIdentity(
      run,
      pull,
      provisionalCommand({ ...identity, run }),
    )) || null;
}

export function resolveProtectedMergeReviewEvidenceOnBattleBridgeV1(input = {}, options = {}) {
  const prNumber = integer(input.prNumber);
  const expectedHead = text(input.expectedHead).toLowerCase();
  const expectedBase = text(input.expectedBase).toLowerCase();
  if (!prNumber) return fail('PROTECTED_MERGE_REVIEW_PR_INVALID');
  if (!SHA40.test(expectedHead)) return fail('PROTECTED_MERGE_REVIEW_HEAD_INVALID');
  if (!SHA40.test(expectedBase)) return fail('PROTECTED_MERGE_REVIEW_BASE_INVALID');

  const runCommand = typeof options.runCommand === 'function' ? options.runCommand : defaultRun;
  const githubCli = text(options.githubCli) || text(BATTLE_BRIDGE_WINDOWS_HOST.githubCli) || 'gh';
  const repositoryRoot = text(options.repositoryRoot) || process.cwd();

  const pullResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${PROTECTED_MERGE_REPOSITORY}/pulls/${prNumber}`],
    'PROTECTED_MERGE_REVIEW_PR_READ_FAILED',
    { cwd: repositoryRoot },
  );
  if (!pullResult.ok) return pullResult;
  const pull = pullResult.payload;
  if (pull?.state !== 'open'
    || pull?.draft === true
    || integer(pull?.number) !== prNumber
    || text(pull?.head?.sha).toLowerCase() !== expectedHead
    || text(pull?.base?.ref) !== 'main'
    || text(pull?.base?.sha).toLowerCase() !== expectedBase
    || text(pull?.head?.repo?.full_name) !== PROTECTED_MERGE_REPOSITORY
    || text(pull?.base?.repo?.full_name) !== PROTECTED_MERGE_REPOSITORY) {
    return fail('PROTECTED_MERGE_REVIEW_PR_IDENTITY_CHANGED');
  }

  const runsResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${PROTECTED_MERGE_REPOSITORY}/actions/workflows/independent-merge-security-review.yml/runs?per_page=100`],
    'PROTECTED_MERGE_REVIEW_RUNS_READ_FAILED',
    { cwd: repositoryRoot },
  );
  if (!runsResult.ok) return runsResult;
  const run = candidateReviewRun(runsResult.payload?.workflow_runs, pull, {
    prNumber,
    expectedHead,
    expectedBase,
  });
  if (!run) return fail('PROTECTED_MERGE_REVIEW_EXACT_SUCCESSFUL_RUN_MISSING');

  const reviewRunId = integer(run.id);
  const reviewRunAttempt = integer(run.run_attempt);
  const jobsResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${PROTECTED_MERGE_REPOSITORY}/actions/runs/${reviewRunId}/jobs?filter=latest&per_page=100`],
    'PROTECTED_MERGE_REVIEW_JOBS_READ_FAILED',
    { cwd: repositoryRoot },
  );
  if (!jobsResult.ok) return jobsResult;
  const reviewJobs = (Array.isArray(jobsResult.payload?.jobs) ? jobsResult.payload.jobs : [])
    .filter((job) => (
      integer(job?.run_id) === reviewRunId
      && text(job?.name) === 'independent-security-review'
      && job?.status === 'completed'
      && job?.conclusion === 'success'
    ));
  if (reviewJobs.length !== 1) return fail('PROTECTED_MERGE_REVIEW_JOB_NOT_EXACT');
  const reviewJobId = integer(reviewJobs[0].id);
  if (!reviewJobId) return fail('PROTECTED_MERGE_REVIEW_JOB_ID_INVALID');

  const artifactsResult = jsonCommand(
    runCommand,
    githubCli,
    ['api', `repos/${PROTECTED_MERGE_REPOSITORY}/actions/runs/${reviewRunId}/artifacts?per_page=100`],
    'PROTECTED_MERGE_REVIEW_ARTIFACTS_READ_FAILED',
    { cwd: repositoryRoot },
  );
  if (!artifactsResult.ok) return artifactsResult;
  const artifactSet = validateIndependentReviewArtifactSet(artifactsResult.payload, {
    workflowRunId: reviewRunId,
    workflowRunAttempt: reviewRunAttempt,
  });
  if (!artifactSet.valid) {
    return fail('PROTECTED_MERGE_REVIEW_ARTIFACT_SET_INVALID', {
      reviewRunId,
      blockers: artifactSet.blockers,
    });
  }

  const artifactMetadata = artifactSet.artifact;
  const provisional = {
    ...provisionalCommand({
      prNumber,
      expectedHead,
      expectedBase,
      run,
    }),
    reviewJobId,
    reviewArtifactId: artifactSet.artifactId,
    reviewArtifactDigest: artifactSet.archiveDigest,
  };
  if (!validateProtectedOpenClawReviewArtifactMetadata(artifactMetadata, provisional, run)) {
    return fail('PROTECTED_MERGE_REVIEW_ARTIFACT_METADATA_MISMATCH');
  }

  const artifactName = artifactSet.artifactName;
  const scratch = mkdtempSync(join(tmpdir(), 'stephanos-protected-review-'));
  try {
    const download = runCommand(githubCli, [
      'run', 'download', String(reviewRunId),
      '--repo', PROTECTED_MERGE_REPOSITORY,
      '--name', artifactName,
      '--dir', scratch,
    ], { cwd: repositoryRoot, timeout: 120_000 });
    if (download?.error || Number(download?.status) !== 0) {
      return fail('PROTECTED_MERGE_REVIEW_ARTIFACT_DOWNLOAD_FAILED', {
        reviewRunId,
        error: text(download?.error?.message || download?.stderr || download?.stdout),
      });
    }
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(join(scratch, INDEPENDENT_REVIEW_ARTIFACT_FILE), 'utf8'));
    } catch {
      return fail('PROTECTED_MERGE_REVIEW_ARTIFACT_PAYLOAD_INVALID');
    }
    const payloadSha256 = text(artifact?.payloadSha256).toLowerCase();
    const validation = validateIndependentReviewArtifact(artifact, {
      repository: PROTECTED_MERGE_REPOSITORY,
      prNumber,
      branch: text(pull?.head?.ref),
      expectedHead,
      expectedBaseSha: expectedBase,
      expectedPayloadSha256: payloadSha256,
      workflowRunId: reviewRunId,
      workflowRunAttempt: reviewRunAttempt,
    });
    if (!validation.valid
      || artifact?.reviewMode !== PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE
      || artifact?.receipt?.verdict !== 'clean'
      || artifact?.receipt?.blocker !== ''
      || (Array.isArray(artifact?.receipt?.findings) && artifact.receipt.findings.length > 0)) {
      return fail('PROTECTED_MERGE_REVIEW_ARTIFACT_NOT_CLEAN', {
        reviewRunId,
        blockers: validation.blockers,
      });
    }

    return Object.freeze({
      schemaVersion: PROTECTED_MERGE_REVIEW_EVIDENCE_BATTLE_BRIDGE_SCHEMA,
      ok: true,
      blocker: '',
      repository: PROTECTED_MERGE_REPOSITORY,
      prNumber,
      branch: text(pull.head.ref),
      expectedHead,
      expectedBase,
      pull,
      reviewRunId,
      reviewRunAttempt,
      reviewJobId,
      reviewArtifactId: artifactSet.artifactId,
      reviewArtifactDigest: artifactSet.archiveDigest,
      reviewPayloadSha256: payloadSha256,
      reviewMode: PROTECTED_OPERATOR_WORKFLOW_MERGE_MODE,
      reviewFindingCode: '',
      reviewRunUrl: text(run?.html_url),
      artifactName,
      finalVerdict: 'PROTECTED_MERGE_REVIEW_EVIDENCE_READY',
    });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
