import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import {
  evaluateServedRuntimeExactHeadProof,
  runBattleBridgeIgnitionSupervisor,
} from './battle-bridge-ignition-supervisor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcherPath = resolve(root, 'windows/Launch-Stephanos-Local.ps1');

function canonicalSourceTruth() {
  return {
    branch: 'main',
    detachedHead: false,
    hasUpstream: true,
    upstreamBranch: 'origin/main',
    workingTreeDirty: false,
    aheadCount: 0,
    behindCount: 0,
    headPublished: true,
    blockedForRemoteTruth: false,
    publicationState: 'healthy-synced',
    head: '51600ceb1234567890abcdef1234567890abcdef',
    originHead: '51600ceb1234567890abcdef1234567890abcdef',
  };
}

function readyReport() {
  return {
    observedServices: {
      backend: { ready: true },
      'openclaw-gateway': { ready: true },
      'stephanos-ui': { ready: true },
      'shared-workspace': { ready: true },
    },
    staleWorkspaceRecords: [],
    caveats: [],
    safetyBlockers: [],
    finalVerdict: 'ready',
  };
}

test('self-consistent stale served commit and marker are rejected against current HEAD', () => {
  const proof = evaluateServedRuntimeExactHeadProof({
    currentHead: '51600ceb1234567890abcdef1234567890abcdef',
    health: {
      ok: true,
      gitCommit: '0f0aa30d',
      runtimeMarker: 'antifriction-live-v3::0f0aa30d::fixture',
    },
    dist: { ok: true, statusCode: 200 },
  });
  assert.equal(proof.gitCommitMatches, false);
  assert.equal(proof.runtimeMarkerMatches, false);
  assert.equal(proof.ready, false);
});

test('blocked served-runtime status preserves exact rejection proof', async () => {
  const sharedWorkspace = await mkdtemp(join(tmpdir(), 'stephanos-launcher-supervisor-freshness-'));
  const staleProof = Object.freeze({
    ready: false,
    currentHead: '51600ceb1234567890abcdef1234567890abcdef',
    healthOk: true,
    distOk: true,
    gitCommit: '0f0aa30d',
    runtimeMarker: 'antifriction-live-v3::0f0aa30d::fixture',
    gitCommitMatches: false,
    runtimeMarkerMatches: false,
  });
  try {
    const result = await runBattleBridgeIgnitionSupervisor({
      sharedWorkspace,
      housekeepFn: () => {},
      publisherFn: async () => {},
      sourceTruthFn: () => canonicalSourceTruth(),
      collectFactsFn: async () => readyReport(),
      plannerFn: (facts) => facts,
      currentHeadFn: () => staleProof.currentHead,
      runtimeProofFn: async () => staleProof,
      repairFn: async ({ stdout }) => { stdout.write(JSON.stringify({ ready: true })); return 0; },
      stdout: { write() {} },
    });
    assert.equal(result.ok, false);
    assert.equal(result.status.blockerId, 'served-runtime-stale');
    assert.deepEqual(result.status.services.stephanosUi4173.servedRuntimeProof, staleProof);
  } finally {
    await rm(sharedWorkspace, { recursive: true, force: true });
  }
});

test('Windows launcher ignores supervisor records from a previous ignition run', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /\$script:ignitionRunStartedAtUtc = \(Get-Date\)\.ToUniversalTime\(\)/);
  assert.match(source, /\$statusFile\.LastWriteTimeUtc -lt \$freshnessBoundaryUtc/);
  assert.match(source, /\[DateTimeOffset\]::TryParse\(\[string\]\$record\.generatedAt, \[ref\]\$generatedAtUtc\)/);
  assert.match(source, /\$generatedAtUtc\.UtcDateTime -lt \$freshnessBoundaryUtc/);
  assert.match(source, /battleBridgeSupervisorCurrentPath = \$battleBridgeSupervisorCurrentPath/);
});

test('standalone Windows UI repair passes a canonically proven exact head', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /battle-bridge-ignition-supervisor\.mjs --source-truth-json/);
  assert.match(source, /\$sourceTruth\.ok -ne \$true/);
  assert.match(source, /\$repairArgs \+= @\('--start', '--expected-head', \[string\]\$sourceTruth\.head\)/);
});
