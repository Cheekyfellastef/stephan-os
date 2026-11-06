import test from 'node:test';
import { readFileSync } from 'node:fs';
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
  enumerationStartedAtUtc: '2026-10-16T17:59:58.000Z',
  enumerationFinishedAtUtc: '2026-10-16T17:59:59.000Z',
  enumerationComplete: true,
  processes: [
    { pid: 4, parentPid: 0, startedAtUtc: '2026-10-16T16:00:00.000Z' },
    { pid: 120, parentPid: 4, startedAtUtc: '2026-10-16T17:00:00.000Z' },
  ],
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
test('orphan grandchildren of exited registered descendants cannot appear absent', () => {
  // The registered parent PID 4101 has exited; its surviving children still
  // belong to the registered launch lineage, even if router 4100 is also gone.
  for (const processes of [
    [one(5500, 4101)],
    [one(5500, 4101), one(5501, 5500)],
    [one(5501, 5500), one(5500, 4101)],
  ]) {
    const result = check({ ...snapshot, processes });
    assert.ok(result.reasonCodes.includes('REGISTERED_DESCENDANT_LINEAGE_STILL_RUNNING'));
    assert.equal(result.processTreeAbsentCandidate, false);
    assert.equal(result.independentlyQualified, false);
    assert.equal(result.mayLiftInferenceHold, false);
  }
});

test('missing intermediate parent cannot conceal a surviving unregistered grandchild', () => {
  // The registered router and its immediate child exited. The unregistered
  // intermediate child also exited, leaving only a grandchild whose parent PID
  // is absent from the process-wide snapshot. A negative tree cannot be proven.
  const result = check({ ...snapshot, processes: [
    one(4, 0, '2026-10-16T16:00:00.000Z'),
    one(5501, 5500),
  ] });
  assert.ok(result.reasonCodes.includes('PROCESS_PARENT_NOT_ENUMERATED'));
  assert.equal(result.processTreeAbsentCandidate, false);
  assert.equal(result.independentlyQualified, false);
  assert.equal(result.zeroResidencyProven, false);
  assert.equal(result.mayLiftInferenceHold, false);
});

test('untrustworthy census freshness, completeness and schema fail closed', () => {
  for (const s of [
    { ...snapshot, observedAtUtc: '2026-10-16T17:59:54.000Z' },
    { ...snapshot, enumerationStartedAtUtc: undefined },
    { ...snapshot, enumerationFinishedAtUtc: undefined },
    { ...snapshot, enumerationStartedAtUtc: '2026-10-16T17:59:50.000Z' },
    { ...snapshot, enumerationStartedAtUtc: '2026-10-16T18:00:00.000Z' },
    { ...snapshot, enumerationFinishedAtUtc: '2026-10-16T17:59:57.000Z' },
    { ...snapshot, enumerationFinishedAtUtc: '2026-10-16T18:00:00.000Z' },
    { ...snapshot, enumerationStartedAtUtc: '2026-10-16' },
    { ...snapshot, observedAtUtc: '2026-10-16T18:00:01.000Z' },
    { ...snapshot, observedAtUtc: '2026-10-16' },
    { ...snapshot, enumerationComplete: 'true' },
    { ...snapshot, schemaVersion: 'forged' },
    { ...snapshot, processes: [one(500, 0), one(500, 0)] },
    { ...snapshot, processes: [one(600, 0, 'invalid')] },
    { ...snapshot, processes: null },
    { ...snapshot, processes: [] },
  ]) {
    assert.equal(check(s).processTreeAbsentCandidate, false, JSON.stringify(s));
  }
});
test('impossible future process creation never certifies an absent router tree', () => {
  // The unrelated PID cannot exist in a snapshot observed before its launch.
  const impossible = check({ ...snapshot, processes: [
    one(120, 4, '2026-10-16T18:00:00.000Z'),
  ] });
  assert.ok(impossible.reasonCodes.includes('PROCESS_CREATION_AFTER_OBSERVATION'));
  assert.equal(impossible.processTreeAbsentCandidate, false);
  assert.equal(impossible.mayLiftInferenceHold, false);
});

