import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_CAPABILITIES,
  buildStephanosCapabilityRegistryProjection,
  buildStephanosCapabilityRegistrySummary,
  findStephanosCapability,
  validateStephanosCapabilityRegistry,
} from './stephanosCapabilityRegistry.mjs';

const head = '704f64a1662de33bfd3ac2ff6531ad296bf5e846';
const MACHINE_PATH_PATTERN = /(?:^|["'\s])(?:[A-Za-z]:[\\/]|\\\\|\/(?:users|home|workspace|tmp)\/)/i;

test('registry is deterministic, unique and fail-closed', () => {
  const validation = validateStephanosCapabilityRegistry();
  assert.equal(validation.valid, true);
  assert.equal(validation.capabilityCount, STEPHANOS_CAPABILITIES.length);
  assert.equal(new Set(STEPHANOS_CAPABILITIES.map((item) => item.capabilityId)).size, STEPHANOS_CAPABILITIES.length);
});

test('projection exposes the universal bootstrap and core routes without machine paths', () => {
  const projection = buildStephanosCapabilityRegistryProjection({ sourceHead: head, generatedAtUtc: '2026-07-17T12:00:00.000Z' });
  assert.equal(projection.sourceHead, head);
  assert.equal(projection.bootstrap.requiredBeforeCapabilityDenial, true);
  assert.equal(projection.bootstrap.duplicateActiveExecutionAllowed, false);
  assert.equal(projection.bootstrap.missingGhIsGlobalBlocker, false);
  assert.equal(projection.bootstrap.rebuildVerifiedWorkAfterRouteFailure, false);
  assert.ok(projection.bootstrap.sequence.includes('DISCOVER_NESTED_CHECKOUTS'));
  assert.ok(projection.bootstrap.sequence.includes('PROBE_CONNECTED_GITHUB_APP_PUBLISHER'));
  assert.equal(projection.safety.arbitraryShellAllowed, false);
  assert.equal(projection.safety.destructiveGitAllowed, false);
  assert.doesNotMatch(JSON.stringify(projection), MACHINE_PATH_PATTERN);
});

test('source publication failover and receipt-proven Forge construction are discoverable', () => {
  const router = findStephanosCapability('source-publication-continuity-router');
  const git = findStephanosCapability('authenticated-git-source-publisher');
  const app = findStephanosCapability('connected-github-app-source-publisher');
  const forge = findStephanosCapability('foundry-forge-construction-sidecar');
  assert.ok(router.operations.includes('DISCOVER_NESTED_CHECKOUTS'));
  assert.ok(router.operations.includes('FAIL_OVER_PRESERVING_ARTIFACT'));
  assert.equal(git.requiresOperatorApproval, true);
  assert.ok(app.operations.includes('CREATE_BRANCH_REF'));
  assert.equal(app.requiresOperatorApproval, true);
  assert.equal(forge.ownerIssue, 1671);
  assert.ok(forge.operations.includes('CONSTRUCT_NONCONFLICTING_SLICE'));
});

test('summary remains machine-readable and bounded for GitHub receipts', () => {
  const summary = buildStephanosCapabilityRegistrySummary({ sourceHead: head, generatedAtUtc: '2026-07-17T12:00:00.000Z' });
  const json = JSON.stringify(summary);
  assert.equal(summary.finalVerdict, 'STEPHANOS_CAPABILITY_REGISTRY_PASS');
  assert.equal(summary.capabilityCount, STEPHANOS_CAPABILITIES.length);
  assert.ok(Buffer.byteLength(json, 'utf8') < 8 * 1024);
  assert.doesNotMatch(json, MACHINE_PATH_PATTERN);
});

test('mailbox receipt reads, watchdog acceptance, diagnostic link, shared workspace and post-sync refresh are discoverable capabilities', () => {
  const mailbox = findStephanosCapability('battle-bridge-github-command-mailbox');
  const workspace = findStephanosCapability('shared-agent-workspace');
  const refresh = findStephanosCapability('post-sync-runtime-refresh-coordinator');
  assert.ok(mailbox.operations.includes('READ_CAPABILITY_REGISTRY'));
  assert.ok(mailbox.operations.includes('READ_SHARED_WORKSPACE_STATUS'));
  assert.ok(mailbox.operations.includes('READ_MAILBOX_RECEIPT'));
  assert.ok(mailbox.operations.includes('RUN_WORKER_WATCHDOG_ACCEPTANCE'));
  assert.ok(mailbox.operations.includes('RUN_MISSION_WORKER_DIAGNOSTIC_LINK'));
  assert.ok(mailbox.operations.includes('INSTALL_BATTLE_BRIDGE_RECOVERY_MESH'));
  assert.ok(mailbox.operations.includes('WAKE_BATTLE_BRIDGE_RECOVERY_MESH'));
  assert.equal(mailbox.runtimeMutationAllowed, true);
  assert.equal(workspace.discoveryRoute, 'mailbox:READ_SHARED_WORKSPACE_STATUS');
  assert.ok(refresh.operations.includes('RESTART_BACKEND_8787'));
  assert.ok(refresh.operations.includes('RESTART_MISSION_WORKER'));
  assert.equal(refresh.liveOpenClawUpdateAllowed, false);
});

test('five-door recovery mesh is discoverable without becoming a second execution authority', () => {
  const mesh = findStephanosCapability('battle-bridge-recovery-mesh');
  assert.equal(mesh.ownerIssue, 1291);
  assert.equal(mesh.category, 'runtime-supervision');
  assert.equal(mesh.discoveryRoute, 'shared-workspace:battle-bridge-recovery-mesh-current');
  assert.ok(mesh.operations.includes('COALESCE_RECOVERY_WAKE'));
  assert.equal(mesh.runtimeMutationAllowed, true);
  assert.equal(mesh.arbitraryShellAllowed, false);
});

test('programme stall monitoring is registered as diagnosis on the existing monitor runtime', () => {
  const monitor = findStephanosCapability('programme-stall-monitor');
  assert.equal(monitor.category, 'programme-monitoring');
  assert.equal(monitor.statusSource, 'monitor-multiplexer');
  assert.equal(monitor.discoveryRoute, 'shared-workspace:monitor-programme-stall-monitor');
  assert.ok(monitor.operations.includes('DIAGNOSE_PROGRAMME_STALL'));
  assert.ok(monitor.operations.includes('PUBLISH_MONITOR_RESULT'));
  assert.equal(monitor.runtimeMutationAllowed, false);
});

test('nested Windows, UNC and local absolute paths fail closed', () => {
  for (const discoveryRoute of [
    'C:\\Users\\Stephan\\secret',
    '\\\\battle-bridge\\private-share',
    '/home/stephan/private',
  ]) {
    const capabilities = STEPHANOS_CAPABILITIES.map((capability) => (
      capability.capabilityId === 'shared-agent-workspace'
        ? { ...capability, discoveryRoute }
        : capability
    ));
    const validation = validateStephanosCapabilityRegistry(capabilities);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(','), /absolute-path-forbidden:shared-agent-workspace/);
  }
});
