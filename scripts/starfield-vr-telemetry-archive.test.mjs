import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  readStarfieldVrTelemetryArchive,
  STARFIELD_VR_TELEMETRY_ARCHIVE_SCHEMA,
} from './starfield-vr-telemetry-archive.mjs';

const SHA = 'a'.repeat(40);
const HASH = 'b'.repeat(64);

async function fixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-vr-archive-'));
  const sessions = join(root, 'vr', 'starfield-vr-performance-sessions');
  await mkdir(sessions, { recursive: true });
  try { return await run(root, sessions); }
  finally { await rm(root, { recursive: true, force: true }); }
}
const id = (suffix) => 'starfield-vr-performance-20261019-2346' + suffix;

async function makeSession(root, sessionId, { csv = true, summary = true, session = true } = {}) {
  if (csv) await writeFile(join(root, sessionId + '.csv'), 'gpuUtilPct,applicationFrameTimeMs\n98,18\n');
  if (session) await writeFile(join(root, sessionId + '.json'), JSON.stringify({
    enteredAtUtc: '2026-10-19T22:45:00Z',
    routeIdentity: { provider: 'mutar-openxr', sourceHead: SHA, launchSessionId: 'starfield-vr-launch-1' },
    lifecycle: { status: 'COMPLETED', sampleCount: 38 },
  }));
  if (summary) await writeFile(join(root, sessionId + '.summary.json'), JSON.stringify({
    endedAtUtc: '2026-10-19T22:46:00Z',
    routeIdentity: { provider: 'mutar-openxr', sourceHead: SHA, launchSessionId: 'starfield-vr-launch-1' },
    configurationFingerprint: { sha256: HASH },
    sessionOutcome: 'COMPLETED',
    sampleCount: 38,
    avgApplicationFrameTimeMs: 18.2,
    p95ApplicationFrameTimeMs: 22,
    p99ApplicationFrameTimeMs: 24,
    avgDeliveredCadenceHz: 71.7,
    avgGpuUtilPct: 98,
    maxEyePresentationSkewMs: null,
    telemetryCompleteness: { missing: ['poseTiming'] },
    crashEvidence: [],
  }));
}

test('archive reads historic data and newly created sessions without changing the files', async () => {
  await fixture(async (workspaceRoot, sessionRoot) => {
    const first = id('00');
    const second = id('01');
    await makeSession(sessionRoot, first);
    const before = await readdir(sessionRoot);
    const old = await readStarfieldVrTelemetryArchive({ workspaceRoot });
    assert.equal(old.totalSessions, 1);
    assert.equal(old.newestSessionId, first);
    assert.equal(old.sessions[0].sourceHead, SHA);
    assert.equal(old.sessions[0].configurationFingerprintSha256, HASH);
    assert.equal(old.sessions[0].avgApplicationFrameTimeMs, 18.2);
    assert.equal(old.sessions[0].maxEyePresentationSkewMs, null);
    assert.equal(old.sessions[0].csvPresent, true);
    assert.equal(old.sessions[0].partialTelemetry, false);
    assert.equal(old.sessions[0].telemetryMissingCount, 1);
    assert.equal(old.schemaVersion, STARFIELD_VR_TELEMETRY_ARCHIVE_SCHEMA);
    assert.equal(old.readOnly, true);
    assert.equal(old.secretMaterialReturned, false);
    assert.equal(old.hostPathsReturned, false);
    assert.deepEqual(await readdir(sessionRoot), before);
    assert.doesNotMatch(JSON.stringify(old), /stephanos-vr-archive-|gpuUtilPct,applicationFrameTimeMs/);

    await makeSession(sessionRoot, second);
    const latest = await readStarfieldVrTelemetryArchive({ workspaceRoot, limit: 1 });
    assert.equal(latest.totalSessions, 2);
    assert.equal(latest.newestSessionId, second);
    assert.equal(latest.sessions[0].sessionId, second);
    assert.equal(latest.nextOffset, 1);
    const page2 = await readStarfieldVrTelemetryArchive({ workspaceRoot, offset: 1, limit: 1 });
    assert.equal(page2.sessions[0].sessionId, first);
    assert.equal(page2.nextOffset, null);
    assert.equal(page2.hasMore, false);
  });
});

