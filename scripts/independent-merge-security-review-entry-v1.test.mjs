import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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

test('draft pull_request_target exits before any GitHub read or specialist launch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'stephanos-draft-review-'));
  try {
    const path = join(dir, 'event.json');
    const event = {
      repository: { full_name: 'Cheekyfellastef/stephan-os' },
      pull_request: { draft: true, base: { ref: 'main' } },
    };
    await writeFile(path, JSON.stringify(event));
    const result = spawnSync(process.execPath, [fileURLToPath(sourceUrl)], {
      encoding: 'utf8', timeout: 10_000,
      env: {
        ...process.env,
        GITHUB_ACTIONS: 'true',
        GITHUB_JOB: 'independent-security-review',
        GITHUB_EVENT_NAME: 'pull_request_target',
        GITHUB_EVENT_PATH: path,
        GITHUB_REPOSITORY: 'Cheekyfellastef/stephan-os',
        GITHUB_TOKEN: '',
        GH_TOKEN: '',
      },
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /INDEPENDENT_REVIEW_DRAFT_HELD_NO_API_READS/);
    assert.doesNotMatch(result.stderr, /GitHub token is required|GitHub GET|https:\/\/api\.github/);
    for (const mutation of [
      { ...event, pull_request: { ...event.pull_request, draft: undefined } },
      { ...event, repository: { full_name: 'untrusted/elsewhere' } },
    ]) {
      await writeFile(path, JSON.stringify(mutation));
      const blocked = spawnSync(process.execPath, [fileURLToPath(sourceUrl)], {
        encoding: 'utf8', timeout: 10_000,
        env: {
          ...process.env, GITHUB_ACTIONS: 'true',
          GITHUB_JOB: 'independent-security-review',
          GITHUB_EVENT_NAME: 'pull_request_target',
          GITHUB_EVENT_PATH: path,
          GITHUB_REPOSITORY: 'Cheekyfellastef/stephan-os',
          GITHUB_TOKEN: '', GH_TOKEN: '',
        },
      });
      assert.equal(blocked.status, 1, blocked.stderr);
      assert.match(blocked.stderr, /INDEPENDENT_REVIEW_DRAFT_IDENTITY_UNVERIFIED/);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
