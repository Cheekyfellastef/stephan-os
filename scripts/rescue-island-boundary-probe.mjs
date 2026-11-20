#!/usr/bin/env node
// #3109: fixed read-only Battle Bridge Island physical source-boundary probe.
// Never executes the isolated builder or consumes a task/approval/lease.
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import {
  observeRescueIslandPhysicalScopesV1,
} from '../shared/agents/rescueIslandPhysicalScopeObservationV1.mjs';

export const RESCUE_ISLAND_BOUNDARY_PROBE_SCHEMA = 'stephanos.rescue-island-boundary-probe.v1';
export const RESCUE_ISLAND_BOUNDARY_PROBE_MARKER = 'RESCUE_ISLAND_BOUNDARY_PROBE_RESULT=';
// Only typed, source-controlled denial codes may leave the host.
const SAFE_SCOPE_DENIAL_CODES = new Set([
  'RESCUE_ISLAND_SCOPE_INPUT_INVALID',
  'RESCUE_ISLAND_REPOSITORY_ROOT_UNTRUSTED',
  'RESCUE_ISLAND_REPOSITORY_ROOT_REDIRECTED',
  'RESCUE_ISLAND_CANONICAL_GIT_ROOT_UNTRUSTED',
  'RESCUE_ISLAND_SCOPE_ESCAPE',
  'RESCUE_ISLAND_SCOPE_STAT_UNAVAILABLE',
  'RESCUE_ISLAND_SCOPE_REDIRECTED',
  'RESCUE_ISLAND_SCOPE_PARENT_NOT_DIRECTORY',
  'RESCUE_ISLAND_SCOPE_LEAF_UNTRUSTED',
  'RESCUE_ISLAND_SCOPE_OS_OBSERVATION_FAILED',
]);

const CANONICAL_PROBE_SCOPES = Object.freeze([
  'docs/architecture/rescue-island-pilot-pilot-3109-01.md',
  'shared/agents/rescueIslandFirstCommitV1.mjs',
  'shared/agents/rescueIslandPreflightV1.test.mjs',
]);

function result(ok, blocker, observedPathCount = 0) {
  return Object.freeze({
    schemaVersion: RESCUE_ISLAND_BOUNDARY_PROBE_SCHEMA,
    ok, blocker,
    observedPathCount,
    physicalScopeReadback: ok ? 'LOCAL_OS_SCOPE_OBSERVED' : 'HELD',
    finalVerdict: ok
      ? 'RESCUE_ISLAND_OS_SCOPE_READONLY_OBSERVED'
      : 'RESCUE_ISLAND_OS_SCOPE_READONLY_BLOCKED',
    // This host neither authenticates the owner's external instruction nor
    // inventories all other source writers or gaming. No authority is implied.
    sourceMutationAllowed: false,
    workerStartAllowed: false,
    independentOwnershipAuthenticated: false,
    gamingBudgetAuthenticated: false,
    originalSourceLeaseReleaseAllowed: false,
    seedForgeQueueAccessAllowed: false,
    mergeAllowed: false,
    publicReceiptSafe: true,
  });
}

export async function inspectRescueIslandLocalBoundaryV1(repositoryRoot, {
  scan = observeRescueIslandPhysicalScopesV1,
} = {}) {
  if (typeof repositoryRoot !== 'string') return result(false, 'REPOSITORY_ROOT_REQUIRED');
  // No caller-provided paths enter the scanned set.
  let observation;
  try {
    observation = await scan({
      repositoryRoot,
      paths: [...CANONICAL_PROBE_SCOPES],
    });
  } catch {
    return result(false, 'OS_SCOPE_SCAN_FAILED');
  }
  if (observation?.schemaVersion !== 'stephanos.rescue-island-physical-scope-observation.v1'
      || observation.ok !== true
      || observation.observationIsAuthoritative !== false
      || observation.sourceMutationAllowed !== false
      || observation.workerStartAllowed !== false
      || observation.leaseReleaseAllowed !== false
      || observation.observedPathCount !== CANONICAL_PROBE_SCOPES.length)
    return result(false, SAFE_SCOPE_DENIAL_CODES.has(observation?.blocker)
      ? observation.blocker : 'OS_SCOPE_OBSERVATION_HELD');
  return result(true, '', CANONICAL_PROBE_SCOPES.length);
}

const sourcePath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(sourcePath)) {
  const cli = async () => {
    if (process.argv.length !== 2)
      return result(false, 'RESCUE_ISLAND_PROBE_ARGUMENTS_FORBIDDEN');
    const repositoryRoot = resolve(dirname(sourcePath), '..');
    return inspectRescueIslandLocalBoundaryV1(repositoryRoot);
  };
  cli().then((value) => {
    process.stdout.write(RESCUE_ISLAND_BOUNDARY_PROBE_MARKER + JSON.stringify(value) + '\n');
    process.exitCode = value.ok ? 0 : 1;
  }).catch(() => {
    const denied = result(false, 'RESCUE_ISLAND_PROBE_INTERNAL_ERROR');
    process.stdout.write(RESCUE_ISLAND_BOUNDARY_PROBE_MARKER + JSON.stringify(denied) + '\n');
    process.exitCode = 1;
  });
}
