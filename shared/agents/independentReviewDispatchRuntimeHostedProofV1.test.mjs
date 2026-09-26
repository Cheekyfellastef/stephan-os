import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const prepareUrl = new URL('../../scripts/prepare-independent-review-workflow-dispatch-v1.mjs', import.meta.url);
const publisherUrl = new URL('../../scripts/publish-independent-review-terminal-findings-v1.mjs', import.meta.url);
const workflowUrl = new URL('../../.github/workflows/independent-merge-security-review.yml', import.meta.url);

async function source(url) {
  return readFile(url, 'utf8');
}

test('workflow-dispatch preparation snapshots only the trusted run identity environment', async () => {
  const text = await source(prepareUrl);
  for (const key of [
    'GITHUB_ACTIONS',
    'GITHUB_EVENT_NAME',
    'GITHUB_REPOSITORY',
    'GITHUB_WORKFLOW',
    'GITHUB_JOB',
    'GITHUB_REF',
    'GITHUB_SHA',
    'GITHUB_WORKFLOW_REF',
  ]) assert.match(text, new RegExp(`'${key}'`));
  assert.match(text, /function workflowDispatchEnvironment\(environment = process\.env\)/);
  assert.match(text, /return Object\.freeze\(snapshot\)/);
  assert.match(text, /environment: workflowDispatchEnvironment\(\)/);
  assert.doesNotMatch(text, /environment:\s*process\.env/);
});

test('pre-artifact review failure is persisted locally instead of widening reviewer comment authority', async () => {
  const text = await source(publisherUrl);
  const start = text.indexOf('if (!fs.existsSync(artifactPath))');
  const end = text.indexOf('const artifact = JSON.parse', start);
  assert.ok(start >= 0 && end > start);
  const failureBranch = text.slice(start, end);
  assert.match(failureBranch, /planIndependentReviewPreArtifactFailureReceiptV1/);
  assert.match(failureBranch, /exactPreArtifactFailurePath\(\)/);
  assert.match(failureBranch, /fs\.writeFileSync\(failurePath/);
  assert.match(failureBranch, /flag: 'wx'/);
  assert.match(failureBranch, /mode: 0o600/);
  assert.match(failureBranch, /write-pre-artifact-failure-artifact/);
  assert.doesNotMatch(failureBranch, /publishExactComment/);
  assert.doesNotMatch(failureBranch, /\/issues\/\$\{prNumber\}\/comments/);
});

test('review workflow uploads the exact blocked receipt without pull-request write permission', async () => {
  const text = await source(workflowUrl);
  assert.match(text, /issues: write/);
  assert.match(text, /pull-requests: read/);
  assert.doesNotMatch(text, /pull-requests: write/);
  assert.match(text, /id: terminal_findings/);
  assert.match(text, /steps\.terminal_findings\.outputs\.decision == 'PUBLISH_PRE_ARTIFACT_FAILURE_RECEIPT'/);
  assert.match(text, /stephanos-independent-review-pre-artifact-failure-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}/);
  assert.match(text, /\$\{\{ runner\.temp \}\}\/independent-review-pre-artifact-failure\.json/);
  assert.match(text, /if-no-files-found: error/);
  assert.match(text, /overwrite: false/);
});