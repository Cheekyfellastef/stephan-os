// One read-only prior-failure invariant shared by mailbox admission and the protected executor.
export const PERSONAL_REPOSITORY_EVIDENCE_JOB = 'personal-repository-evidence';
export const PERSONAL_REPOSITORY_APPROVAL_JOB = 'operator-personal-repository-approval';
export const PERSONAL_REPOSITORY_MERGE_JOB = 'operator-personal-repository-squash-merge';
export const PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX = 8;

const REPOSITORY_PATTERN = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
function text(value) { return String(value ?? '').trim(); }
function strictPositiveInteger(value) { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0; }
function unique(values) { return [...new Set(values)]; }
function workflowRepository(run = {}) { return text(run?.repository?.full_name || run?.repository); }

export function validatePersonalRepositoryPriorJobEnvelope(run = {}, job = {}) {
  const blockers = [];
  const repository = workflowRepository(run);
  const runId = strictPositiveInteger(run?.id);
  const runAttempt = strictPositiveInteger(job?.run_attempt);
  const jobId = strictPositiveInteger(job?.id);
  const expectedJobUrl = `https://api.github.com/repos/${repository}/actions/jobs/${jobId}`;
  const expectedRunUrl = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  const expectedCheckRunUrl = `https://api.github.com/repos/${repository}/check-runs/${jobId}`;
  const expectedHtmlUrl = `https://github.com/${repository}/actions/runs/${runId}/job/${jobId}`;
  if (!REPOSITORY_PATTERN.test(repository)) blockers.push('prior-job-repository-invalid');
  if (!runId) blockers.push('prior-run-id-invalid');
  if (!jobId) blockers.push('prior-job-id-invalid');
  if (!runAttempt || runAttempt > strictPositiveInteger(run?.run_attempt)) blockers.push('prior-job-attempt-invalid');
  if (strictPositiveInteger(job?.run_id) !== runId) blockers.push('prior-job-parent-run-mismatch');
  if (text(job?.workflow_name) !== text(run?.name)) blockers.push('prior-job-workflow-name-mismatch');
  if (text(job?.head_branch) !== text(run?.head_branch)) blockers.push('prior-job-head-branch-mismatch');
  if (text(job?.head_sha).toLowerCase() !== text(run?.head_sha).toLowerCase()) blockers.push('prior-job-head-sha-mismatch');
  if (text(job?.url) !== expectedJobUrl) blockers.push('prior-job-api-url-mismatch');
  if (text(job?.run_url) !== expectedRunUrl) blockers.push('prior-job-run-url-mismatch');
  if (text(job?.check_run_url) !== expectedCheckRunUrl) blockers.push('prior-job-check-run-url-mismatch');
  if (text(job?.html_url) !== expectedHtmlUrl) blockers.push('prior-job-html-url-mismatch');
  return Object.freeze({
    valid: blockers.length === 0,
    receipt: blockers.length === 0 ? Object.freeze({
      id: jobId,
      runId,
      runAttempt,
      workflowName: text(job?.workflow_name),
      headBranch: text(job?.head_branch),
      headSha: text(job?.head_sha).toLowerCase(),
      name: text(job?.name),
      status: text(job?.status).toLowerCase(),
      conclusion: text(job?.conclusion).toLowerCase(),
      url: text(job?.url),
      runUrl: text(job?.run_url),
      checkRunUrl: text(job?.check_run_url),
      htmlUrl: text(job?.html_url),
    }) : null,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_PRIOR_JOB_ENVELOPE_BLOCKED'
      : 'PERSONAL_REPOSITORY_PRIOR_JOB_ENVELOPE_READY',
  });
}