test('processes launched during enumeration invalidate a negative census', () => {
  // Even an unrelated process appearing during the scan shows a racing
  // process table. A negative router-tree result cannot be trusted.
  for (const launchedAt of [
    snapshot.enumerationStartedAtUtc,
    '2026-10-16T17:59:58.500Z',
    snapshot.enumerationFinishedAtUtc,
  ]) {
    const result = check({ ...snapshot, processes: [one(120, 4, launchedAt)] });
    assert.ok(result.reasonCodes.includes('PROCESS_LAUNCHED_DURING_ENUMERATION'));
    assert.equal(result.processTreeAbsentCandidate, false);
    assert.equal(result.zeroResidencyProven, false);
    assert.equal(result.mayLiftInferenceHold, false);
  }
});

test('recycled parent PID or inverted process chronology cannot certify absence', () => {
  // The current PID 120 process started after its purported child PID 121.
  // This may be PID reuse, not a trustworthy negative process-tree witness.
  const result = check({ ...snapshot, processes: [
    one(120, 4, '2026-10-16T17:00:00.000Z'),
    one(121, 120, '2026-10-16T16:59:59.000Z'),
  ] });
  assert.ok(result.reasonCodes.includes('PROCESS_PARENT_CHRONOLOGY_AMBIGUOUS'));
  assert.equal(result.processTreeAbsentCandidate, false);
  assert.equal(result.independentlyQualified, false);
  assert.equal(result.mayLiftInferenceHold, false);
});

test('parent-child timestamp collisions fail closed regardless of census row order', () => {
  // Millisecond timestamps cannot establish which PID was born first.
  // A recycled parent PID can otherwise look like a valid lineage.
  const parent = one(120, 4, '2026-10-16T17:00:00.000Z');
  const child = one(121, 120, '2026-10-16T17:00:00.000Z');
  for (const processes of [[parent, child], [child, parent]]) {
    const result = check({ ...snapshot, processes });
    assert.ok(result.reasonCodes.includes('PROCESS_PARENT_CHRONOLOGY_AMBIGUOUS'));
    assert.equal(result.processTreeAbsentCandidate, false);
    assert.equal(result.zeroResidencyProven, false);
    assert.equal(result.mayLiftInferenceHold, false);
  }
});

test('parent lineage remains fail-closed under reordered and cyclic census graphs', () => {
  const root = one(120, 121, '2026-10-16T17:00:00.000Z');
  const child = one(121, 120, '2026-10-16T17:00:01.000Z');
  for (const processes of [[root, child], [child, root]]) {
    const result = check({ ...snapshot, processes });
    assert.ok(result.reasonCodes.includes('PROCESS_PARENT_CYCLE'));
    assert.ok(result.reasonCodes.includes('PROCESS_PARENT_CHRONOLOGY_AMBIGUOUS'));
    assert.equal(result.processTreeAbsentCandidate, false);
    assert.equal(result.mayLiftInferenceHold, false);
  }
});

test('registration missing exact descendant list or immutable launch identity fails closed', () => {
  for (const r of [
    { ...registration, registeredDescendants: null },
    { ...registration, routerStartedAtUtc: '2026-10-16' },
    { ...registration, routerExecutableSha256: 'A'.repeat(64) },
    { ...registration, routerPid: '4100' },
    { ...registration, registeredDescendants: [{ pid: 4101, startedAtUtc: 'invalid' }] },
    { ...registration, registeredDescendants: [{ pid: 4101, startedAtUtc: '2026-10-16T17:39:59.000Z' }] },
    { ...registration, registeredDescendants: [{ pid: registration.routerPid, startedAtUtc: registration.routerStartedAtUtc }] },
    { ...registration, registeredDescendants: [
      registration.registeredDescendants[0],
      { ...registration.registeredDescendants[0], startedAtUtc: '2026-10-16T17:42:00.000Z' },
    ] },
  ]) {
    const result = check(snapshot, r);
    assert.equal(result.processTreeAbsentCandidate, false);
    assert.ok(result.reasonCodes.includes('LAUNCH_REGISTRATION_INCOMPLETE'));
  }
});
test('registered descendant with timestamp-identical router launch fails closed', () => {
  // A millisecond-resolution collision cannot establish that the registered
  // child was launched after the router rather than under a recycled PID.
  const ambiguous = { ...registration, registeredDescendants: [
    { pid: 4101, startedAtUtc: registration.routerStartedAtUtc },
  ] };
  const result = check(snapshot, ambiguous);
  assert.ok(result.reasonCodes.includes('LAUNCH_REGISTRATION_INCOMPLETE'));
  assert.equal(result.processTreeAbsentCandidate, false);
  assert.equal(result.zeroResidencyProven, false);
  assert.equal(result.mayLiftInferenceHold, false);
});

