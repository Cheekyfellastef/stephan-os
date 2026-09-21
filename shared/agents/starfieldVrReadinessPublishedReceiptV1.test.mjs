import assert from 'node:assert/strict';
import test from 'node:test';

import { STARFIELD_VR_READINESS_OPERATION } from './starfieldVrBattleBridgeMailboxV1.mjs';
import {
  createSanitizedMailboxReceiptProjection,
  serializeBoundedReceiptJson,
} from '../../scripts/battle-bridge-github-command-mailbox.mjs';

const HEAD = 'a7c77126d301c955e349817a7937ce83eb19764c';

test('published Starfield readiness receipt preserves bounded blocker truth without local paths', () => {
  const requestId = 'starfield-vr-readiness-published-receipt-0001';
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId,
    operation: STARFIELD_VR_READINESS_OPERATION,
    state: 'DONE',
    expectedHead: HEAD,
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: STARFIELD_VR_READINESS_OPERATION,
      requestId,
      result: {
        ok: true,
        finalVerdict: 'STARFIELD_VR_LAUNCH_BLOCKED',
        expectedHead: HEAD,
        sourceHead: HEAD,
        launchReady: false,
        selectedProvider: 'STEAMVR_OPENXR',
        blockers: ['STARFIELD_VR_PROFILE_MISSING'],
        warnings: ['META_LINK_NOT_OBSERVED'],
        receiptWritten: true,
        receiptPath: 'C:\\Users\\Stephan\\private\\starfield-readiness.json',
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  const serialized = serializeBoundedReceiptJson(receipt);

  assert.equal(projected.operationResult.finalVerdict, 'STARFIELD_VR_LAUNCH_BLOCKED');
  assert.equal(projected.operationResult.launchReady, false);
  assert.equal(projected.operationResult.selectedProvider, 'STEAMVR_OPENXR');
  assert.deepEqual(projected.operationResult.blockers, ['STARFIELD_VR_PROFILE_MISSING']);
  assert.deepEqual(projected.operationResult.warnings, ['META_LINK_NOT_OBSERVED']);
  assert.equal(projected.operationResult.receiptWritten, true);
  assert.match(serialized, /STARFIELD_VR_PROFILE_MISSING/);
  assert.match(serialized, /META_LINK_NOT_OBSERVED/);
  assert.doesNotMatch(`${JSON.stringify(projected)}${serialized}`, /C:\\Users\\Stephan/i);
});
