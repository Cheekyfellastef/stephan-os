import assert from 'node:assert/strict';
import test from 'node:test';

import { createSanitizedMailboxReceiptProjection } from './battle-bridge-github-command-mailbox.mjs';

const HEAD = 'a7c77126d301c955e349817a7937ce83eb19764c';

test('Starfield VR readiness sanitizer preserves explicit fail-closed launch authority', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'starfield-vr-readiness-sanitizer-contract-0001',
    operation: 'READ_STARFIELD_VR_LAUNCH_READINESS',
    state: 'DONE',
    expectedHead: HEAD,
    result: {
      ok: true,
      verdict: 'COMMAND_EXECUTION_COMPLETE',
      operation: 'READ_STARFIELD_VR_LAUNCH_READINESS',
      requestId: 'starfield-vr-readiness-sanitizer-contract-0001',
      result: {
        ok: true,
        finalVerdict: 'STARFIELD_VR_LAUNCH_BLOCKED',
        expectedHead: HEAD,
        sourceHead: HEAD,
        launchReady: false,
        launchAllowed: false,
        providerMutationAllowed: false,
        blockers: ['STARFIELD_VR_PROFILE_MISSING'],
      },
    },
  };

  const projected = createSanitizedMailboxReceiptProjection(receipt);
  assert.equal(projected.operationResult.launchReady, false);
  assert.equal(projected.operationResult.launchAllowed, false);
  assert.equal(projected.operationResult.providerMutationAllowed, false);
  assert.equal(projected.operationResult.finalVerdict, 'STARFIELD_VR_LAUNCH_BLOCKED');
});