test('caller supplied qualified, custody and model claims cannot bypass the HOLD', () => {
  const result = check({ ...snapshot, qualified: true, zeroResidencyProven: true,
    mayLiftInferenceHold: true, gamingActive: false, gpuResidencyReleased: true });
  assert.equal(result.mayLiftInferenceHold, false);
  assert.equal(result.zeroResidencyProven, false);
});

test('registration launched after census begins cannot look absent', () => {
  // Preserve parent-before-child chronology while placing the launch tree
  // inside the census window. Otherwise registration validation masks the race.
  const lateRouter = check(snapshot, { ...registration,
    routerStartedAtUtc: '2026-10-16T17:59:58.500Z',
    registeredDescendants: [{ pid: 4101, startedAtUtc: '2026-10-16T17:59:58.700Z' }],
  });
  assert.ok(lateRouter.reasonCodes.includes('LAUNCH_OVERLAPS_CENSUS'));
  assert.equal(lateRouter.processTreeAbsentCandidate, false);
  const lateChild = check(snapshot, { ...registration,
    registeredDescendants: [{ pid: 4101, startedAtUtc: '2026-10-16T17:59:58.500Z' }] });
  assert.ok(lateChild.reasonCodes.includes('LAUNCH_OVERLAPS_CENSUS'));
  assert.equal(lateChild.mayLiftInferenceHold, false);
  assert.equal(lateChild.processTreeAbsentCandidate, false);
});

test('router or descendant launch at the exact scan-start timestamp fails closed', () => {
  const atStart = snapshot.enumerationStartedAtUtc;
  const rootAtStart = check(snapshot, { ...registration,
    routerStartedAtUtc: atStart,
    // A valid descendant launch must be strictly later than its router.
    registeredDescendants: [{ pid: 4101, startedAtUtc: '2026-10-16T17:59:58.001Z' }],
  });
  assert.ok(rootAtStart.reasonCodes.includes('LAUNCH_OVERLAPS_CENSUS'));
  assert.equal(rootAtStart.processTreeAbsentCandidate, false);
  const childAtStart = check(snapshot, { ...registration,
    registeredDescendants: [{ pid: 4101, startedAtUtc: atStart }],
  });
  assert.ok(childAtStart.reasonCodes.includes('LAUNCH_OVERLAPS_CENSUS'));
  assert.equal(childAtStart.processTreeAbsentCandidate, false);
  assert.equal(childAtStart.mayLiftInferenceHold, false);
});

test('Windows collector captures bounded observation window around process enumeration', () => {
  // Static source contract only: CI cannot establish a live Windows/VRAM witness.
  const script = readFileSync(new URL('../../scripts/windows/get-seed-canopy-llama-process-census-v1.ps1', import.meta.url), 'utf8');
  const started = script.indexOf('$enumerationStarted = Format-Utc');
  const scan = script.indexOf('Get-CimInstance -ClassName Win32_Process');
  const finished = script.indexOf('$enumerationFinished = Format-Utc');
  assert.ok(started >= 0 && started < scan && scan < finished);
  assert.match(script, /enumerationStartedAtUtc = \$enumerationStarted/);
  assert.match(script, /enumerationFinishedAtUtc = \$enumerationFinished/);
});
