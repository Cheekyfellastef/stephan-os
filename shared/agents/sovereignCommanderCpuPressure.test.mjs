import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { safeCpuPressureSnapshotProjection, SOVEREIGN_COMMANDER_REMOTE_ACTIONS, executeSovereignCommanderRemoteOnBattleBridge } from './sovereignCommanderRemoteMailboxV1.mjs';
import { runVerifiedOrphanCpuRelief, CONTINUOUS_REPAIR_MAX_COMPOSED_TIMEOUT_MS } from '../../scripts/sovereign-commander-stephanos-repair.mjs';
import { buildSovereignCommanderRepairReport } from './sovereignCommanderRepairReportV1.mjs';
const cpuReliefSource = await readFile(new URL('../../scripts/windows/relieve-verified-orphan-cpu-pressure.ps1', import.meta.url), 'utf8');


const registry = await readFile(new URL('./sovereignCommanderV1.mjs', import.meta.url), 'utf8');
const mcp = await readFile(new URL('../../scripts/sovereign-commander-mcp.mjs', import.meta.url), 'utf8');
const script = await readFile(new URL('../../scripts/windows/read-battle-bridge-cpu-pressure.ps1', import.meta.url), 'utf8');

const sample = (patch = {}) => ({
  schemaVersion: 'stephanos.battle-bridge-cpu-pressure.v1',
  capturedAtUtc: '2026-10-12T00:00:00.000Z',
  sampleSeconds: 5,
  processorCount: 8,
  metadataAvailable: true,
  rows: [
    {
      pid: 5996,
      processName: 'powershell',
      parentPid: 7000,
      startedAtUtc: '2026-10-12T00:00:00.000Z',
      cpuPercent: 9.3,
      script: 'run-vr-resource-governor.ps1',
      sampleMatched: true,
    },
  ],
  readOnly: true,
  sourceMutationAllowed: false,
  processTerminationAllowed: false,
  arbitraryShellAllowed: false,
  arbitraryProcessInspectionAllowed: false,
  rawCommandLinesReturned: false,
  rawPathsReturned: false,
  secretMaterialIncluded: false,
  unknownMeansGreen: false,
  finalVerdict: 'BATTLE_BRIDGE_CPU_PRESSURE_SAMPLED',
  ...patch,
});
const envelope = (data) => ({ structuredContent: { stdout: JSON.stringify(data) } });

test('fixed registry, MCP, and GitHub mailbox expose only bounded CPU snapshot action', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('cpu-pressure-snapshot'));
  assert.match(registry, /'cpu-pressure-snapshot': frozen\(\{/);
  assert.match(registry, /read-battle-bridge-cpu-pressure\.ps1/);
  assert.match(registry, /timeoutMs: 25_000/);
  assert.match(mcp, /'cpu-pressure-snapshot'/);
  assert.match(script, /Start-Sleep -Seconds 5/);
  assert.match(script, /StartedTicks -eq \$startTime\.Ticks/);
  assert.doesNotMatch(script, /\$id\b/i, 'PowerShell $id aliases the reserved $PID variable');
  assert.match(script, /\$processId = \[int\]\$p\.Id/);
  assert.match(script, /TotalMilliseconds\) -gt 2/);
  assert.match(script, /rawCommandLinesReturned = \$false/);
  assert.match(script, /processTerminationAllowed = \$false/);
  assert.doesNotMatch(script, /\b(?:Stop-Process|taskkill|Invoke-Expression|Register-ScheduledTask)\b/i);
});

test('mailbox projects measured CPU and known script basename without raw command line or path', () => {
  const p = safeCpuPressureSnapshotProjection(envelope(sample()), 'cpu-pressure-snapshot');
  assert.equal(p.finalVerdict, 'BATTLE_BRIDGE_CPU_PRESSURE_SAMPLED');
  assert.equal(p.rows[0].pid, 5996);
  assert.equal(p.rows[0].cpuPercent, 9.3);
  assert.equal(p.rows[0].script, 'run-vr-resource-governor.ps1');
  assert.equal(Object.hasOwn(p.rows[0], 'commandLine'), false);
  assert.equal(Object.hasOwn(p.rows[0], 'path'), false);
  assert.equal(p.processTerminationAllowed, false);
  assert.equal(p.rawPathsReturned, false);
});

