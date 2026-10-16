import test from 'node:test';
import assert from 'node:assert/strict';
import {
  projectRescueIslandBoundaryResultV1, parseRescueIslandBoundaryStdoutV1,
  RESCUE_ISLAND_BOUNDARY_MARKER, parseRescueIslandBoundaryHeldStdoutV1,
} from './rescueIslandBoundaryReceiptV1.mjs';

const raw = () => ({
  schemaVersion: 'stephanos.rescue-island-boundary-probe.v1',
  ok: true, blocker: '', observedPathCount: 3,
  physicalScopeReadback: 'LOCAL_OS_SCOPE_OBSERVED',
  finalVerdict: 'RESCUE_ISLAND_OS_SCOPE_READONLY_OBSERVED',
  sourceMutationAllowed: false, workerStartAllowed: false,
  independentOwnershipAuthenticated: false, gamingBudgetAuthenticated: false,
  originalSourceLeaseReleaseAllowed: false, seedForgeQueueAccessAllowed: false,
  mergeAllowed: false, publicReceiptSafe: true,
});
const line = value => RESCUE_ISLAND_BOUNDARY_MARKER + JSON.stringify(value) + '\n';

test('exact marker produces only a redacted, read-only physical observation', () => {
  const projected = parseRescueIslandBoundaryStdoutV1(line(raw()), 'rescue-island-readonly-boundary');
  assert.equal(projected?.ok, true);
  assert.equal(projected?.observedPathCount, 3);
  assert.equal(projected?.readOnly, true);
  assert.equal(projected?.sourceMutationAllowed, false);
  assert.equal(projected?.originalSourceLeaseReleaseAllowed, false);
  assert.equal(projected?.gamingBudgetAuthenticated, false);
  assert.equal(projected?.secretMaterialReturned, false);
});
test('forged grants, unexpected fields, incomplete scope and wrong action all fail closed', () => {
  for (const key of ['sourceMutationAllowed', 'workerStartAllowed',
    'independentOwnershipAuthenticated', 'gamingBudgetAuthenticated',
    'originalSourceLeaseReleaseAllowed', 'seedForgeQueueAccessAllowed', 'mergeAllowed']) {
    const value = { ...raw(), [key]: true };
    assert.equal(projectRescueIslandBoundaryResultV1(value), null, key);
  }
  for (const value of [
    { ...raw(), leakedPrivatePath: 'C:/SECRET/host' },
    { ...raw(), observedPathCount: 2 },
    { ...raw(), physicalScopeReadback: 'SYNTHETIC' },
    { ...raw(), publicReceiptSafe: false },
    { ...raw(), ok: false },
    { ...raw(), finalVerdict: 'SOURCE_MUTATION_ALLOWED' },
  ]) assert.equal(projectRescueIslandBoundaryResultV1(value), null);
  assert.equal(parseRescueIslandBoundaryStdoutV1(line(raw()), 'repair-control-plane'), null);
  assert.equal(parseRescueIslandBoundaryStdoutV1(line(raw()) + 'PRIVATE_PATH\n', 'rescue-island-readonly-boundary'), null);
  assert.equal(parseRescueIslandBoundaryStdoutV1(line(raw()).repeat(70), 'rescue-island-readonly-boundary'), null);
  assert.equal(parseRescueIslandBoundaryStdoutV1(RESCUE_ISLAND_BOUNDARY_MARKER + '{', 'rescue-island-readonly-boundary'), null);
});


test('typed OS denial is bounded and never interpretable as completed physical pickup', () => {
  const held = {
    ...raw(), ok: false, blocker: 'RESCUE_ISLAND_CANONICAL_GIT_ROOT_UNTRUSTED',
    observedPathCount: 0, physicalScopeReadback: 'HELD',
    finalVerdict: 'RESCUE_ISLAND_OS_SCOPE_READONLY_BLOCKED',
  };
  const parse = value => parseRescueIslandBoundaryHeldStdoutV1(
    line(value), 'rescue-island-readonly-boundary');
  assert.equal(projectRescueIslandBoundaryResultV1(held), null);
  const readback = parse(held);
  assert.equal(readback?.ok, false);
  assert.equal(readback?.blocker, 'RESCUE_ISLAND_CANONICAL_GIT_ROOT_UNTRUSTED');
  assert.equal(readback?.workerStartAllowed, false);
  assert.equal(readback?.originalSourceLeaseReleaseAllowed, false);
  for (const spoof of [
    { ...held, blocker: 'HOST_PRIVATE_PATH' },
    { ...held, sourceMutationAllowed: true },
    { ...held, ok: true },
    { ...held, observedPathCount: 3 },
    { ...held, unexpectedField: 'LEAK' },
  ]) assert.equal(parse(spoof), null);
  assert.equal(parseRescueIslandBoundaryHeldStdoutV1(line(held), 'unrelated-action'), null);
  assert.equal(parseRescueIslandBoundaryHeldStdoutV1(line(held) + 'second line\n', 'rescue-island-readonly-boundary'), null);
});
