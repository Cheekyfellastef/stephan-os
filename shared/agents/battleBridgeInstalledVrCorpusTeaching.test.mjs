import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadRegisteredVrTeachingProjectionV1 } from './vrTeachingRegistryLoaderV1.mjs';

const UPDATED_AT = '2026-09-29T04:38:36.6253282+01:00';
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const packet = JSON.parse(readFileSync(resolve(repoRoot, 'VR-Research-Lab/knowledge-sources/battle-bridge-installed-vr-corpus/teaching-records.json'), 'utf8'));
const receipt = JSON.parse(readFileSync(resolve(repoRoot, 'evidence/receipts/vr-battle-bridge-installed-vr-corpus-2026-09-29.json'), 'utf8'));

test('registered Battle Bridge corpus is automatically loaded into the governed production teaching projection', async () => {
  const result = await loadRegisteredVrTeachingProjectionV1({
    repoRoot,
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
  });

  const loaded = result.loadedTeachingPackets.find((entry) => entry.sourceId === 'battle-bridge-installed-vr-corpus');
  assert.ok(loaded);
  assert.equal(loaded.recordCount, 10);
  assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');
  assert.equal(result.agentReadModel.verdict, 'VR_RESEARCH_AGENT_READY');
  assert.equal(result.projection.methodLibrary.filter((entry) => entry.sourceId === 'battle-bridge-installed-vr-corpus').length, 10);
  assert.equal(result.projection.capabilityGraphCandidates.filter((entry) => entry.sourceId === 'battle-bridge-installed-vr-corpus').length, 10);
  assert.ok(result.projection.proofRefs.includes('evidence/receipts/vr-battle-bridge-installed-vr-corpus-2026-09-29.json'));
});

test('Battle Bridge teaching is bound to a durable safe receipt and never self-certifies runtime proof', () => {
  assert.equal(receipt.sourceId, 'battle-bridge-installed-vr-corpus');
  assert.equal(receipt.rawManifestSha256, '1e9b4ed9a990d8f576b91be4fb94e968f657a73c92af9a8091f53c1aa08af1c8');
  assert.equal(receipt.specimenCount, 16);
  assert.equal(receipt.rawManifestDisposition, 'operator-local-only-not-committed');
  for (const record of packet.records) {
    assert.deepEqual(record.proofRefs, ['evidence/receipts/vr-battle-bridge-installed-vr-corpus-2026-09-29.json']);
    assert.ok(record.evidencePlanes.includes('APPROVED_LOCAL_PACKAGE_EVIDENCE'));
    assert.ok(record.evidencePlanes.includes('STEPHANOS_INFERENCE_OR_PROPOSAL'));
    assert.ok(!record.evidencePlanes.includes('OBSERVED_RUNTIME_OR_HEADSET_PROOF'));
  }
});
