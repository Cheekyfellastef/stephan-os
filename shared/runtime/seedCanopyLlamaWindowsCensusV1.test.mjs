import test from 'node:test';
import assert from 'node:assert/strict';
import { LLAMA_WINDOWS_CENSUS_SCHEMA, assessLlamaWindowsProcessCensusV1 } from './seedCanopyLlamaWindowsCensusV1.mjs';

const NOW = Date.parse('2026-10-16T18:00:00.000Z');
const registration = Object.freeze({
  routerPid: 4100, routerStartedAtUtc: '2026-10-16T17:40:00.000Z',
  routerExecutableSha256: 'a'.repeat(64),
  registeredDescendants: [{ pid: 4101, startedAtUtc: '2026-10-16T17:41:00.000Z' }],
});
const snapshot = {
  schemaVersion: LLAMA_WINDOWS_CENSUS_SCHEMA,
  observedAtUtc: '2026-10-16T17:59:59.000Z',
  enumerationComplete: true,
  processes: [{ pid: 120, parentPid: 4, startedAtUtc: '2026-10-16T17:00:00.000Z' }],
};
const check = (s = snapshot, r = registration) => assessLlamaWindowsProcessCensusV1(s, r, NOW);
const one = (pid, parentPid, startedAtUtc = '2026-10-16T17:45:00.000Z') =>
  ({ pid, parentPid, startedAtUtc });

test('complete read-only census is only a candidate, never zero residency or inference authority', () => {
  const result = check();
  assert.equal(result.processTreeAbsentCandidate, true);
  assert.equal(result.independentlyQualified, false);
  assert.equal(result.zeroResidencyProven, false);
  assert.equal(result.mayLiftInferenceHold, false);
});
test('registered root still alive or recycled blocks', () => {
  for (const startedAtUtc of [registration.routerStartedAtUtc, '2026-10-16T17:50:00.000Z']) {
    const result = check({ ...snapshot, routerExecutableSha256: registration.routerExecutableSha256,
      processes: [one(registration.routerPid, 12, startedAtUtc)] });
    assert.equal(result.processTreeAbsentCandidate, false);
  }
});
test('root executable substitution or missing observation never certifies custody', () => {
  for (const value of [undefined, 'b'.repeat(64)]) {
    const result = check({ ...snapshot, routerExecutableSha256: value,
      processes: [one(registration.routerPid, 12, registration.routerStartedAtUtc)] });
    assert.ok(result.reasonCodes.includes('ROUTER_EXECUTABLE_MISMATCH_OR_UNOBSERVED'));
    assert.equal(result.mayLiftInferenceHold, false);
  }
});
test('registered orphan descendant survives even without its parent', () => {
  const result = check({ ...snapshot, processes: [one(4101, 99, registration.registeredDescendants[0].startedAtUtc)] });
  assert.ok(result.reasonCodes.includes('REGISTERED_DESCENDANT_STILL_RUNNING'));
  assert.equal(result.processTreeAbsentCandidate, false);
});
test('parent lineage catches unregistered children and grandchildren', () => {
  for (const processes of [
    [one(5500, 4100)],
    [one(5500, 4100), one(5501, 5500)],
    [one(5501, 5500), one(5500, 4100)],
  ]) {
    const result = check({ ...snapshot, processes });
    assert.ok(result.reasonCodes.includes('ROUTER_DESCENDANT_STILL_RUNNING'));
    assert.equal(result.processTreeAbsentCandidate, false);
  }
});
test('untrustworthy census freshness, completeness and schema fail closed', () => {
  for (const s of [
    { ...snapshot, observedAtUtc: '2026-10-16T17:59:54.000Z' },
    { ...snapshot, observedAtUtc: '2026-10-16T18:00:01.000Z' },
    { ...snapshot, observedAtUtc: '2026-10-16' },
    { ...snapshot, enumerationComplete: 'true' },
    { ...snapshot, schemaVersion: 'forged' },
    { ...snapshot, processes: [one(500, 0), one(500, 0)] },
    { ...snapshot, processes: [one(600, 0, 'invalid')] },
    { ...snapshot, processes: null },
  ]) {
    assert.equal(check(s).processTreeAbsentCandidate, false, JSON.stringify(s));
  }
});
test('registration missing exact descendant list or immutable launch identity fails closed', () => {
  for (const r of [
    { ...registration, registeredDescendants: null },
    { ...registration, routerStartedAtUtc: '2026-10-16' },
    { ...registration, routerExecutableSha256: 'A'.repeat(64) },
    { ...registration, routerPid: '4100' },
    { ...registration, registeredDescendants: [{ pid: 4101, startedAtUtc: 'invalid' }] },
  ]) {
    const result = check(snapshot, r);
    assert.equal(result.processTreeAbsentCandidate, false);
    assert.ok(result.reasonCodes.includes('LAUNCH_REGISTRATION_INCOMPLETE'));
  }
});
test('caller supplied qualified, custody and model claims cannot bypass the HOLD', () => {
  const result = check({ ...snapshot, qualified: true, zeroResidencyProven: true,
    mayLiftInferenceHold: true, gamingActive: false, gpuResidencyReleased: true });
  assert.equal(result.mayLiftInferenceHold, false);
  assert.equal(result.zeroResidencyProven, false);
});
