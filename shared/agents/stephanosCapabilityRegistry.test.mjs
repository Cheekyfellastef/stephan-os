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
  assert.equal(projection.safety.arbitraryShellAllowed, false);
  assert.equal(projection.safety.destructiveGitAllowed, false);
  assert.doesNotMatch(JSON.stringify(projection), MACHINE_PATH_PATTERN);
});

test('summary remains machine-readable and bounded for GitHub receipts', () => {
  const summary = buildStephanosCapabilityRegistrySummary({ sourceHead: head, generatedAtUtc: '2026-07-17T12:00:00.000Z' });
  const json = JSON.stringify(summary);
  assert.equal(summary.finalVerdict, 'STEPHANOS_CAPABILITY_REGISTRY_PASS');
  assert.equal(summary.capabilityCount, STEPHANOS_CAPABILITIES.length);
  assert.ok(Buffer.byteLength(json, 'utf8') < 8 * 1024);
  assert.doesNotMatch(json, MACHINE_PATH_PATTERN);
});

test('mailbox and shared workspace are first-class discoverable capabilities', () => {
  const mailbox = findStephanosCapability('battle-bridge-github-command-mailbox');
  const workspace = findStephanosCapability('shared-agent-workspace');
  assert.ok(mailbox.operations.includes('READ_CAPABILITY_REGISTRY'));
  assert.ok(mailbox.operations.includes('READ_SHARED_WORKSPACE_STATUS'));
  assert.equal(workspace.discoveryRoute, 'mailbox:READ_SHARED_WORKSPACE_STATUS');
});

test('nested Windows, UNC and local absolute paths fail closed', () => {
  for (const discoveryRoute of [
    'C:\\Users\\Stephan\\secret',
    '\\\\battle-bridge\\private-share',
    '/home/stephan/private',
  ]) {
    const capabilities = STEPHANOS_CAPABILITIES.map((capability, index) => index === 0
      ? { ...capability, discoveryRoute }
      : capability);
    const validation = validateStephanosCapabilityRegistry(capabilities);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join(','), /absolute-path-forbidden:shared-agent-workspace/);
  }
});
