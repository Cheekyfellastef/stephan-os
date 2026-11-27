import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

const sourceUrl = new URL('./independent-merge-security-review-entry-v1.mjs', import.meta.url);

async function source() {
  return readFile(sourceUrl, 'utf8');
}

test('entry routes through the composed OpenClaw specialist reviewer while preserving the legacy delegate', async () => {
  const text = await source();
  assert.match(text, /const REVIEW_WRAPPER = 'scripts\/independent-merge-security-review-with-openclaw-specialist-v1\.mjs';/);
  assert.match(text, /if \(eventName === 'pull_request_target'\) \{[\s\S]*?const child = launch\(process\.env\);/);
  assert.match(text, /spawnSync\(process\.execPath, \[REVIEW_WRAPPER\],[\s\S]*?shell: false,[\s\S]*?env,/);
  assert.doesNotMatch(text, /independent-merge-security-review-v2\.mjs/);
});

test('workflow_dispatch must pass the proven execution-context boundary before synthetic legacy execution', async () => {
  const text = await source();
  const contextIndex = text.indexOf('buildIndependentReviewExecutionContextV1({');
  const syntheticIndex = text.indexOf('const eventPath = writeSyntheticLegacyEvent(context);');
  const launchIndex = text.indexOf('const child = launch(prepared.env);');
  assert.ok(contextIndex >= 0);
  assert.ok(syntheticIndex > contextIndex);
  assert.ok(launchIndex > syntheticIndex);
  assert.match(text, /eventName: 'workflow_dispatch'/);
  assert.match(text, /legacyEvent: null/);
  assert.match(text, /GITHUB_EVENT_NAME: 'pull_request_target'/);
  assert.match(text, /STEPHANOS_INDEPENDENT_REVIEW_ORIGINAL_EVENT_NAME: 'workflow_dispatch'/);
});

test('dispatch preflight and synthetic event are fixed runner-temp files', async () => {
  const text = await source();
  assert.match(text, /const PREFLIGHT_FILE = 'independent-review-workflow-dispatch-preflight\.json';/);
  assert.match(text, /const SYNTHETIC_EVENT_FILE = 'independent-review-workflow-dispatch-event\.json';/);
  assert.match(text, /if \(requestedPath && resolve\(requestedPath\) !== expected\)/);
  assert.match(text, /flag: 'wx'/);
  assert.match(text, /mode: 0o600/);
  assert.match(text, /fs\.rmSync\(prepared\.eventPath, \{ force: false \}\);/);
});

test('entry cannot select an executable, shell, repository mutation or consequential authority', async () => {
  const text = await source();
  assert.doesNotMatch(text, /execSync|execFileSync|\beval\s*\(|Invoke-Expression/i);
  assert.doesNotMatch(text, /shell:\s*true/);
  assert.doesNotMatch(text, /git\s+(?:push|reset|clean|rebase)|gh\s+pr\s+(?:merge|ready)|Stop-Process|Restart-Computer|shutdown\.exe|taskkill/i);
  assert.doesNotMatch(text, /contents:\s*write|pull-requests:\s*write|deployments:\s*write/i);
});

test('only pull_request_target and workflow_dispatch are accepted', async () => {
  const text = await source();
  assert.match(text, /if \(eventName !== 'workflow_dispatch'\) \{/);
  assert.match(text, /Independent review event \$\{eventName \|\| 'unknown'\} is not allowlisted/);
  assert.match(text, /GITHUB_ACTIONS !== 'true'/);
  assert.match(text, /GITHUB_JOB\) !== 'independent-security-review'/);
});

test('trusted original #2954 pre-budget draft gate stops REST reads before GitHub quota, checkout and reviewer', async (t) => {
  const workflow = await readFile(new URL('../.github/workflows/independent-merge-security-review.yml', import.meta.url), 'utf8');
  const guardLabel = '      - name: Hold draft reviews before installation GitHub API reads';
  const guardStart = workflow.indexOf(guardLabel);
  const quotaStart = workflow.indexOf('      - name: Gate hosted review on its own GitHub installation API budget');
  const checkoutStart = workflow.indexOf('      - name: Check out trusted exact-base reviewer');
  const reviewerStart = workflow.indexOf('      - name: Review the complete exact-head and exact-base diff without mutation authority');
  assert.ok(guardStart > workflow.indexOf('jobs:'), 'only the original protected job can own this gate');
  assert.ok(quotaStart > guardStart, 'gate precedes the first gh api rate_limit call');
  assert.ok(checkoutStart > quotaStart && reviewerStart > checkoutStart, 'no expensive reviewer work before gate');
  const guard = workflow.slice(guardStart, quotaStart);
  assert.match(guard, /id: prebudget_draft_gate/);
  assert.match(guard, /REVIEW_EVENT_KIND: \$\{\{ github\.event_name \}\}/);
  assert.match(guard, /REVIEW_DRAFT_JSON: \$\{\{ toJSON\(github\.event\.pull_request\.draft\) \}\}/);
  assert.match(workflow, /if: \$\{\{ always\(\) && steps\.github_budget\.outcome == 'success' \}\}/);
  assert.doesNotMatch(guard, /GH_TOKEN|GITHUB_TOKEN|gh api|curl |wget |actions\/checkout|pull-requests: write/);
  const scriptMatch = guard.match(/        run: \|\n((?:          [^\n]*\n)+)/);
  assert.ok(scriptMatch, 'exact first-step shell script exists');
  const script = scriptMatch[1].split('\n').filter(line => line.startsWith('          ')).map(line => line.slice(10)).join('\n');
  const cases = [
    ['draft opened', 'pull_request_target', 'true', 1],
    ['draft synchronized', 'pull_request_target', 'true', 1],
    ['ready for review', 'pull_request_target', 'false', 0],
    ['draft field missing', 'pull_request_target', 'null', 1],
    ['string false is not boolean false', 'pull_request_target', '"false"', 1],
    ['foreign event not admitted', 'push', 'false', 1],
    ['existing coordinator dispatched with absent draft', 'workflow_dispatch', 'null', 0],
  ];
  for (const [label, kind, draft, expected] of cases) {
    await t.test(label, () => {
      const result = spawnSync('bash', ['-c', script], {
        encoding: 'utf8', timeout: 5_000,
        env: { ...process.env, REVIEW_EVENT_KIND: kind, REVIEW_DRAFT_JSON: draft },
      });
      assert.equal(result.status, expected, result.stderr);
      if (expected) assert.match(result.stdout, /INDEPENDENT_REVIEW_DRAFT_PRE_BUDGET_HOLD/);
      else assert.doesNotMatch(result.stdout, /INDEPENDENT_REVIEW_DRAFT_PRE_BUDGET_HOLD/);
    });
  }
});
