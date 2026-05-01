import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpenClawAuditPreviewEvent } from './openClawAuditLedger.mjs';

test('audit ledger preview event is deterministic with injected timestamp', () => {
  const event = createOpenClawAuditPreviewEvent({ eventType: 'permission_diff_previewed', timestamp: '2026-05-01T00:00:00.000Z' });
  assert.equal(event.auditEventId, 'openclaw-audit-permission_diff_previewed-2026-05-01T00:00:00.000Z');
  assert.equal(event.eventStatus, 'preview');
  assert.equal(event.actionAllowed, false);
  assert.equal(event.actionExecuted, false);
  assert.equal(event.operatorApprovalRequired, true);
});
