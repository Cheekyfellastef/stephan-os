import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLocalResultBridgeContract } from './localResultBridgeV1.mjs';

test('contract is ready', () => {
  const contract = buildLocalResultBridgeContract();
  assert.equal(contract.schemaVersion, 'local-result-bridge.v1');
  assert.equal(contract.finalVerdict, 'LOCAL_RESULT_BRIDGE_CONTRACT_READY');
  assert.equal(contract.states.length > 0, true);
});