export function validatePersonalRepositoryReadOnlyPriorFailure(run = {}, jobs = []) {
  const blockers = [];
  const runId = strictPositiveInteger(run?.id);
  const runAttempt = strictPositiveInteger(run?.run_attempt);
  if (!runId) blockers.push('prior-run-id-invalid');
  if (!runAttempt) blockers.push('prior-run-attempt-invalid');
  if (runAttempt > PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX) {
    blockers.push('prior-run-attempt-limit-exceeded');
  }
  const boundedRunAttempt = runAttempt > 0 && runAttempt <= PERSONAL_REPOSITORY_PRIOR_ATTEMPT_JOB_PROOF_MAX
    ? runAttempt
    : 0;
  if (text(run?.status).toLowerCase() !== 'completed') blockers.push('prior-run-not-completed');
  if (text(run?.conclusion).toLowerCase() !== 'failure') blockers.push('prior-run-not-failed');
  if (!Array.isArray(jobs)) blockers.push('prior-run-jobs-invalid');
  const jobList = Array.isArray(jobs) ? jobs : [];
  const authorityJobNames = new Set([
    PERSONAL_REPOSITORY_EVIDENCE_JOB,
    PERSONAL_REPOSITORY_APPROVAL_JOB,
    PERSONAL_REPOSITORY_MERGE_JOB,
  ]);
  const authorityJobs = jobList.filter((job) => authorityJobNames.has(text(job?.name)));
  if (boundedRunAttempt && authorityJobs.length !== boundedRunAttempt * authorityJobNames.size) {
    blockers.push('prior-run-authority-job-estate-not-exact');
  }
  const exactJob = (name, attempt) => {
    const matches = authorityJobs.filter((job) => (
      text(job?.name) === name && strictPositiveInteger(job?.run_attempt) === attempt
    ));
    if (matches.length !== 1) blockers.push(`prior-run-job-not-exact:${attempt}:${name}`);
    return matches.length === 1 ? matches[0] : {};
  };
  const selectedJobs = [];
  for (let attempt = 1; attempt <= boundedRunAttempt; attempt += 1) {
    const evidence = exactJob(PERSONAL_REPOSITORY_EVIDENCE_JOB, attempt);
    const approval = exactJob(PERSONAL_REPOSITORY_APPROVAL_JOB, attempt);
    const merge = exactJob(PERSONAL_REPOSITORY_MERGE_JOB, attempt);
    selectedJobs.push(evidence, approval, merge);
    if (text(evidence?.status).toLowerCase() !== 'completed'
      || text(evidence?.conclusion).toLowerCase() !== 'failure') {
      blockers.push(`prior-run-evidence-job-not-failed:${attempt}`);
    }
    if (text(approval?.status).toLowerCase() !== 'completed'
      || text(approval?.conclusion).toLowerCase() !== 'skipped') {
      blockers.push(`prior-run-approval-job-not-skipped:${attempt}`);
    }
    if (text(merge?.status).toLowerCase() !== 'completed'
      || text(merge?.conclusion).toLowerCase() !== 'skipped') {
      blockers.push(`prior-run-merge-job-not-skipped:${attempt}`);
    }
  }
  const jobIds = selectedJobs.map((job) => strictPositiveInteger(job?.id));
  if (jobIds.some((id) => !id) || new Set(jobIds).size !== selectedJobs.length) {
    blockers.push('prior-run-job-id-invalid');
  }
  const jobEnvelopeReceipts = [];
  for (const job of selectedJobs) {
    const envelope = validatePersonalRepositoryPriorJobEnvelope(run, job);
    if (!envelope.valid) {
      blockers.push(...envelope.blockers.map((blocker) => `prior-run-job-envelope:${blocker}`));
    } else jobEnvelopeReceipts.push(envelope.receipt);
  }
  return Object.freeze({
    valid: blockers.length === 0,
    receipt: blockers.length === 0 ? Object.freeze({
      runId,
      runAttempt,
      status: 'completed',
      conclusion: 'failure',
      jobs: Object.freeze(jobEnvelopeReceipts),
    }) : null,
    blockers: Object.freeze(unique(blockers)),
    finalVerdict: blockers.length
      ? 'PERSONAL_REPOSITORY_PRIOR_FAILURE_NOT_RETRYABLE'
      : 'PERSONAL_REPOSITORY_PRIOR_FAILURE_READ_ONLY',
  });
}

