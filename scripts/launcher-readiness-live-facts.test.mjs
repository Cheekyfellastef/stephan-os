import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectLauncherReadinessLiveFacts, LIVE_COLLECTOR_AUTHORITY, main } from './launcher-readiness-live-facts.mjs';
import { createLauncherReadinessReport } from './launcher-readiness-report.mjs';

async function withRepo(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-live-facts-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function writeCurrentRecord(repoRoot, name = 'status.json', value = { status: 'READY' }, mtime = new Date()) {
  const current = path.join(repoRoot, 'runtime-activity', 'shared-workspace', 'current');
  fs.mkdirSync(current, { recursive: true });
  const file = path.join(current, name);
  fs.writeFileSync(file, JSON.stringify(value));
  fs.utimesSync(file, mtime, mtime);
}

function serviceProbeFor(readyIds) {
  return async (service) => ({ ready: readyIds.includes(service.id), evidence: { port: service.port, probe: 'fixture' } });
}

const cleanGit = () => '';

test('fixture: backend ready and OpenClaw ready with UI missing returns PARTIAL_UI_MISSING', async () => withRepo(async (repoRoot) => {
  writeCurrentRecord(repoRoot);
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, serviceProbe: serviceProbeFor(['backend', 'openclaw-gateway']), execFile: cleanGit });
  const report = createLauncherReadinessReport(facts);
  assert.equal(report.status, 'PARTIAL_UI_MISSING');
}));

test('fixture: all services ready returns READY', async () => withRepo(async (repoRoot) => {
  writeCurrentRecord(repoRoot);
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: cleanGit });
  assert.equal(createLauncherReadinessReport(facts).status, 'READY');
}));

test('fixture: stale shared workspace current records return STALE_WORKSPACE', async () => withRepo(async (repoRoot) => {
  writeCurrentRecord(repoRoot, 'status.json', { status: 'READY' }, new Date(Date.now() - 600_000));
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: cleanGit });
  const report = createLauncherReadinessReport(facts);
  assert.equal(report.status, 'STALE_WORKSPACE');
  assert.match(report.staleWorkspaceRecords[0], /stale/);
}));

test('fixture: source dirt returns BLOCKED_DIRTY_SOURCE', async () => withRepo(async (repoRoot) => {
  writeCurrentRecord(repoRoot);
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: () => ' M scripts/launcher-readiness-live-facts.mjs\n' });
  assert.equal(createLauncherReadinessReport(facts).status, 'BLOCKED_DIRTY_SOURCE');
}));

test('fixture: runtime-only dirt is a caveat and not a source blocker', async () => withRepo(async (repoRoot) => {
  writeCurrentRecord(repoRoot);
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: () => ' M runtime-activity/shared-workspace/current/status.json\n' });
  const report = createLauncherReadinessReport(facts);
  assert.equal(report.status, 'READY');
  assert.equal(report.caveats[0].id, 'runtime-only-dirt');
}));

test('live collector exposes no start, kill, service mutation, or arbitrary shell authority', () => {
  assert.deepEqual(LIVE_COLLECTOR_AUTHORITY, {
    executesArbitraryShell: false,
    startsServices: false,
    killsProcesses: false,
    mutatesRuntime: false,
    writesOutputOnlyWhenAsked: true,
  });
});

test('facts emitted by live collector are accepted by launcher-readiness-report facts-file flow', async () => withRepo(async (repoRoot) => {
  writeCurrentRecord(repoRoot);
  const cwd = process.cwd();
  const outDir = fs.mkdtempSync(path.join(cwd, '.tmp-live-facts-'));
  try {
    const out = path.join(outDir, 'facts.json');
    const oldCwd = process.cwd();
    process.chdir(repoRoot);
    const oldRepoCwd = process.cwd();
    process.chdir(cwd);
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot: oldRepoCwd, serviceProbe: serviceProbeFor(['backend', 'openclaw-gateway']), execFile: cleanGit });
    fs.writeFileSync(out, JSON.stringify(facts));
    let reportOutput = '';
    const { main: reportMain } = await import('./launcher-readiness-report.mjs');
    reportMain(['--facts-file', path.relative(cwd, out), '--json'], { write: (chunk) => { reportOutput += chunk; } });
    assert.equal(JSON.parse(reportOutput).status, 'PARTIAL_UI_MISSING');
    process.chdir(oldCwd);
  } finally {
    fs.rmSync(outDir, { recursive: true, force: true });
  }
}));

test('CLI output path is explicit and workspace-relative', async () => {
  await assert.rejects(() => main(['--output', '../facts.json'], { write() {} }), /Unsafe --output path rejected/);
});
