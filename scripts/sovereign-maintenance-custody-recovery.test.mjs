import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSovereignCommanderHttpServer } from './sovereign-commander-http.mjs';
import { runMaintenanceCustodyRecoveryV1 } from './sovereign-maintenance-custody-recovery.mjs';
import { createMaintenanceCustodyStoreV1, readMaintenanceBootWitnessV1, validMaintenanceBootWitnessV1 } from './sovereign-maintenance-custody-store-v1.mjs';

const key = 'private-fixture-token-'.repeat(3), head = 'c'.repeat(40);
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'custody-recovery-'));
  mkdirSync(join(root, 'status')); mkdirSync(join(root, 'events'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const now = Date.now();
  const boot = { schemaVersion: 'stephanos.windows-boot-witness.v1', machineHash: 'a'.repeat(64),
    bootStartedAtUtc: new Date(now - 86400_000).toISOString(), observedAtUtc: new Date(now).toISOString() };
  let latest = null, id = 0;
  const anchor = { readLatest: () => latest && { ...latest, bytes: Buffer.from(latest.bytes) },
    append: bytes => { latest = { bytes: Buffer.from(bytes), eventRecordId: ++id }; return latest; } };
  return { root, boot, anchor };
}

test('migration binds actual held owner, report bytes and exact approved source; status never writes', async t => {
  const { root, boot, anchor } = fixture(t);
  const report = { reportSchema: 'stephanos.sovereign-commander-repair-report.v1',
    source: 'continuous-repair-guardian', cycleId: 'original-timeout-cycle',
    cycleStartedAtUtc: new Date(Date.now() - 60_000).toISOString(), sourceHead: head, detectedFaults: ['ETIMEDOUT'] };
  const bytes = JSON.stringify(report);
  writeFileSync(join(root, 'status', 'sovereign-commander-repair-current.json'), bytes);
  const reportHash = createHash('sha256').update(bytes).digest('hex');
  const health = { service: 'stephanos-sovereign-commander', continuousRepairGuardian: {
    timeoutCustodyHeld: true, running: false, maintenanceInFlight: false,
    lastCycleId: report.cycleId, lastStartedAtUtc: report.cycleStartedAtUtc,
    lastBlocker: 'SOVEREIGN_COMMANDER_CONTINUOUS_REPAIR_TIMEOUT_CUSTODY_UNPROVEN' } };
  const deps = { workspaceRoot: root, bootReader: () => boot, tokenReader: () => key, anchor,
    sourceReader: () => head, fetchFn: async () => ({ ok: true, json: async () => health }) };
  assert.equal((await runMaintenanceCustodyRecoveryV1({ ...deps, mode: 'status' })).originalHoldMatched, true);
  const journal = join(root, 'status', 'sovereign-commander-maintenance-custody.json');
  assert.equal(existsSync(journal), false);
  for (const change of [{ operatorApproval: undefined }, { expectedReportSha256: 'f'.repeat(64) },
    { expectedCycle: 'different-cycle' }, { expectedMain: 'b'.repeat(40) }]) {
    const result = await runMaintenanceCustodyRecoveryV1({ ...deps, mode: 'prepare',
      expectedCycle: report.cycleId, expectedReportSha256: reportHash, expectedMain: head,
      operatorApproval: 'operator-approved', ...change });
    assert.equal(result.ok, false); assert.equal(existsSync(journal), false);
  }
  const result = await runMaintenanceCustodyRecoveryV1({ ...deps, mode: 'prepare',
    expectedCycle: report.cycleId, expectedReportSha256: reportHash, expectedMain: head, operatorApproval: 'operator-approved' });
  assert.equal(result.prepared, true); assert.equal(result.custodyReleased, false);
  assert.equal(result.persistentCustody.held, true); assert.equal(result.pcRestartAllowed, false);
});

test('actual authenticated HTTP owner rejects forged boot fields and wrong source before recovery', async t => {
  const { root, boot, anchor } = fixture(t);
  const old = { ...boot, observedAtUtc: new Date(Date.now() - 120_000).toISOString() };
  const original = createMaintenanceCustodyStoreV1({ workspaceRoot: root, signingKey: key,
    bootWitness: old, now: () => old.observedAtUtc, anchor });
  original.prepareIncident({ reservationId: 'held-http-cycle', operation: 'repair-stephanos' });
  const digest = original.status().digest; original.close();
  const successorBoot = { ...boot, bootStartedAtUtc: new Date(Date.now() - 60_000).toISOString() };
  let bootReads = 0;
  const successor = createMaintenanceCustodyStoreV1({ workspaceRoot: root, signingKey: key,
    bootWitness: successorBoot, readBootWitness: () => { bootReads++; return successorBoot; }, anchor });
  const app = await createSovereignCommanderHttpServer({ port: 0, token: key, custodyStore: successor,
    continuousRepairEnabled: false, recoverySourceAdmission: expected => expected === head });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const url = 'http://127.0.0.1:' + app.server.address().port + '/maintenance-custody/recover-after-boot';
  const request = { expectedDigest: digest, expectedMain: head, operatorApproval: 'operator-approved' };
  const post = (body, token = key) => fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  assert.equal((await post(request, 'wrong')).status, 401);
  assert.equal((await post({ ...request, bootWitness: successorBoot })).status, 400);
  assert.equal((await post({ ...request, expectedMain: 'b'.repeat(40) })).status, 409);
  assert.equal(bootReads, 0);
  const response = await post(request);
  assert.equal(response.status, 200); assert.equal((await response.json()).historicalOutcome, 'UNKNOWN');
  assert.equal(bootReads, 1); assert.equal(app.continuousRepairStatus().lastOk, false);
});

test('the real fixed Windows boot observer produces a fresh local witness', { skip: process.platform !== 'win32' }, () => {
  assert.equal(validMaintenanceBootWitnessV1(readMaintenanceBootWitnessV1()), true);
});
