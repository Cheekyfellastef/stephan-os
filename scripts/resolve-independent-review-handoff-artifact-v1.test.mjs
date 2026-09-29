import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('./resolve-independent-review-handoff-artifact-v1.mjs', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('resolver is workflow-dispatch-only and canonical-job-bound', async () => {
  const text = await source();
  assert.match(text, /GITHUB_ACTIONS !== 'true'/);
  assert.match(text, /GITHUB_EVENT_NAME\) !== 'workflow_dispatch'/);
  assert.match(text, /GITHUB_REPOSITORY\) !== CANONICAL_REPOSITORY/);
  assert.match(text, /GITHUB_JOB\) !== 'independent-security-review'/);
});

test('resolver accepts the exact same six dispatch inputs as Stage 1 admission', async () => {
  const text = await source();
  for (const key of [
    'pr_number',
    'source_head',
    'base_sha',
    'head_branch',
    'handoff_binding_sha256',
    'handoff_run_receipt_sha256',
  ]) assert.match(text, new RegExp(`'${key}'`));
  assert.match(text, /if \(!exactKeys\(event\?\.inputs, INPUT_KEYS\)\)/);
});

test('resolver revalidates PR main handoff and exact coordinator run before naming an artifact', async () => {
  const text = await source();
  assert.match(text, /\/pulls\/\$\{prNumber\}/);
  assert.match(text, /\/git\/ref\/heads\/main/);
  assert.match(text, /validateIndependentReviewHandoffIdentityV1\(/);
  assert.match(text, /\/actions\/runs\/\$\{runId\}/);
  assert.match(text, /workflow_id\) !== CANONICAL_COORDINATOR_WORKFLOW_ID/);
  assert.match(text, /run_attempt\) !== runAttempt/);
  assert.match(text, /head_sha\)\.toLowerCase\(\) !== baseSha/);
});

test('resolver preserves draft-safe review while keeping exact open PR identity checks', async () => {
  const text = await source();
  assert.doesNotMatch(text, /pullRequest\?\.draft === true/);
  assert.match(text, /text\(pullRequest\?\.state\)\.toLowerCase\(\) !== 'open'/);
  assert.match(text, /text\(pullRequest\?\.head\?\.sha\)\.toLowerCase\(\) !== sourceHead/);
  assert.match(text, /text\(pullRequest\?\.base\?\.sha\)\.toLowerCase\(\) !== baseSha/);
  assert.match(text, /text\(pullRequest\?\.base\?\.ref\) !== 'main'/);
});

test('resolver emits only bounded coordinator and artifact identity outputs', async () => {
  const text = await source();
  for (const output of [
    'coordinator_run_id',
    'coordinator_run_attempt',
    'handoff_comment_id',
    'artifact_name',
  ]) assert.match(text, new RegExp(`appendOutput\\('${output}'`));
  assert.match(text, /stephanos-independent-review-handoff-\$\{runId\}-attempt-\$\{runAttempt\}-comment-\$\{handoffCommentId\}/);
});

test('resolver GitHub helper is read-only by construction', async () => {
  const text = await source();
  assert.match(text, /async function githubRequest\(pathname, \{ token \} = \{\}\)/);
  assert.doesNotMatch(text, /method:/);
  assert.doesNotMatch(text, /body:\s*JSON\.stringify/);
});
