import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectLauncherReadinessLiveFacts, defaultWindowsSharedWorkspacePath, LIVE_COLLECTOR_AUTHORITY, main, resolveSharedWorkspaceRoot } from './launcher-readiness-live-facts.mjs';
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


function writeExternalCurrentRecord(workspaceRoot, name = 'status.json', value = { status: 'READY' }, mtime = new Date()) {
  const current = path.join(workspaceRoot, 'current');
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

test('live collector exposes no start, kill, service mutation, merge, push, command, or arbitrary shell authority', () => {
  assert.deepEqual(LIVE_COLLECTOR_AUTHORITY, {
    executesCommands: false,
    executesArbitraryShell: false,
    startsServices: false,
    killsProcesses: false,
    mergesOrPushes: false,
    mutatesRuntime: false,
    writesOutputOnlyWhenAsked: true,
  });
});


test('fixture external shared workspace with fresh current records returns shared-workspace ready', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-live-external-workspace-'));
  try {
    writeExternalCurrentRecord(workspaceRoot);
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: cleanGit });
    assert.equal(facts.observedFacts.services['shared-workspace'].ready, true);
    assert.equal(facts.observedFacts.services['shared-workspace'].evidence.workspaceRoot, workspaceRoot);
    assert.equal(facts.observedFacts.services['shared-workspace'].evidence.source, 'cli-arg');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));

test('fixture external shared workspace missing returns STALE_WORKSPACE with clear evidence path', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = path.join(os.tmpdir(), `missing-shared-workspace-${Date.now()}`);
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: cleanGit });
  const report = createLauncherReadinessReport(facts);
  assert.equal(report.status, 'STALE_WORKSPACE');
  assert.match(report.staleWorkspaceRecords[0], new RegExp(`${workspaceRoot.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*current.*missing`));
}));

test('--shared-workspace overrides default env workspace', async () => withRepo(async (repoRoot) => {
  const cliWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-cli-workspace-'));
  const envWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-env-workspace-'));
  try {
    writeExternalCurrentRecord(cliWorkspace);
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: cliWorkspace, env: { STEPHANOS_SHARED_WORKSPACE: envWorkspace }, serviceProbe: serviceProbeFor(['backend']), execFile: cleanGit });
    assert.equal(facts.observedFacts.services['shared-workspace'].evidence.workspaceRoot, cliWorkspace);
    assert.equal(facts.observedFacts.services['shared-workspace'].evidence.source, 'cli-arg');
  } finally {
    fs.rmSync(cliWorkspace, { recursive: true, force: true });
    fs.rmSync(envWorkspace, { recursive: true, force: true });
  }
}));

test('env STEPHANOS_SHARED_WORKSPACE is used when no CLI arg', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-env-shared-workspace-'));
  try {
    writeExternalCurrentRecord(workspaceRoot);
    const resolved = resolveSharedWorkspaceRoot(repoRoot, { env: { STEPHANOS_SHARED_WORKSPACE: workspaceRoot } });
    assert.equal(resolved.root, workspaceRoot);
    assert.equal(resolved.source, 'env:STEPHANOS_SHARED_WORKSPACE');
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));

test('Windows default path is represented without hardcoding username', () => {
  const resolved = defaultWindowsSharedWorkspacePath({ home: path.join('C:', 'Users', 'Fixture Operator'), platform: 'win32' });
  assert.match(resolved, /Documents[\\/]Stephanos-openclaw-workspace$/);
  assert.doesNotMatch(resolved, /Stephan Callear/);
});

test('repo-local fallback is marked as fallback', async () => withRepo(async (repoRoot) => {
  writeCurrentRecord(repoRoot);
  const facts = await collectLauncherReadinessLiveFacts({ repoRoot, env: {}, platform: 'linux', serviceProbe: serviceProbeFor(['backend']), execFile: cleanGit });
  assert.equal(facts.observedFacts.services['shared-workspace'].evidence.source, 'repo-local-fallback');
  assert.equal(facts.observedFacts.services['shared-workspace'].evidence.fallback, true);
}));

test('backend+OpenClaw connected + UI missing + external fresh workspace returns PARTIAL_UI_MISSING, not STALE_WORKSPACE', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-partial-external-workspace-'));
  try {
    writeExternalCurrentRecord(workspaceRoot);
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend', 'openclaw-gateway']), execFile: cleanGit });
    const report = createLauncherReadinessReport(facts);
    assert.equal(report.status, 'PARTIAL_UI_MISSING');
    assert.deepEqual(report.staleWorkspaceRecords, []);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));

test('unsafe shared workspace traversal is rejected while external absolute paths are allowed', async () => withRepo(async (repoRoot) => {
  assert.throws(() => resolveSharedWorkspaceRoot(repoRoot, { sharedWorkspace: '../outside' }), /relative traversal/);
  const absolute = path.join(os.tmpdir(), 'safe-external-workspace');
  assert.equal(resolveSharedWorkspaceRoot(repoRoot, { sharedWorkspace: absolute }).root, absolute);
}));

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

