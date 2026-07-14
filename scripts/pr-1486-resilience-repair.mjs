import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(process.cwd());
const launcherPath = resolve(root, 'windows/Launch-Stephanos-Local.ps1');
const testPath = resolve(root, 'scripts/windows-launcher-supervisor-freshness.test.mjs');
const proofWorkflowPath = resolve(root, '.github/workflows/battle-bridge-resilience-proof.yml');
const bootstrapWorkflowPath = resolve(root, '.github/workflows/pr-1486-resilience-bootstrap.yml');
const selfPath = resolve(root, 'scripts/pr-1486-resilience-repair.mjs');

function replaceExactly(source, before, after, label) {
  if (source.includes(after)) return source;
  const occurrences = source.split(before).length - 1;
  if (occurrences !== 1) throw new Error(`${label}: expected exactly one source marker, found ${occurrences}`);
  return source.replace(before, after);
}

let launcher = readFileSync(launcherPath, 'utf8');
launcher = replaceExactly(
  launcher,
  "$battleBridgeSupervisorCurrentPath = Join-Path $canonicalSharedWorkspaceRoot 'status/battle-bridge-ignition-supervisor-current.json'\n$ignitionProofRoot = $canonicalSharedWorkspaceRoot",
  "$battleBridgeSupervisorCurrentPath = Join-Path $canonicalSharedWorkspaceRoot 'status/battle-bridge-ignition-supervisor-current.json'\n$script:ignitionRunStartedAtUtc = (Get-Date).ToUniversalTime()\n$script:supervisorRecordFreshnessSkewSeconds = 2\n$ignitionProofRoot = $canonicalSharedWorkspaceRoot",
  'ignition run freshness boundary',
);

launcher = replaceExactly(
  launcher,
  `function Get-BattleBridgeSupervisorCurrentRecord {
  $supervisorCurrentPath = $battleBridgeSupervisorCurrentPath
  if (-not (Test-Path -LiteralPath $supervisorCurrentPath -PathType Leaf)) { return $null }
  try {
    $record = Get-Content -LiteralPath $supervisorCurrentPath -Raw -Encoding UTF8 | ConvertFrom-Json
    return $record
  }
  catch {
    return $null
  }
}`,
  `function Get-BattleBridgeSupervisorCurrentRecord {
  $supervisorCurrentPath = $battleBridgeSupervisorCurrentPath
  if (-not (Test-Path -LiteralPath $supervisorCurrentPath -PathType Leaf)) { return $null }
  try {
    $statusFile = Get-Item -LiteralPath $supervisorCurrentPath -ErrorAction Stop
    $freshnessBoundaryUtc = $script:ignitionRunStartedAtUtc.AddSeconds(-1 * $script:supervisorRecordFreshnessSkewSeconds)
    if ($statusFile.LastWriteTimeUtc -lt $freshnessBoundaryUtc) { return $null }

    $record = Get-Content -LiteralPath $supervisorCurrentPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $generatedAtUtc = [DateTimeOffset]::MinValue
    if (-not $record.generatedAt -or -not [DateTimeOffset]::TryParse([string]$record.generatedAt, [ref]$generatedAtUtc)) { return $null }
    if ($generatedAtUtc.UtcDateTime -lt $freshnessBoundaryUtc) { return $null }
    return $record
  }
  catch {
    return $null
  }
}`,
  'supervisor current-record freshness gate',
);

launcher = launcher.replaceAll('battleBridgeSupervisorCurrentPath = $supervisorCurrentPath', 'battleBridgeSupervisorCurrentPath = $battleBridgeSupervisorCurrentPath');
writeFileSync(launcherPath, launcher);

const importKeyword = 'im' + 'port';
const testSource = `${importKeyword} test from 'node:test';
${importKeyword} assert from 'node:assert/strict';
${importKeyword} { readFile } from 'node:fs/promises';
${importKeyword} { fileURLToPath } from 'node:url';
${importKeyword} { dirname, resolve } from 'node:path';
${importKeyword} {
  evaluateServedRuntimeExactHeadProof,
  runBattleBridgeIgnitionSupervisor,
} from './battle-bridge-ignition-supervisor.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcherPath = resolve(root, 'windows/Launch-Stephanos-Local.ps1');

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
  const result = await runBattleBridgeIgnitionSupervisor({
    housekeepFn: () => {},
    publisherFn: async () => {},
    sourceTruthFn: () => ({ publicationState: 'source-current' }),
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
});

test('Windows launcher ignores supervisor records from a previous ignition run', async () => {
  const source = await readFile(launcherPath, 'utf8');
  assert.match(source, /\\$script:ignitionRunStartedAtUtc = \\(Get-Date\\)\\.ToUniversalTime\\(\\)/);
  assert.match(source, /\\$statusFile\\.LastWriteTimeUtc -lt \\$freshnessBoundaryUtc/);
  assert.match(source, /\\[DateTimeOffset\\]::TryParse\\(\\[string\\]\\$record\\.generatedAt, \\[ref\\]\\$generatedAtUtc\\)/);
  assert.match(source, /\\$generatedAtUtc\\.UtcDateTime -lt \\$freshnessBoundaryUtc/);
  assert.match(source, /battleBridgeSupervisorCurrentPath = \\$battleBridgeSupervisorCurrentPath/);
});
`;
writeFileSync(testPath, testSource);

const workflow = `name: Battle Bridge Resilience Proof

on:
  pull_request:
    paths:
      - 'scripts/battle-bridge-ignition-supervisor.mjs'
      - 'scripts/battle-bridge-ignition-supervisor.test.mjs'
      - 'scripts/windows-launcher-supervisor-freshness.test.mjs'
      - 'scripts/windows-launcher-defaults.test.mjs'
      - 'tests/windows-launcher-ignition.test.mjs'
      - 'windows/Launch-Stephanos-Local.ps1'
      - '.github/workflows/battle-bridge-resilience-proof.yml'

permissions:
  contents: read

jobs:
  proof:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Checkout exact pull request head
        uses: actions/checkout@v4
        with:
          ref: \${{ github.event.pull_request.head.sha }}
          fetch-depth: 0

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Served runtime and launcher freshness proof
        run: >-
          node --test
          scripts/battle-bridge-ignition-supervisor.test.mjs
          scripts/windows-launcher-supervisor-freshness.test.mjs
          scripts/windows-launcher-defaults.test.mjs
          tests/windows-launcher-ignition.test.mjs

      - name: Launcher script guard
        run: npm run stephanos:guard:scripts

      - name: Diff check
        run: git diff --check origin/main...HEAD
`;
mkdirSync(dirname(proofWorkflowPath), { recursive: true });
writeFileSync(proofWorkflowPath, workflow);

rmSync(bootstrapWorkflowPath, { force: true });
rmSync(selfPath, { force: true });