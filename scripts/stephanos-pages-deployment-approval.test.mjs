import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateStephanosPagesDeploymentApproval } from './stephanos-pages-deployment-approval.mjs';

const head = 'd'.repeat(40);

function command(patch = {}) {
  return {
    eventName: 'workflow_dispatch',
    repository: 'Cheekyfellastef/stephan-os',
    actor: 'Cheekyfellastef',
    ref: 'refs/heads/main',
    refName: 'main',
    githubSha: head,
    runAttempt: '1',
    expectedHead: head,
    approvalToken: `APPROVE_STEPHANOS_PAGES_DEPLOY:${head}`,
    ...patch,
  };
}

test('accepts one exact owner-authored manual main-head deployment approval', () => {
  const result = validateStephanosPagesDeploymentApproval(command());
  assert.equal(result.approved, true);
  assert.equal(result.blocker, '');
  assert.equal(result.expectedHead, head);
  assert.equal(result.githubSha, head);
  assert.equal(result.approvalTokenValid, true);
  assert.equal(result.deploymentAuthority, true);
});

test('rejects non-manual events so merging or pushing main cannot deploy', () => {
  const result = validateStephanosPagesDeploymentApproval(command({ eventName: 'push' }));
  assert.equal(result.approved, false);
  assert.equal(result.blocker, 'PAGES_DEPLOY_EVENT_NOT_MANUAL');
  assert.equal(result.deploymentAuthority, false);
});

test('rejects foreign repositories and actors', () => {
  assert.equal(
    validateStephanosPagesDeploymentApproval(command({ repository: 'other/repo' })).blocker,
    'PAGES_DEPLOY_REPOSITORY_MISMATCH',
  );
  assert.equal(
    validateStephanosPagesDeploymentApproval(command({ actor: 'other-user' })).blocker,
    'PAGES_DEPLOY_OPERATOR_MISMATCH',
  );
});

test('rejects any ref other than main', () => {
  const result = validateStephanosPagesDeploymentApproval(command({
    ref: 'refs/heads/feature',
    refName: 'feature',
  }));
  assert.equal(result.approved, false);
  assert.equal(result.blocker, 'PAGES_DEPLOY_REF_NOT_MAIN');
});

test('rejects malformed or drifting heads', () => {
  assert.equal(
    validateStephanosPagesDeploymentApproval(command({ expectedHead: 'short' })).blocker,
    'PAGES_DEPLOY_EXPECTED_HEAD_INVALID',
  );
  assert.equal(
    validateStephanosPagesDeploymentApproval(command({ githubSha: 'short' })).blocker,
    'PAGES_DEPLOY_GITHUB_SHA_INVALID',
  );
  assert.equal(
    validateStephanosPagesDeploymentApproval(command({ expectedHead: 'e'.repeat(40) })).blocker,
    'PAGES_DEPLOY_EXPECTED_HEAD_MISMATCH',
  );
});

test('rejects a workflow rerun so one dispatch cannot deploy twice', () => {
  const result = validateStephanosPagesDeploymentApproval(command({ runAttempt: '2' }));
  assert.equal(result.approved, false);
  assert.equal(result.blocker, 'PAGES_DEPLOY_RERUN_FORBIDDEN');
  assert.equal(result.deploymentAuthority, false);
});

test('rejects absent, stale, or spoofed approval tokens without returning token text', () => {
  for (const approvalToken of ['', `APPROVE_STEPHANOS_PAGES_DEPLOY:${'e'.repeat(40)}`, 'APPROVE_OTHER']) {
    const result = validateStephanosPagesDeploymentApproval(command({ approvalToken }));
    assert.equal(result.approved, false);
    assert.equal(result.blocker, 'PAGES_DEPLOY_APPROVAL_TOKEN_MISMATCH');
    assert.equal(result.approvalTokenValid, false);
    assert.equal(Object.hasOwn(result, 'approvalToken'), false);
  }
});

test('workflow is manual-only, exact-head-bound, and grants only the required Pages permissions per job', async () => {
  const workflow = await readFile(new URL('../.github/workflows/stephanos-deploy.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.match(workflow, /expected_head:\n\s+description: Full main SHA authorized for deployment/);
  assert.match(workflow, /approval_token:\n\s+description: APPROVE_STEPHANOS_PAGES_DEPLOY:<full-main-sha>/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /run: node scripts\/stephanos-pages-deployment-approval\.mjs/);
  assert.match(workflow, /STEPHANOS_DEPLOY_RUN_ATTEMPT: \$\{\{ github\.run_attempt \}\}/);

  const build = workflow.match(/  build:[\s\S]*?\n  deploy:/)?.[0] || '';
  const deploy = workflow.match(/  deploy:[\s\S]*$/)?.[0] || '';
  assert.match(build, /permissions:\n\s+contents: read\n\s+pages: write/);
  assert.doesNotMatch(build, /id-token: write/);
  assert.match(deploy, /permissions:\n\s+pages: write\n\s+id-token: write/);
  assert.doesNotMatch(deploy, /contents: write/);
  assert.equal((workflow.match(/uses: actions\/deploy-pages@v4/g) || []).length, 1);
});
