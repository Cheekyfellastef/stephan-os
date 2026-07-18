import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(new URL('./pr-estate-reconcile.mjs', import.meta.url));

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    ...options,
    env: { ...process.env, ...(options.env || {}) },
  });
}

function installFakeGh(directory) {
  const fakeModule = join(directory, 'fake-gh.mjs');
  const fakeSource = [
    "import { writeFileSync } from 'node:fs';",
    'const args = process.argv.slice(2);',
    "const mode = process.env.FAKE_GH_MODE || 'valid';",
    `const head = process.env.GH_HEAD_SHA || '${'a'.repeat(40)}';`,
    "if (args[0] === 'pr' && args[1] === 'list') {",
    '  process.stdout.write(JSON.stringify([{',
    '    number: 101,',
    "    title: 'Contained test PR',",
    "    body: '',",
    "    url: 'https://example.invalid/101',",
    '    isDraft: false,',
    "    headRefName: 'mutable-branch-name',",
    "    headRefOid: mode === 'invalid-sha' ? 'not-a-sha' : head,",
    "    baseRefName: 'main',",
    "    createdAt: '2026-07-18T00:00:00Z',",
    "    updatedAt: '2026-07-18T00:00:00Z',",
    "    mergeable: 'MERGEABLE',",
    '    labels: [],',
    '  }]));',
    "} else if (args[0] === 'api') {",
    "  if (process.env.GH_CAPTURE_PATH) writeFileSync(process.env.GH_CAPTURE_PATH, JSON.stringify(args), 'utf8');",
    '  process.stdout.write(JSON.stringify({ ahead_by: 0, behind_by: 3, files: [] }));',
    '} else {',
    "  process.stderr.write('unexpected fake gh arguments: ' + JSON.stringify(args));",
    '  process.exit(9);',
    '}',
    '',
  ].join('\n');
  writeFileSync(fakeModule, fakeSource, 'utf8');

  if (process.platform === 'win32') {
    writeFileSync(join(directory, 'gh.cmd'), `@echo off\r\n"${process.execPath}" "${fakeModule}" %*\r\n`, 'utf8');
  } else {
    const launcher = join(directory, 'gh');
    writeFileSync(launcher, `#!/bin/sh\nexec "${process.execPath}" "${fakeModule}" "$@"\n`, 'utf8');
    chmodSync(launcher, 0o755);
  }
}

test('CLI rejects malformed prepared snapshots instead of certifying an empty estate', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stephanos-pr-estate-malformed-'));
  const snapshot = join(directory, 'snapshot.json');
  const families = join(directory, 'families.json');
  writeJson(snapshot, { prs: [] });
  writeJson(families, { families: [] });

  const result = runCli(['--input', snapshot, '--families', families]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /prepared snapshot must be an array or an object with a pullRequests array/);
  assert.doesNotMatch(result.stdout, /PR_ESTATE_CONTROLLED/);
});


test('CLI rejects malformed family documents instead of erasing family constraints', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stephanos-pr-estate-malformed-families-'));
  const snapshot = join(directory, 'snapshot.json');
  const families = join(directory, 'families.json');
  writeJson(snapshot, { pullRequests: [{ number: 102, state: 'open', title: 'Active lane', headSha: 'c'.repeat(40), activeHint: true }] });
  writeJson(families, { familyDefinitions: [] });

  const result = runCli(['--input', snapshot, '--families', families]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /family document must be an array or an object with a families array/);
  assert.doesNotMatch(result.stdout, /PR_ESTATE_CONTROLLED/);
});

test('CLI compares the captured exact head SHA rather than the mutable branch name', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stephanos-pr-estate-captured-sha-'));
  installFakeGh(directory);
  const families = join(directory, 'families.json');
  const capture = join(directory, 'gh-api-args.json');
  const headSha = 'b'.repeat(40);
  writeJson(families, { families: [] });

  const result = runCli(['--from-gh', '--repository', 'owner/repo', '--compare', '--families', families], {
    env: {
      PATH: `${directory}${delimiter}${process.env.PATH || ''}`,
      GH_CAPTURE_PATH: capture,
      GH_HEAD_SHA: headSha,
    },
  });

  assert.equal(result.status, 0, result.stderr);
  const apiArgs = JSON.parse(readFileSync(capture, 'utf8'));
  assert.deepEqual(apiArgs, ['api', `repos/owner/repo/compare/main...${headSha}`]);
  assert.doesNotMatch(apiArgs.join(' '), /mutable-branch-name/);
  const ledger = JSON.parse(result.stdout);
  assert.equal(ledger.entries[0].evidence.comparedHeadSha, headSha);
  assert.equal(ledger.entries[0].evidence.comparisonHeadMatches, true);
});

test('CLI aborts compare collection when the captured head SHA is invalid', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stephanos-pr-estate-invalid-sha-'));
  installFakeGh(directory);
  const families = join(directory, 'families.json');
  const capture = join(directory, 'gh-api-args.json');
  writeJson(families, { families: [] });

  const result = runCli(['--from-gh', '--repository', 'owner/repo', '--compare', '--families', families], {
    env: {
      PATH: `${directory}${delimiter}${process.env.PATH || ''}`,
      GH_CAPTURE_PATH: capture,
      FAKE_GH_MODE: 'invalid-sha',
    },
  });

  assert.equal(result.status, 2);
  assert.match(result.stderr, /captured headRefOid is missing or invalid/);
  assert.equal(existsSync(capture), false);
});
