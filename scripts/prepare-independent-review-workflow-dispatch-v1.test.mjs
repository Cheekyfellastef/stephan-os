import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sourceUrl = new URL('./prepare-independent-review-workflow-dispatch-v1.mjs', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('preparation accepts exactly the six canonical workflow-dispatch inputs', async () => {
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
  assert.match(text, /workflow_dispatch inputs must use the exact six-field schema/);
});

test('preparation is GitHub-Actions-only and pinned to the canonical reviewer job', async () => {
  const text = await source();
  assert.match(text, /process\.env\.GITHUB_ACTIONS !== 'true'/);
  assert.match(text, /GITHUB_EVENT_NAME\) !== 'workflow_dispatch'/);
  assert.match(text, /GITHUB_REPOSITORY\) !== CANONICAL_REPOSITORY/);
  assert.match(text, /GITHUB_JOB\) !== 'independent-security-review'/);
});

test('preparation re-reads canonical PR main workflow and handoff truth without requiring ready state', async () => {
  const text = await source();
  assert.match(text, /\/pulls\/\$\{prNumber\}/);
  assert.match(text, /\/git\/ref\/heads\/main/);
  assert.match(text, /canonicalWorkflow\(owner, repo, token\)/);
  assert.match(text, /\/issues\/\$\{prNumber\}\/comments/);
  assert.match(text, /typeof pullRequest\?\.draft !== 'boolean'/);
  assert.doesNotMatch(text, /pullRequest\?\.draft === true/);
  assert.match(text, /head\?\.repo\?\.full_name/);
  assert.match(text, /base\?\.repo\?\.full_name/);
});

test('preparation requires exactly one trusted GitHub Actions review handoff', async () => {
  const text = await source();
  assert.match(text, /github-actions\[bot\]/);
  assert.match(text, /id: 41898282/);
  assert.match(text, /matches\.length !== 1/);
  assert.match(text, /validateIndependentReviewHandoffIdentityV1\(/);
});

test('preparation uses fixed receipt and preflight files with exclusive creation', async () => {
  const text = await source();
  assert.match(text, /const RECEIPT_FILE = 'independent-review-handoff-run-receipt\.json';/);
  assert.match(text, /const PREFLIGHT_FILE = 'independent-review-workflow-dispatch-preflight\.json';/);
  assert.match(text, /STEPHANOS_REVIEW_HANDOFF_RUN_RECEIPT_PATH/);
  assert.match(text, /STEPHANOS_INDEPENDENT_REVIEW_DISPATCH_PREFLIGHT_PATH/);
  assert.match(text, /buildIndependentReviewWorkflowDispatchPreflightV1\(/);
  assert.match(text, /flag: 'wx'/);
  assert.match(text, /mode: 0o600/);
});

test('preparation GitHub helper is GET-only by construction', async () => {
  const text = await source();
  assert.match(text, /async function githubRequest\(pathname, \{ token, itemKey = null \} = \{\}\)/);
  assert.match(text, /fetch\(`https:\/\/api\.github\.com\$\{pathname\}`/);
  assert.doesNotMatch(text, /method:/);
  assert.doesNotMatch(text, /body:\s*JSON\.stringify/);
});
