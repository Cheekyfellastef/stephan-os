import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STEPHANOS_CAPABILITIES,
  buildStephanosCapabilityRegistryProjection,
  findStephanosCapability,
  validateStephanosCapabilityRegistry,
} from './stephanosCapabilityRegistry.mjs';

const head = '704f64a1662de33bfd3ac2ff6531ad296bf5e846';

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
  assert.equal(projection.safety.arbitraryShellAllowed, false);
  assert.equal(projection.safety.destructiveGitAllowed, false);
  assert.doesNotMatch(JSON.stringify(projection), /[A-Za-z]:\\|\\\\|\/(?:users|home|workspace|tmp)\//i);
});

test('mailbox and shared workspace are first-class discoverable capabilities', () => {
  const mailbox = findStephanosCapability('battle-bridge-github-command-mailbox');
  const workspace = findStephanosCapability('shared-agent-workspace');
  assert.ok(mailbox.operations.includes('READ_CAPABILITY_REGISTRY'));
  assert.ok(mailbox.operations.includes('READ_SHARED_WORKSPACE_STATUS'));
  assert.equal(workspace.discoveryRoute, 'mailbox:READ_SHARED_WORKSPACE_STATUS');
});