test('archive identifies partial, CSV-only and receipt-only playtests without inventing FPS', async () => {
  await fixture(async (workspaceRoot, sessionRoot) => {
    const csvOnly = id('00');
    const receiptOnly = id('01');
    await makeSession(sessionRoot, csvOnly, { summary: false, session: false });
    await makeSession(sessionRoot, receiptOnly, { csv: false, summary: false });
    const result = await readStarfieldVrTelemetryArchive({ workspaceRoot });
    assert.equal(result.totalSessions, 2);
    assert.equal(result.sessions[0].sessionId, receiptOnly);
    assert.equal(result.sessions[0].summaryPresent, false);
    assert.equal(result.sessions[0].sampleCount, 38);
    assert.equal(result.sessions[0].csvPresent, false);
    assert.equal(result.sessions[0].partialTelemetry, true);
    assert.equal(result.sessions[1].avgApplicationFrameTimeMs, null);
    assert.equal(result.sessions[1].sampleCount, null);
    assert.equal(result.sessions[1].partialTelemetry, true);
  });
});

test('archive ignores unknown basenames, nested paths, symlinks, and missing directories', async () => {
  await fixture(async (workspaceRoot, sessionRoot) => {
    const real = id('01');
    await makeSession(sessionRoot, real);
    await writeFile(join(sessionRoot, 'credentials.json'), '{"token":"secret"}');
    await mkdir(join(sessionRoot, 'nested'));
    await writeFile(join(sessionRoot, 'nested', id('02') + '.csv'), 'anything');
    try { await symlink(join(sessionRoot, real + '.csv'), join(sessionRoot, id('03') + '.csv')); } catch {}
    const report = await readStarfieldVrTelemetryArchive({ workspaceRoot });
    assert.equal(report.totalSessions, 1);
    assert.equal(report.sessions[0].sessionId, real);
    assert.doesNotMatch(JSON.stringify(report), /credentials|secret/);
  });
  await fixture(async (workspaceRoot) => {
    await rm(join(workspaceRoot, 'vr'), { recursive: true, force: true });
    const missing = await readStarfieldVrTelemetryArchive({ workspaceRoot });
    assert.equal(missing.totalSessions, 0);
    assert.equal(missing.directoryAvailable, false);
    assert.equal(missing.finalVerdict, 'STARFIELD_VR_TELEMETRY_ARCHIVE_NO_SESSIONS');
    assert.equal(missing.unknownMeansGreen, false);
  });
});

test('archive refuses invalid or unbounded pages', async () => {
  await fixture(async (workspaceRoot) => {
    for (const args of [
      { offset: -1 }, { offset: 1_000_001 }, { limit: 0 }, { limit: 21 },
      { limit: '20' }, { offset: 1.5 },
    ]) {
      await assert.rejects(readStarfieldVrTelemetryArchive({ workspaceRoot, ...args }), /PAGE_INVALID/);
    }
  });
});

test('Sovereign Commander exposes archive via read-only local and bounded remote routes', async () => {
  const [core, mcp, remote] = await Promise.all([
    readFile(new URL('../shared/agents/sovereignCommanderV1.mjs', import.meta.url), 'utf8'),
    readFile(new URL('./sovereign-commander-mcp.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../shared/agents/sovereignCommanderRemoteMailboxV1.mjs', import.meta.url), 'utf8'),
  ]);
  assert.match(core, /'starfield-vr-telemetry-archive': frozen/);
  assert.match(core, /sovereign-starfield-telemetry-archive-page-invalid/);
  assert.match(mcp, /name: 'starfield_vr_telemetry_archive'/);
  assert.match(mcp, /readOnlyHint: true/);
  assert.match(remote, /safeStarfieldVrTelemetryArchiveProjection/);
  assert.match(remote, /SOVEREIGN_COMMANDER_REMOTE_STARFIELD_VR_ARCHIVE_RECEIPT_INVALID/);
});
