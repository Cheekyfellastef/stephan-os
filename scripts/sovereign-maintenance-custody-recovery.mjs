#!/usr/bin/env node
// Fixed local adapter for the existing guardian's recovery transition. There
// is deliberately no process/service/PC restart, lease release or clear flag.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGoalDiscoveryWorkspaceV1 } from '../shared/agents/goalDiscoveryWorkspaceV1.mjs';
import { createMaintenanceCustodyStoreV1, readMaintenanceBootWitnessV1, readMaintenanceRecoverySourceV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { loadSovereignCommanderToken } from './sovereign-commander-http.mjs';

export async function runMaintenanceCustodyRecoveryV1({ mode, expectedCycle, expectedReportSha256,
  expectedDigest, expectedMain, operatorApproval, workspaceRoot = resolveGoalDiscoveryWorkspaceV1(),
  bootReader = readMaintenanceBootWitnessV1, fetchFn = fetch,
  tokenReader = loadSovereignCommanderToken, sourceReader = readMaintenanceRecoverySourceV1, anchor } = {}) {
  if (!['status', 'prepare', 'recover'].includes(mode)) return { ok: false, blocker: 'CUSTODY_RECOVERY_MODE_INVALID' };
  if (mode === 'recover') {
    if (operatorApproval !== 'operator-approved' || !/^[a-f0-9]{64}$/.test(expectedDigest ?? '')
        || !/^[a-f0-9]{40}$/.test(expectedMain ?? ''))
      return { ok: false, blocker: 'MAINTENANCE_CUSTODY_EXACT_APPROVAL_REQUIRED' };
    const token = await tokenReader();
    const response = await fetchFn('http://127.0.0.1:18791/maintenance-custody/recover-after-boot', {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedDigest, expectedMain, operatorApproval }),
    });
    return response.json();
  }
  const healthResponse = await fetchFn('http://127.0.0.1:18791/health', { signal: AbortSignal.timeout(5000) });
  const health = await healthResponse.json();
  const bytes = readFileSync(resolve(workspaceRoot, 'status', 'sovereign-commander-repair-current.json'));
  if (bytes.length > 64 * 1024) return { ok: false, blocker: 'LEGACY_MAINTENANCE_REPORT_UNBOUNDED' };
  const report = JSON.parse(bytes);
  const reportSha256 = createHash('sha256').update(bytes).digest('hex');
  const witness = await bootReader();
  const store = createMaintenanceCustodyStoreV1({ workspaceRoot, signingKey: await tokenReader(),
    bootWitness: witness, readBootWitness: bootReader, anchor });
  const guardian = health.continuousRepairGuardian;
  const held = healthResponse.ok && health.service === 'stephanos-sovereign-commander'
    && guardian?.timeoutCustodyHeld === true && guardian.running === false
    && guardian.maintenanceInFlight === false && guardian.lastCycleId === report.cycleId
    && guardian.lastStartedAtUtc === report.cycleStartedAtUtc
    && guardian.lastBlocker === 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN'
    && report.reportSchema === 'stephanos.sovereign-commander-repair-report.v1'
    && report.source === 'continuous-repair-guardian' && report.detectedFaults?.includes('ETIMEDOUT');
  if (mode === 'status') return { ok: true, originalHoldMatched: held, cycleId: report.cycleId,
    reportSha256, bootWitness: witness, persistentCustody: store.status() };
  if (!held || operatorApproval !== 'operator-approved' || expectedCycle !== report.cycleId
      || expectedReportSha256 !== reportSha256)
    return { ok: false, blocker: 'LEGACY_MAINTENANCE_EXACT_LIVE_HOLD_REQUIRED' };
  if (!/^[a-f0-9]{40}$/.test(expectedMain ?? '') || sourceReader() !== expectedMain)
    return { ok: false, blocker: 'MAINTENANCE_RECOVERY_CANONICAL_SOURCE_UNPROVEN' };
  const result = store.prepareIncident({ reservationId: expectedCycle, operation: 'repair-stephanos',
    incident: { reportSha256, sourceHead: report.sourceHead, cycleStartedAtUtc: report.cycleStartedAtUtc,
      originalExecutionOutcome: 'UNKNOWN', report } });
  const status = store.status(); store.close();
  return { ...result, prepared: result.ok, persistentCustody: status,
    custodyReleased: false, pcRestartAllowed: false, originalR7Authority: false };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = { mode: args.shift() };
  const keys = { '--expected-cycle': 'expectedCycle', '--expected-report-sha256': 'expectedReportSha256',
    '--expected-digest': 'expectedDigest', '--expected-main': 'expectedMain' };
  while (args.length) {
    const key = args.shift();
    if (key === '--operator-approved' && !options.operatorApproval) options.operatorApproval = 'operator-approved';
    else if (keys[key] && !options[keys[key]] && args.length) options[keys[key]] = args.shift();
    else throw new Error('CUSTODY_RECOVERY_ARGUMENT_INVALID');
  }
  try {
    const result = await runMaintenanceCustodyRecoveryV1(options);
    console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 2;
  } catch { console.log(JSON.stringify({ ok: false, blocker: 'MAINTENANCE_CUSTODY_RECOVERY_UNPROVEN' })); process.exitCode = 2; }
}
