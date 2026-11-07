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

// A hosted READY payload is untrusted until bound to its PR and repositories.
// Execute the real entry child with a bounded specialist stub in a temp CWD:
// no GitHub API token or network is required for these resource-admission checks.
test('READY prelaunch binds exact PR identity before specialist launch', async (t) => {
  const repository = 'Cheekyfellastef/stephan-os';
  const valid = {
    number: 3055,
    repository: { full_name: repository },
    pull_request: {
      number: 3055, draft: false,
      head: { sha: 'a'.repeat(40), ref: 'fix/2954-ready-guard', repo: { full_name: repository } },
      base: { sha: 'b'.repeat(40), ref: 'main', repo: { full_name: repository } },
    },
  };
  const changed = (mutation) => { const event = structuredClone(valid); mutation(event); return event; };
  const cases = [
    ['complete READY starts exactly one specialist', valid, true],
    ['READY missing event PR number', changed(e => { delete e.number; }), false],
    ['READY conflicting PR numbers', changed(e => { e.number = 3056; }), false],
    ['READY missing nested PR number', changed(e => { delete e.pull_request.number; }), false],
    ['READY nonnumeric PR number', changed(e => { e.pull_request.number = '3055'; }), false],
    ['READY missing head SHA', changed(e => { delete e.pull_request.head.sha; }), false],
    ['READY invalid head SHA', changed(e => { e.pull_request.head.sha = 'f'.repeat(39); }), false],
    ['READY missing base SHA', changed(e => { delete e.pull_request.base.sha; }), false],
    ['READY invalid base SHA', changed(e => { e.pull_request.base.sha = 'z'.repeat(40); }), false],
    ['READY missing head ref', changed(e => { delete e.pull_request.head.ref; }), false],
    ['READY missing head repository', changed(e => { delete e.pull_request.head.repo; }), false],
    ['READY foreign head repository', changed(e => { e.pull_request.head.repo.full_name = 'foreign/repo'; }), false],
    ['READY missing base repository', changed(e => { delete e.pull_request.base.repo; }), false],
    ['READY foreign base repository', changed(e => { e.pull_request.base.repo.full_name = 'foreign/repo'; }), false],
  ];
  for (const [name, event, mayLaunch] of cases) {
    await t.test(name, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'stephanos-ready-review-'));
      try {
        const { mkdir } = await import('node:fs/promises');
        await mkdir(join(dir, 'scripts'));
        await writeFile(join(dir, 'scripts', 'independent-merge-security-review-with-openclaw-specialist-v1.mjs'),
          "import { writeFileSync } from 'node:fs'; writeFileSync('started.txt', 'one child');\n");
        const eventPath = join(dir, 'event.json');
        await writeFile(eventPath, JSON.stringify(event));
        const result = spawnSync(process.execPath, [fileURLToPath(sourceUrl)], {
          cwd: dir, encoding: 'utf8', timeout: 10_000,
          env: {
            ...process.env, GITHUB_ACTIONS: 'true', GITHUB_JOB: 'independent-security-review',
            GITHUB_EVENT_NAME: 'pull_request_target', GITHUB_EVENT_PATH: eventPath,
            GITHUB_REPOSITORY: repository, GH_TOKEN: '', GITHUB_TOKEN: '',
          },
        });
        const { access } = await import('node:fs/promises');
        let launched = false;
        try { await access(join(dir, 'started.txt')); launched = true; } catch {}
        assert.equal(launched, mayLaunch, result.stderr);
        assert.equal(result.status, mayLaunch ? 0 : 1, result.stderr);
        if (!mayLaunch) assert.match(result.stderr, /INDEPENDENT_REVIEW_READY_IDENTITY_UNVERIFIED/);
      } finally { await rm(dir, { recursive: true, force: true }); }
    });
  }
});