test('mailbox CPU projection fails closed on fake permission or unsanitized path/script', () => {
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample()), 'visibility-snapshot'), null);
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample({ rawCommandLinesReturned: true })), 'cpu-pressure-snapshot'), null);
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample({ processTerminationAllowed: true })), 'cpu-pressure-snapshot'), null);
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample({ rows: [{ ...sample().rows[0], script: 'secret.ps1' }] })), 'cpu-pressure-snapshot'), null);
  assert.equal(safeCpuPressureSnapshotProjection(envelope(sample({ rows: [{ ...sample().rows[0], cpuPercent: 999 }] })), 'cpu-pressure-snapshot'), null);
});

const CPU_HEAD = 'a'.repeat(40);
const CPU_COMMAND = Object.freeze({
  schemaVersion: 'stephanos.battle-bridge-github-command.v1',
  requestId: 'test-fixed-cpu-snapshot',
  operation: 'RUN_SOVEREIGN_COMMANDER_REMOTE_ACTION',
  repository: 'Cheekyfellastef/stephan-os',
  issueNumber: 3149,
  branch: 'main',
  operatorApproval: 'operator-approved',
  expectedHead: CPU_HEAD,
  expiresAt: '2026-10-12T03:00:00.000Z',
  remoteAction: 'cpu-pressure-snapshot',
});
const COMMITTED_CPU_SOURCE = '[CmdletBinding()]\nparam()\nStart-Sleep -Seconds 5\n';
function cpuRunner({ missingBlob = false, oversizedBlob = false, badPayload = false, sampleStatus = 0, observedHead = CPU_HEAD } = {}) {
  const calls = [];
  const spawnSyncFn = (executable, args) => {
    calls.push({ executable, args });
    if (args.includes('branch')) return { status: 0, stdout: 'main\n' };
    if (args.includes('rev-parse')) return { status: 0, stdout: observedHead + '\n' };
    if (args.includes('show')) return {
      status: missingBlob ? 1 : 0,
      stdout: oversizedBlob ? 'x'.repeat(14000) : COMMITTED_CPU_SOURCE,
    };
    if (executable === 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe') {
      return { status: sampleStatus, stdout: badPayload ? '{malformed' : JSON.stringify(sample()) };
    }
    throw new Error('unexpected process/executable: ' + executable);
  };
  return { calls, spawnSyncFn };
}
test('canonical mailbox executes only exact-head Git blob via fixed encoded PowerShell, without MCP or lifecycle effects', async () => {
  const runner = cpuRunner();
  const receipt = await executeSovereignCommanderRemoteOnBattleBridge(CPU_COMMAND, {
    env: { USERPROFILE: 'C:\\Users\\Operator' },
    spawnSyncFn: runner.spawnSyncFn,
    fetchFn: () => { throw new Error('MCP network request not permitted for fixed CPU snapshot'); },
    ensureRuntimeFn: () => { throw new Error('CPU snapshot must not recycle Commander'); },
  });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.result.finalVerdict, 'SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_COMPLETE');
  assert.equal(receipt.result.executionSurface, 'canonical-sovereign-mailbox-fixed-sampler');
  assert.equal(receipt.result.cpuPressure.rows[0].cpuPercent, 9.3);
  assert.equal(receipt.result.proofHash.length, 64);
  assert.equal(receipt.result.cpuPressure.rawCommandLinesReturned, false);
  assert.equal(runner.calls.length, 4, 'branch, head, immutable Git blob, fixed CPU sampler');
  const immutable = runner.calls[2];
  assert.equal(immutable.args.at(-1), CPU_HEAD + ':scripts/windows/read-battle-bridge-cpu-pressure.ps1');
  const powershell = runner.calls.at(-1);
  assert.equal(powershell.args.includes('-File'), false);
  assert.equal(powershell.args.includes('-EncodedCommand'), true);
  assert.equal(powershell.args.includes('-NoProfile'), true);
  assert.equal(powershell.args.includes('-NonInteractive'), true);
  assert.equal(Buffer.from(powershell.args.at(-1), 'base64').toString('utf16le'), COMMITTED_CPU_SOURCE);
  assert.equal(receipt.result.pcRestartAuthority, false);
});
test('immutable CPU route fails closed on missing/large commit blob, unexpected HEAD, bad JSON or failed process', async () => {
  for (const [params, blocker, callCount] of [
    [{ missingBlob: true }, 'SOVEREIGN_COMMANDER_REMOTE_CPU_COMMITTED_SCRIPT_UNAVAILABLE', 3],
    [{ oversizedBlob: true }, 'SOVEREIGN_COMMANDER_REMOTE_CPU_COMMITTED_SCRIPT_UNAVAILABLE', 3],
    [{ observedHead: 'b'.repeat(40) }, 'SOVEREIGN_COMMANDER_REMOTE_HEAD_MISMATCH', 2],
    [{ badPayload: true }, 'SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_RECEIPT_INVALID', 4],
    [{ sampleStatus: 124 }, 'SOVEREIGN_COMMANDER_REMOTE_CPU_SNAPSHOT_RECEIPT_INVALID', 4],
  ]) {
    const runner = cpuRunner(params);
    const receipt = await executeSovereignCommanderRemoteOnBattleBridge(CPU_COMMAND, {
      env: { USERPROFILE: 'C:\\Users\\Operator' },
      spawnSyncFn: runner.spawnSyncFn,
      fetchFn: () => { throw new Error('Unexpected network call'); },
      ensureRuntimeFn: () => { throw new Error('Unexpected runtime mutation'); },
    });
    assert.equal(receipt.ok, false);
    assert.equal(receipt.blocker, blocker);
    assert.equal(runner.calls.length, callCount);
    assert.equal(JSON.stringify(receipt).includes('malformed'), false);
  }
});

