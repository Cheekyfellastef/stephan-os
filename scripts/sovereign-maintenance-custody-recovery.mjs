#!/usr/bin/env node
// Fixed local adapter for the existing guardian's recovery transition. There
// is deliberately no process/service/PC restart, lease release or clear flag.
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGoalDiscoveryWorkspaceV1 } from '../shared/agents/goalDiscoveryWorkspaceV1.mjs';
import { MAINTENANCE_CUSTODY_SCHEMA, createMaintenanceCustodyStoreV1, readMaintenanceBootWitnessV1, readMaintenanceRecoverySourceV1 } from './sovereign-maintenance-custody-store-v1.mjs';
import { loadSovereignCommanderToken } from './sovereign-commander-http.mjs';
import { readMaintenanceOwnerObservationV2 } from './sovereign-maintenance-owner-observation-v2.mjs';

function readMaintenanceProjectionV2(workspaceRoot) {
  const path = resolve(workspaceRoot, 'status', 'sovereign-commander-maintenance-custody.json');
  const before = lstatSync(path, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 15000n)
    throw new Error('MAINTENANCE_MIGRATION_PROJECTION_UNPROVEN');
  const bytes = readFileSync(path), after = lstatSync(path, { bigint: true });
  if (bytes.length > 15000 || before.ino !== after.ino || before.dev !== after.dev
      || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.size !== after.size)
    throw new Error('MAINTENANCE_MIGRATION_PROJECTION_CHANGED');
  return bytes;
}
function authenticateMaintenanceProjectionV2(bytes, key) {
  const x = JSON.parse(bytes);
  if (Object.keys(x).sort().join(',') !== 'mac,record' || !/^[a-f0-9]{64}$/.test(x.mac ?? ''))
    throw new Error('MAINTENANCE_MIGRATION_PROJECTION_UNAUTHENTICATED');
  const mac = createHmac('sha256', key).update('stephanos-maintenance-custody-v1\0record\0'
    + JSON.stringify(x.record)).digest();
  if (!timingSafeEqual(mac, Buffer.from(x.mac, 'hex')) || x.record.schemaVersion !== MAINTENANCE_CUSTODY_SCHEMA
      || !['ACTIVE', 'IDLE'].includes(x.record.phase)
      || typeof x.record.reservationId !== 'string' || !x.record.reservationId
      || x.record.reservationId.length > 300)
    throw new Error('MAINTENANCE_MIGRATION_PROJECTION_UNAUTHENTICATED');
  return x.record;
}


export async function runMaintenanceCustodyRecoveryV1({ mode, expectedCycle, expectedReportSha256,
  expectedDigest, expectedMain, expectedOwnerDigest, operatorApproval, workspaceRoot = resolveGoalDiscoveryWorkspaceV1(),
  bootReader = readMaintenanceBootWitnessV1, fetchFn = fetch,
  tokenReader = loadSovereignCommanderToken, sourceReader = readMaintenanceRecoverySourceV1, anchor,
  ownerObserver = readMaintenanceOwnerObservationV2, observeLegacyAudit } = {}) {
  if (!['status', 'prepare', 'recover', 'prepare-after-audit-loss', 'inspect-retained-migration', 'prepare-retained-migration'].includes(mode)) return { ok: false, blocker: 'CUSTODY_RECOVERY_MODE_INVALID' };

  if (mode === 'inspect-retained-migration' || mode === 'prepare-retained-migration') {
    // Direct local ACTIVE-only preparation. Never call the old startup-pinned
    // owner's preparation endpoint or load new code into that held process.
    const bytes = readMaintenanceProjectionV2(workspaceRoot);
    const token = await tokenReader();
    const projection = authenticateMaintenanceProjectionV2(bytes, token);
    const projectionDigest = createHash('sha256').update(bytes).digest('hex');
    const owner = await ownerObserver();
    if (mode === 'inspect-retained-migration') return { ok: true,
      projectionDigest, projectionReservationId: projection.reservationId,
      projectionPhase: projection.phase, projectionFreshness: 'UNPROVEN',
      heldOwner: owner, custodyReleased: false };
    if (operatorApproval !== 'operator-approved' || expectedDigest !== projectionDigest
        || expectedCycle !== projection.reservationId || expectedOwnerDigest !== owner.digest
        || !/^[a-f0-9]{40}$/.test(expectedMain ?? '') || sourceReader() !== expectedMain)
      return { ok: false, blocker: 'MAINTENANCE_RETAINED_MIGRATION_EXACT_APPROVAL_REQUIRED', custodyReleased: false };
    const witness = await bootReader();
    const store = createMaintenanceCustodyStoreV1({ workspaceRoot, signingKey: token,
      bootWitness: witness, readBootWitness: bootReader, anchor,
      observeMigrationOwner: ownerObserver,
      ...(observeLegacyAudit ? { observeLegacyAudit } : {}) });
    try {
      const result = await store.prepareRetainedMigration({ expectedDigest,
        expectedReservationId: expectedCycle, expectedOwnerDigest, expectedMain, operatorApproval });
      let sourceStillExact = false;
      try { sourceStillExact = sourceReader() === expectedMain; } catch { /* Retain prepared fence. */ }
      return { ...result, ok: result.ok && sourceStillExact,
        ...(sourceStillExact ? {} : { blocker: 'MAINTENANCE_MIGRATION_SOURCE_CHANGED_RETAIN_HOLD' }),
        prepared: result.prepared === true || result.ok, persistentCustody: store.status(), custodyReleased: false,
        requiresLaterFullBoot: true, pcRestartAllowed: false, sourceLeaseReleased: false };
    } finally { store.close(); }
  }

  if (mode === 'recover' || mode === 'prepare-after-audit-loss') {
    if (operatorApproval !== 'operator-approved' || !/^[a-f0-9]{64}$/.test(expectedDigest ?? '')
        || !/^[a-f0-9]{40}$/.test(expectedMain ?? ''))
      return { ok: false, blocker: 'MAINTENANCE_CUSTODY_EXACT_APPROVAL_REQUIRED' };
    if (mode === 'prepare-after-audit-loss' && (typeof expectedCycle !== 'string' || !expectedCycle))
      return { ok: false, blocker: 'MAINTENANCE_AUDIT_LOSS_EXACT_APPROVAL_REQUIRED' };
    const token = await tokenReader();
    const endpoint = mode === 'recover' ? 'recover-after-boot' : 'prepare-after-audit-loss';
    const response = await fetchFn('http://127.0.0.1:18791/maintenance-custody/' + endpoint, {
      method: 'POST', signal: AbortSignal.timeout(15_000),
      headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
      body: JSON.stringify({ expectedDigest, expectedMain, operatorApproval,
        ...(mode === 'prepare-after-audit-loss' ? { expectedReservationId: expectedCycle } : {}) }),
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
    '--expected-digest': 'expectedDigest', '--expected-main': 'expectedMain', '--expected-owner-digest': 'expectedOwnerDigest' };
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
