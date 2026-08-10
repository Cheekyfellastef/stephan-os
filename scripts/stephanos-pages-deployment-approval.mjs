const EXACT_REPOSITORY = 'Cheekyfellastef/stephan-os';
const EXACT_OPERATOR = 'Cheekyfellastef';
const EXACT_EVENT = 'workflow_dispatch';
const EXACT_REF = 'refs/heads/main';
const SHA40 = /^[a-f0-9]{40}$/;

function text(value) {
  return String(value ?? '').trim();
}

export function validateStephanosPagesDeploymentApproval(input = {}) {
  const eventName = text(input.eventName);
  const repository = text(input.repository);
  const actor = text(input.actor);
  const ref = text(input.ref);
  const refName = text(input.refName);
  const githubSha = text(input.githubSha).toLowerCase();
  const runAttempt = Number(text(input.runAttempt));
  const expectedHead = text(input.expectedHead).toLowerCase();
  const approvalToken = text(input.approvalToken);
  const blockers = [];

  if (eventName !== EXACT_EVENT) blockers.push('PAGES_DEPLOY_EVENT_NOT_MANUAL');
  if (repository !== EXACT_REPOSITORY) blockers.push('PAGES_DEPLOY_REPOSITORY_MISMATCH');
  if (actor !== EXACT_OPERATOR) blockers.push('PAGES_DEPLOY_OPERATOR_MISMATCH');
  if (ref !== EXACT_REF || refName !== 'main') blockers.push('PAGES_DEPLOY_REF_NOT_MAIN');
  if (!SHA40.test(githubSha)) blockers.push('PAGES_DEPLOY_GITHUB_SHA_INVALID');
  if (!Number.isSafeInteger(runAttempt) || runAttempt !== 1) blockers.push('PAGES_DEPLOY_RERUN_FORBIDDEN');
  if (!SHA40.test(expectedHead)) blockers.push('PAGES_DEPLOY_EXPECTED_HEAD_INVALID');
  if (SHA40.test(githubSha) && SHA40.test(expectedHead) && expectedHead !== githubSha) {
    blockers.push('PAGES_DEPLOY_EXPECTED_HEAD_MISMATCH');
  }
  const expectedToken = SHA40.test(expectedHead)
    ? `APPROVE_STEPHANOS_PAGES_DEPLOY:${expectedHead}`
    : '';
  if (!expectedToken || approvalToken !== expectedToken) blockers.push('PAGES_DEPLOY_APPROVAL_TOKEN_MISMATCH');

  return {
    schemaVersion: 'stephanos.pages-deployment-approval.v1',
    approved: blockers.length === 0,
    blocker: blockers[0] || '',
    blockers,
    repository,
    actor,
    ref,
    expectedHead,
    githubSha,
    runAttempt: Number.isSafeInteger(runAttempt) ? runAttempt : null,
    approvalTokenValid: Boolean(expectedToken && approvalToken === expectedToken),
    deploymentAuthority: blockers.length === 0,
  };
}

function environmentInput(env = process.env) {
  return {
    eventName: env.STEPHANOS_DEPLOY_EVENT_NAME,
    repository: env.STEPHANOS_DEPLOY_REPOSITORY,
    actor: env.STEPHANOS_DEPLOY_ACTOR,
    ref: env.STEPHANOS_DEPLOY_REF,
    refName: env.STEPHANOS_DEPLOY_REF_NAME,
    githubSha: env.STEPHANOS_DEPLOY_GITHUB_SHA,
    runAttempt: env.STEPHANOS_DEPLOY_RUN_ATTEMPT,
    expectedHead: env.STEPHANOS_DEPLOY_EXPECTED_HEAD,
    approvalToken: env.STEPHANOS_DEPLOY_APPROVAL_TOKEN,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = validateStephanosPagesDeploymentApproval(environmentInput());
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.approved) process.exitCode = 1;
}
