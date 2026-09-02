import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const workflowUrl = new URL('../../.github/workflows/exact-head-review-dispatch.yml', import.meta.url);
const deterministicReviewWorkflowUrl = new URL('../../.github/workflows/stephanos-exact-head-review.yml', import.meta.url);
const readWorkflow = () => fs.readFileSync(workflowUrl, 'utf8').replaceAll('\r\n', '\n');
const readDeterministicReviewWorkflow = () => fs.readFileSync(deterministicReviewWorkflowUrl, 'utf8').replaceAll('\r\n', '\n');

function workflowJob(source, name, nextName) {
  return source.match(new RegExp(`^  ${name}:\\n[\\s\\S]*?^  ${nextName}:`, 'm'))?.[0] || '';
}

function workflowStep(job, name, nextName) {
  return job.match(new RegExp(`^      - name: ${name}\\n[\\s\\S]*?^      - name: ${nextName}`, 'm'))?.[0] || '';
}

test('serializes every mutating coordinator trigger through one PR-scoped authority lock', () => {
  const workflow = readWorkflow();

  assert.match(workflow, /\n  plan:\n[\s\S]*STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY:\s*'true'/);
  assert.match(workflow, /targets:\s*\$\{\{ steps\.admit\.outputs\.targets \}\}/);
  assert.match(workflow, /target:\s*\$\{\{ fromJSON\(needs\.plan\.outputs\.targets\) \}\}/);
  assert.match(
    workflow,
    /group: exact-head-review-dispatch-\$\{\{ github\.repository \}\}-pr-\$\{\{ matrix\.target\.prNumber \}\}/,
  );
  assert.match(workflow, /cancel-in-progress:\s*false/);
  assert.match(workflow, /STEPHANOS_EXACT_HEAD_REVIEW_PR:\s*\$\{\{ matrix\.target\.prNumber \}\}/);
  assert.match(
    workflow,
    /STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD:\s*\$\{\{ fromJSON\(steps\.coordinate\.outputs\.retry_targets\)\[0\]\.exactHead \}\}/,
  );
  assert.match(workflow, /id: retry/);
  assert.match(workflow, /steps\.retry\.outputs\.decision == 'NO_MATCHING_RUN'/);
  assert.match(workflow, /node scripts\/launch-missing-independent-review-v1\.mjs/);
  assert.doesNotMatch(workflow, /format\('review-run-/);
  assert.doesNotMatch(workflow, /format\('head-/);
  assert.doesNotMatch(workflow, /format\('coordinator-/);
});

test('keeps verification read-only and plans global scans before per-PR mutation', () => {
  const workflow = readWorkflow();
  assert.match(workflow, /verify:\n[\s\S]*Progress: `VERIFIED_ONLY`/);
  assert.match(workflow, /plan:\n[\s\S]*Discover canonical PR targets without mutation/);
  assert.match(workflow, /coordinate:\n\s+needs: plan/);
  assert.match(workflow, /max-parallel:\s*4/);
});

test('pull-request planning succeeds neutrally without entering the real planner', () => {
  const workflow = readWorkflow();
  const plan = workflowJob(workflow, 'plan', 'coordinate');
  const neutral = workflowStep(
    plan,
    'Publish pull-request neutral planning truth',
    'Check out trusted default-branch planner',
  );
  const discovery = plan.match(
    /^      - name: Discover canonical PR targets without mutation\n[\s\S]*$/m,
  )?.[0] || '';

  assert.match(plan, /^  plan:\n    runs-on: ubuntu-latest/m);
  assert.match(neutral, /if: github\.event_name == 'pull_request'/);
  assert.match(neutral, /Progress: `PULL_REQUEST_PLAN_NEUTRAL`/);
  assert.doesNotMatch(neutral, /uses:|GITHUB_TOKEN|STEPHANOS_|node |gh |curl |workflow_dispatch|pull-requests: write|issues: write/);
  assert.match(
    discovery,
    /if: >-\n          github\.event_name != 'pull_request' &&\n          \(github\.event_name != 'issue_comment' \|\| github\.event\.issue\.pull_request != null\)/,
  );
  assert.match(discovery, /STEPHANOS_EXACT_HEAD_REVIEW_PLAN_ONLY:\s*'true'/);
});

test('every real planning dependency is gated away from pull-request verification', () => {
  const workflow = readWorkflow();
  const plan = workflowJob(workflow, 'plan', 'coordinate');
  const admitted = /if: >-\n          github\.event_name != 'pull_request' &&\n          \(github\.event_name != 'issue_comment' \|\| github\.event\.issue\.pull_request != null\)/g;
  assert.equal([...plan.matchAll(admitted)].length, 3);
  assert.match(plan, /permissions:\n      actions: read\n      contents: read\n      issues: read\n      pull-requests: read/);
  assert.match(workflow, /coordinate:\n    needs: plan\n    if: >-\n      needs\.plan\.outputs\.targets != ''/);
});

test('binds and artifacts the exact handoff for dispatch, wait, escalation and stalled states', () => {
  const workflow = readWorkflow();
  const coordinate = workflow.match(/^  coordinate:\n[\s\S]*$/m)?.[0] || '';
  const bind = workflowStep(
    coordinate,
    'Bind exact coordinator-run provenance to the exact review handoff',
    'Upload immutable coordinator-to-handoff run receipt',
  );
  const upload = workflowStep(
    coordinate,
    'Upload immutable coordinator-to-handoff run receipt',
    'Retry one exact failed canonical independent review',
  );

  assert.match(bind, /id: bind_handoff/);
  assert.match(bind, /always\(\)/);
  assert.match(bind, /steps\.coordinate\.outputs\.retry_targets != ''/);
  assert.match(bind, /steps\.coordinate\.outputs\.retry_targets != '\[\]'/);
  assert.match(bind, /STEPHANOS_REVIEW_HANDOFF_PR:\s*\$\{\{ matrix\.target\.prNumber \}\}/);
  assert.match(bind, /STEPHANOS_REVIEW_HANDOFF_HEAD:\s*\$\{\{ steps\.coordinate\.outputs\.exact_head \}\}/);
  assert.doesNotMatch(bind, /STEPHANOS_REVIEW_HANDOFF_COMMENT_ID/);
  assert.match(bind, /STEPHANOS_REVIEW_HANDOFF_RUN_RECEIPT_PATH:\s*\$\{\{ runner\.temp \}\}\/independent-review-handoff-run-receipt\.json/);
  assert.match(bind, /node scripts\/bind-independent-review-handoff-provenance-v1\.mjs/);

  assert.match(upload, /id: upload_handoff/);
  assert.match(upload, /always\(\)/);
  assert.match(upload, /steps\.bind_handoff\.outcome == 'success'/);
  assert.match(upload, /uses: actions\/upload-artifact@v4/);
  assert.match(upload, /name: stephanos-independent-review-handoff-\$\{\{ github\.run_id \}\}-attempt-\$\{\{ github\.run_attempt \}\}-comment-\$\{\{ steps\.bind_handoff\.outputs\.handoff_comment_id \}\}/);
  assert.match(upload, /path: \$\{\{ runner\.temp \}\}\/independent-review-handoff-run-receipt\.json/);
  assert.match(upload, /if-no-files-found: error/);
  assert.match(upload, /overwrite: false/);
});

test('launches a missing review only after exact retry classification and immutable handoff binding', () => {
  const workflow = readWorkflow();
  const coordinate = workflow.match(/^  coordinate:\n[\s\S]*$/m)?.[0] || '';
  const retry = workflowStep(
    coordinate,
    'Retry one exact failed canonical independent review',
    'Launch one exact missing canonical independent review',
  );
  const launch = coordinate.match(
    /^      - name: Launch one exact missing canonical independent review\n[\s\S]*$/m,
  )?.[0] || '';

  assert.match(retry, /id: retry/);
  assert.match(retry, /node scripts\/retry-independent-review\.mjs/);
  assert.match(retry, /STEPHANOS_INDEPENDENT_REVIEW_RETRY_PR:\s*\$\{\{ matrix\.target\.prNumber \}\}/);
  assert.match(retry, /STEPHANOS_INDEPENDENT_REVIEW_RETRY_HEAD:\s*\$\{\{ fromJSON\(steps\.coordinate\.outputs\.retry_targets\)\[0\]\.exactHead \}\}/);

  assert.match(launch, /always\(\)/);
  assert.match(launch, /steps\.bind_handoff\.outcome == 'success'/);
  assert.match(launch, /steps\.upload_handoff\.outcome == 'success'/);
  assert.match(launch, /steps\.retry\.outcome == 'success'/);
  assert.match(launch, /steps\.retry\.outputs\.decision == 'NO_MATCHING_RUN'/);
  assert.match(launch, /STEPHANOS_REVIEW_HANDOFF_RUN_RECEIPT_PATH:\s*\$\{\{ runner\.temp \}\}\/independent-review-handoff-run-receipt\.json/);
  assert.match(launch, /node scripts\/launch-missing-independent-review-v1\.mjs/);
  assert.doesNotMatch(launch, /curl|gh\s+api|workflow_dispatch|\/dispatches|shell:\s*true/);
});

test('binds deterministic assurance to exact current protected main and canonical admission', () => {
  const workflow = readDeterministicReviewWorkflow();

  assert.match(workflow, /current_main_sha="\$\(gh api "\/repos\/\$\{REPOSITORY\}\/git\/ref\/heads\/main" --jq '\.object\.sha'\)"/);
  assert.match(workflow, /test "\$\{base_ref\}" = "main"/);
  assert.match(workflow, /echo "base_sha=\$\{current_main_sha\}" >> "\$\{GITHUB_OUTPUT\}"/);
  assert.match(workflow, /name: Admit exact current-main review target/);
  assert.match(workflow, /node scripts\/exact-head-review-current-main-admission-v1\.mjs/);
  assert.match(workflow, /name: Require exact current-main admission/);
  assert.match(workflow, /test "\$\{ADMITTED_TARGETS\}" = "\[\{\\\"prNumber\\\":\$\{PR_NUMBER\}\}\]"/);
  assert.doesNotMatch(workflow, /base_sha="\$\(jq -r '\.base\.sha'/);
});

test('isolates provider-neutral assurance intake from Codex review command vocabulary', () => {
  const workflow = readDeterministicReviewWorkflow();

  assert.match(
    workflow,
    /startsWith\(github\.event\.comment\.body, '<!-- stephanos:provider-neutral-assurance:v1 head='\)/,
  );
  assert.match(workflow, /marker_prefix='<!-- stephanos:provider-neutral-assurance:v1 head='/);
  assert.match(workflow, /marker_suffix=' -->'/);
  assert.match(workflow, /first_line="\$\{COMMENT_BODY%%\$'\\n'\*\}"/);
  assert.match(workflow, /expected_head="\$\{first_line#\$\{marker_prefix\}\}"/);
  assert.match(workflow, /expected_head="\$\{expected_head%\$\{marker_suffix\}\}"/);
  assert.match(workflow, /\[\[ "\$\{expected_head\}" =~ \^\[0-9a-fA-F\]\{40\}\$ \]\]/);
  assert.match(workflow, /test "\$\{head_sha\}" = "\$\{expected_head\}"/);
  assert.match(workflow, /contains\(fromJSON\('\["OWNER","MEMBER","COLLABORATOR"\]'\), github\.event\.comment\.author_association\)/);
  assert.doesNotMatch(workflow, /\/stephanos-review|@codex|\/codex|chatgpt-codex/i);
});
