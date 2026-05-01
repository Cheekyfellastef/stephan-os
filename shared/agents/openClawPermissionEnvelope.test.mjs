import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpenClawPermissionEnvelope, BLOCKED_CAPABILITIES } from './openClawPermissionEnvelope.mjs';

test('permission envelope remains execution disabled and self-modification disabled', () => {
  const envelope = buildOpenClawPermissionEnvelope();
  assert.equal(envelope.executionAllowed, false);
  assert.equal(envelope.selfModificationAllowed, false);
  assert.equal(envelope.operatorApprovalRequired, true);
});

test('permission envelope always includes blocked capabilities', () => {
  const envelope = buildOpenClawPermissionEnvelope({ readonlyValidated: true });
  BLOCKED_CAPABILITIES.forEach((cap) => assert.equal(envelope.blockedCapabilities.includes(cap), true));
});
