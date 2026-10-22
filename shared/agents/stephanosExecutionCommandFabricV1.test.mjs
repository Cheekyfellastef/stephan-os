import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_EXECUTION_ADAPTER,
  STEPHANOS_EXECUTION_SCOPE,
  STEPHANOS_EXECUTION_SURFACE,
  buildStephanosExecutionCommandEnvelopeV1,
  buildStephanosExecutionSurfaceCatalogV1,
  evaluateStephanosExecutionScopeV1,
  selectStephanosExecutionSurfaceV1,
} from './stephanosExecutionCommandFabricV1.mjs';

const ROOT = 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os';
const SHARED = 'C:\\Users\\Stephan Callear\\Documents\\Stephanos-Shared-Workspace';
const DOWNLOAD = 'C:\\Users\\Stephan Callear\\Downloads\\outside-stephanos.txt';

function catalog() {
  return buildStephanosExecutionSurfaceCatalogV1({
    repositoryRoot: ROOT,
    sharedWorkspaceRoot: SHARED,
    runtimeRoots: ['C:\\Users\\Stephan Callear\\Stephanos'],
  });
}

test('OpenClaw Standalone and OpenClaw Local are distinct execution surfaces', () => {
  const value = catalog();
  const standalone = value.surfaces[STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE];
  const local = value.surfaces[STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL];
  assert.equal(standalone.agentId, 'openclaw-standalone');
  assert.equal(standalone.adapter, 'openclaw-standalone');
  assert.equal(standalone.scope, STEPHANOS_EXECUTION_SCOPE.WHOLE_PC);
  assert.equal(local.agentId, 'stephanos-scout-coder');
  assert.equal(local.adapter, 'openclaw-local');
  assert.equal(local.scope, STEPHANOS_EXECUTION_SCOPE.STEPHANOS_ONLY);
});
test('Standalone can accept a target anywhere on the PC while Local rejects the same target', () => {
  const value = catalog();
  const standalone = evaluateStephanosExecutionScopeV1({
    catalog: value,
    surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE,
    targetPaths: [DOWNLOAD],
  });
  const local = evaluateStephanosExecutionScopeV1({
    catalog: value,
    surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL,
    targetPaths: [DOWNLOAD],
  });
  assert.equal(standalone.ok, true);
  assert.equal(local.ok, false);
  assert.deepEqual(local.outsideScopePaths, [DOWNLOAD]);
  assert.deepEqual(local.blockers, ['execution-target-outside-surface-scope']);
});

test('Local accepts the Stephanos repository, runtime and Shared Workspace roots', () => {
  const result = evaluateStephanosExecutionScopeV1({
    catalog: catalog(),
    surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL,
    targetPaths: [
      ROOT + '\\shared\\agents\\example.mjs',
      SHARED + '\\status\\current.json',
      'C:\\Users\\Stephan Callear\\Stephanos\\runtime\\health.json',
    ],
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.blockers, []);
});

test('Sovereign Commander is a distinct unmetered whole-PC execution surface', () => {
  const commander = catalog().surfaces[STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER];
  assert.equal(commander.adapter, STEPHANOS_EXECUTION_ADAPTER.SOVEREIGN_COMMANDER);
  assert.equal(commander.scope, STEPHANOS_EXECUTION_SCOPE.WHOLE_PC);
  assert.equal(commander.canManageProcesses, true);
  assert.equal(commander.vendorMeterRequired, false);
  assert.equal(commander.externalSaasRelayRequired, false);
  assert.equal(commander.canEditFiles, true);
  assert.equal(commander.canUseGit, false);
});

test('Desktop Commander remains a distinct whole-PC execution surface', () => {
  const commander = catalog().surfaces[STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER];
  assert.equal(commander.adapter, STEPHANOS_EXECUTION_ADAPTER.DESKTOP_COMMANDER);
  assert.equal(commander.scope, STEPHANOS_EXECUTION_SCOPE.WHOLE_PC);
  assert.equal(commander.canManageProcesses, true);
});
test('command envelopes preserve scope and never grant merge or unbounded-command authority', () => {
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    catalog: catalog(),
    surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE,
    actionId: 'fabric-test-action',
    missionId: 'fabric-test-mission',
    relatedPr: '#2461',
    operation: 'inspect-file',
    targetPaths: [DOWNLOAD],
    payload: { path: DOWNLOAD },
  });
  assert.equal(envelope.dispatchAllowed, true);
  assert.equal(envelope.agentId, 'openclaw-standalone');
  assert.equal(envelope.relatedPr, '#2461');
  assert.equal(envelope.mergeAuthority, false);
  assert.equal(envelope.leaseSeizureAllowed, false);
  assert.equal(envelope.duplicateDispatchAllowed, false);
  assert.equal(envelope.pcRestartAuthority, false);
  assert.equal(envelope.arbitraryUnboundedCommandAllowed, false);
  assert.equal(envelope.receiptRequired, true);
});

test('a Local command envelope fails closed when a target escapes Stephanos', () => {
  const envelope = buildStephanosExecutionCommandEnvelopeV1({
    catalog: catalog(),
    surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL,
    actionId: 'fabric-local-escape',
    missionId: 'fabric-test-mission',
    operation: 'edit-file',
    targetPaths: [DOWNLOAD],
  });
  assert.equal(envelope.dispatchAllowed, false);
  assert.ok(envelope.blockers.includes('execution-target-outside-surface-scope'));
});
test('automatic host control prefers Sovereign Commander while Desktop Commander remains compatibility fallback', () => {
  const sovereign = selectStephanosExecutionSurfaceV1({
    catalog: catalog(),
    requiresHostControl: true,
    targetPaths: [DOWNLOAD],
  });
  const legacy = selectStephanosExecutionSurfaceV1({
    catalog: catalog(),
    requiresHostControl: true,
    sovereignCommanderAvailable: false,
    targetPaths: [DOWNLOAD],
  });
  const standalone = selectStephanosExecutionSurfaceV1({
    catalog: catalog(),
    requiresWholePc: true,
    targetPaths: [DOWNLOAD],
  });
  assert.equal(sovereign.surface, STEPHANOS_EXECUTION_SURFACE.SOVEREIGN_COMMANDER);
  assert.equal(legacy.surface, STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER);
  assert.equal(standalone.surface, STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE);
});

test('automatic Stephanos work stays Local when all paths are inside Stephanos', () => {
  const selected = selectStephanosExecutionSurfaceV1({
    catalog: catalog(),
    targetPaths: [ROOT + '\\shared\\agents\\example.mjs'],
  });
  assert.equal(selected.surface, STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL);
  assert.equal(selected.selected, true);
});


test('Local POSIX scope checks preserve case-sensitive path identity', () => {
  const value = buildStephanosExecutionSurfaceCatalogV1({
    repositoryRoot: '/srv/Stephanos',
    sharedWorkspaceRoot: '/srv/Stephanos-Shared-Workspace',
  });
  const inside = evaluateStephanosExecutionScopeV1({
    catalog: value,
    surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL,
    targetPaths: ['/srv/Stephanos/shared/agents/example.mjs'],
  });
  const caseVariant = evaluateStephanosExecutionScopeV1({
    catalog: value,
    surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL,
    targetPaths: ['/srv/stephanos/secret'],
  });
  assert.equal(inside.ok, true);
  assert.equal(caseVariant.ok, false);
  assert.deepEqual(caseVariant.blockers, ['execution-target-outside-surface-scope']);
});