function verifiedCpuReply(patch = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-verified-cpu-relief.v1',
    ok: true, blocker: '',
    finalVerdict: 'CPU_RELIEF_NO_VERIFIED_ORPHAN',
    taskIdentity: 'Stephanos Battle Bridge Recovery Lifeboat',
    rootScopedToLifeboat: true,
    beforeSystemCpuPct: 95,
    afterSystemCpuPct: null,
    verifiedOrphanPid: 0,
    verifiedOrphanStartedAtUtc: '',
    fixedScriptBasename: '',
    oneProcessTerminated: false,
    cpuReductionVerified: false,
    arbitraryPidAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryShellAllowed: false,
    vrProcessTerminationAllowed: false,
    protectedServiceTerminationAllowed: false,
    sourceMutationAllowed: false,
    pcRestartAllowed: false,
    unknownMeansGreen: false,
    ...patch,
  };
}
function fixedCpuReliefResult(packet) {
  const calls = [];
  const report = runVerifiedOrphanCpuRelief({
    runStep: step => {
      calls.push(step);
      return { ok: true, status: 0, stdout: JSON.stringify(packet) };
    },
  });
  return { report, calls };
}
test('CPU orphan caretaker runs only the fixed named script from the existing bounded continuous guardian', () => {
  assert.match(cpuReliefSource, /Get-ScheduledTask -TaskName \$taskName/);
  assert.match(cpuReliefSource, /Get-TotalCpuLoad/);
  assert.match(cpuReliefSource, /\$minimumProcessAgeMinutes = 15/);
  assert.match(cpuReliefSource, /\$minimumWholeCpuPct = 80/);
  assert.match(cpuReliefSource, /GetOwnerSid/);
  assert.match(cpuReliefSource, /Test-MatchingCimProcess \$candidate \$followup/);
  assert.match(cpuReliefSource, /\$handleStartUtc/);
  assert.match(cpuReliefSource, /\$handle\.Kill\(\)/);
  assert.match(cpuReliefSource, /\$gamingNames/);
  assert.match(cpuReliefSource, /\$candidateCpuPct -lt \$minimumCandidateCpuPct/);
  assert.doesNotMatch(cpuReliefSource, /\b(?:Stop-Process|taskkill|Invoke-Expression|Register-ScheduledTask|Restart-Computer)\b/i);
  const {report,calls}=fixedCpuReliefResult(verifiedCpuReply());
  assert.equal(calls.length, 1);
  assert.equal(calls[0].id,'verified-orphan-cpu-relief');
  assert.equal(calls[0].timeoutMs,25000);
  assert.deepEqual(calls[0].args.slice(-2),['-File',calls[0].args.at(-1)]);
  assert.match(calls[0].args.at(-1),/relieve-verified-orphan-cpu-pressure\.ps1$/);
  assert.equal(report.unresolvedCpuPressure,true);
  assert.equal(report.terminated,false);
  const cleared=fixedCpuReliefResult(verifiedCpuReply({
    finalVerdict:'CPU_RELIEF_PRESSURE_CLEARED',
    sampledSystemCpuPct:45,
  })).report;
  assert.equal(cleared.unresolvedCpuPressure,false);
  assert.equal(cleared.ok,true);
  assert.equal(buildSovereignCommanderRepairReport({
    repair:{ok:true,sourceHead:'a'.repeat(40),steps:[],cpuRelief:cleared},
  }).outcome,'HEALTHY');
  const forgedCleared=fixedCpuReliefResult(verifiedCpuReply({
    finalVerdict:'CPU_RELIEF_PRESSURE_CLEARED',
    sampledSystemCpuPct:91,
  })).report;
  assert.equal(forgedCleared.ok,false);
  assert.equal(report.terminated,false);
  assert.equal(CONTINUOUS_REPAIR_MAX_COMPOSED_TIMEOUT_MS<=240000,true);
});
test('CPU relief fails closed on forged authority and never grants arbitrary Windows termination',()=>{
  for(const unsafe of [
    verifiedCpuReply({ arbitraryPidAllowed:true }),
    verifiedCpuReply({ vrProcessTerminationAllowed:true }),
    verifiedCpuReply({ protectedServiceTerminationAllowed:true }),
    verifiedCpuReply({ sourceMutationAllowed:true }),
    verifiedCpuReply({ unknownMeansGreen:true }),
    verifiedCpuReply({ oneProcessTerminated:true, finalVerdict:'CPU_RELIEF_NO_VERIFIED_ORPHAN' }),
  ]) {
    const {report}=fixedCpuReliefResult(unsafe);
    assert.equal(report.ok,false);
    assert.equal(report.finalVerdict,'CPU_RELIEF_EVIDENCE_INVALID');
    assert.equal(report.terminated,false);
  }
});
test('verified one-process cleanup becomes repaired only after independent CPU reduction proof',()=>{
  const good=fixedCpuReliefResult(verifiedCpuReply({
    oneProcessTerminated:true, verifiedOrphanPid:23440,
    verifiedOrphanStartedAtUtc:'2026-10-12T01:02:03.000Z',
    fixedScriptBasename:'run-battle-bridge-recovery-lifeboat-bank-v1.ps1',
    finalVerdict:'CPU_RELIEF_ORPHAN_TERMINATED_CPU_IMPROVED',
    cpuReductionVerified:true, afterSystemCpuPct:47,
  })).report;
  assert.equal(good.terminated,true);
  assert.equal(good.cpuReductionVerified,true);
  const report=buildSovereignCommanderRepairReport({
    repair:{ok:true,sourceHead:'a'.repeat(40),steps:[],cpuRelief:good},
    cycleId:'cpu-cycle-one',
    completedAtUtc:'2026-10-20T13:35:00.000Z',
  });
  assert.equal(report.outcome,'REPAIRED');
  assert.equal(report.status.cpuRelief.oneProcessTerminated,true);
  assert.equal(report.status.cpuRelief.cpuReductionVerified,true);
  assert.equal(report.status.cpuRelief.arbitraryProcessTerminationAllowed,false);
  const unresolved=fixedCpuReliefResult(verifiedCpuReply({
    oneProcessTerminated:true, verifiedOrphanPid:37608,
    verifiedOrphanStartedAtUtc:'2026-10-12T01:02:03.000Z',
    fixedScriptBasename:'run-battle-bridge-recovery-lifeboat-active-v1.ps1',
    finalVerdict:'CPU_RELIEF_ORPHAN_TERMINATED_CPU_RECHECK_REQUIRED',
    cpuReductionVerified:false, afterSystemCpuPct:96,
  })).report;
  assert.equal(buildSovereignCommanderRepairReport({
    repair:{ok:true,sourceHead:'a'.repeat(40),steps:[],cpuRelief:unresolved},
  }).outcome,'NEEDS_REPAIR');
});