function writeBattleBridgeCurrentRecord(workspaceRoot, channel, value = { status: 'READY' }, mtime = new Date()) {
  const dir = path.join(workspaceRoot, channel);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'battle-bridge-current.json');
  fs.writeFileSync(file, JSON.stringify(value));
  fs.utimesSync(file, mtime, mtime);
  return file;
}

function writeBattleBridgeCurrentSet(workspaceRoot, valueByChannel = {}, mtime = new Date()) {
  writeBattleBridgeCurrentRecord(workspaceRoot, 'status', valueByChannel.status ?? { status: 'READY' }, mtime);
  writeBattleBridgeCurrentRecord(workspaceRoot, 'proof', valueByChannel.proof ?? { status: 'READY' }, mtime);
  writeBattleBridgeCurrentRecord(workspaceRoot, 'events', valueByChannel.events ?? { event: 'heartbeat' }, mtime);
}

test('fixture with future current fresh record returns shared-workspace ready', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-future-current-workspace-'));
  try {
    writeExternalCurrentRecord(workspaceRoot, 'battle-bridge-current.json', { status: 'READY' });
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend']), execFile: cleanGit });
    assert.equal(facts.observedFacts.services['shared-workspace'].ready, true);
    assert.equal(facts.observedFacts.services['shared-workspace'].evidence.foundRecords.length, 1);
    assert.match(facts.observedFacts.services['shared-workspace'].evidence.foundRecords[0].path, /current.*battle-bridge-current\.json/);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));

test('fixture with status/proof/events fresh Battle Bridge records returns shared-workspace ready', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-battle-bridge-workspace-'));
  try {
    writeBattleBridgeCurrentSet(workspaceRoot);
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend']), execFile: cleanGit });
    assert.equal(facts.observedFacts.services['shared-workspace'].ready, true);
    assert.equal(facts.observedFacts.services['shared-workspace'].evidence.foundRecords.length, 3);
    assert.deepEqual(facts.observedFacts.staleWorkspaceRecords, []);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));

test('fixture matching observed UNKNOWN old Battle Bridge records returns STALE_WORKSPACE with stale and UNKNOWN evidence', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-observed-battle-bridge-workspace-'));
  try {
    const old = new Date(Date.now() - 38_939_000);
    writeBattleBridgeCurrentSet(workspaceRoot, { status: { status: 'UNKNOWN' }, proof: { status: 'UNKNOWN' }, events: { event: 'heartbeat' } }, old);
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend', 'stephanos-ui', 'openclaw-gateway']), execFile: cleanGit });
    const report = createLauncherReadinessReport(facts);
    assert.equal(report.status, 'STALE_WORKSPACE');
    assert.match(report.staleWorkspaceRecords.join('\n'), /status.*stale ageSeconds=/);
    assert.match(report.staleWorkspaceRecords.join('\n'), /proof.*UNKNOWN ageSeconds=/);
    assert.equal(facts.observedFacts.services['shared-workspace'].evidence.foundRecords.some((record) => record.unknownStatus), true);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));

test('fixture with status/proof/events present but no current directory does not report only current missing', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-no-current-with-records-'));
  try {
    const old = new Date(Date.now() - 600_000);
    writeBattleBridgeCurrentSet(workspaceRoot, { status: { status: 'UNKNOWN' }, proof: { status: 'UNKNOWN' }, events: { event: 'heartbeat' } }, old);
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend']), execFile: cleanGit });
    const stale = facts.observedFacts.staleWorkspaceRecords;
    assert.equal(stale.every((entry) => /current.*missing/.test(entry)), false);
    assert.match(stale.join('\n'), /battle-bridge-current\.json.*(?:stale|UNKNOWN)/);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));

test('fixture with no records anywhere reports missing records clearly', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-empty-workspace-'));
  try {
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend']), execFile: cleanGit });
    assert.equal(facts.observedFacts.services['shared-workspace'].ready, false);
    assert.match(facts.observedFacts.staleWorkspaceRecords.join('\n'), /current.*missing/);
    assert.match(facts.observedFacts.staleWorkspaceRecords.join('\n'), /status.*battle-bridge-current\.json missing/);
    assert.match(facts.observedFacts.staleWorkspaceRecords.join('\n'), /proof.*battle-bridge-current\.json missing/);
    assert.match(facts.observedFacts.staleWorkspaceRecords.join('\n'), /events.*battle-bridge-current\.json missing/);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));

test('backend+OpenClaw connected + UI missing + fresh status/proof/events records returns PARTIAL_UI_MISSING', async () => withRepo(async (repoRoot) => {
  const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-partial-battle-bridge-workspace-'));
  try {
    writeBattleBridgeCurrentSet(workspaceRoot);
    const facts = await collectLauncherReadinessLiveFacts({ repoRoot, sharedWorkspace: workspaceRoot, serviceProbe: serviceProbeFor(['backend', 'openclaw-gateway']), execFile: cleanGit });
    const report = createLauncherReadinessReport(facts);
    assert.equal(report.status, 'PARTIAL_UI_MISSING');
    assert.deepEqual(report.staleWorkspaceRecords, []);
  } finally {
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
  }
}));
