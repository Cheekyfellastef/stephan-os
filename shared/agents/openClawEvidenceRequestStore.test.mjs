import test from 'node:test';
import assert from 'node:assert/strict';
import { clearOpenClawEvidenceRequests, loadOpenClawEvidenceRequests, saveOpenClawEvidenceRequest, listOpenClawEvidenceRequestsByPacketId } from './openClawEvidenceRequestStore.mjs';

test('store save/load/list/clear', () => {
  globalThis.localStorage = (() => { const m=new Map(); return { getItem:(k)=>m.get(k)||null, setItem:(k,v)=>m.set(k,v), removeItem:(k)=>m.delete(k) }; })();
  clearOpenClawEvidenceRequests();
  saveOpenClawEvidenceRequest({ request: { requestId: 'r1', packetId: 'p1', requestedEvidenceType: 'operator_note' } });
  assert.equal(Object.keys(loadOpenClawEvidenceRequests()).length, 1);
  assert.equal(listOpenClawEvidenceRequestsByPacketId('p1').length, 1);
  clearOpenClawEvidenceRequests();
  assert.equal(Object.keys(loadOpenClawEvidenceRequests()).length, 0);
});
