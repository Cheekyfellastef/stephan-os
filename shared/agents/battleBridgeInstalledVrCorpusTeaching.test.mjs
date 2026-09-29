import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { projectVrTeachingIntoSharedWorkspace } from './vrTeachingWorkspaceProjectionV1.mjs';

const registry = JSON.parse(readFileSync(new URL('../../VR-Research-Lab/knowledge-sources.json', import.meta.url), 'utf8'));
const packet = JSON.parse(readFileSync(new URL('../../VR-Research-Lab/knowledge-sources/battle-bridge-installed-vr-corpus/teaching-records.json', import.meta.url), 'utf8'));
const UPDATED_AT = '2026-09-29T04:38:36.6253282+01:00';

test('Battle Bridge installed VR corpus projects into the governed VR teaching workspace', () => {
  const result = projectVrTeachingIntoSharedWorkspace({
    sourceRegistry: registry,
    teachingRecords: packet.records,
    updatedAt: UPDATED_AT,
    nowMs: Date.parse(UPDATED_AT),
    workspaceModel: { targets: [{ name: 'Starfield VR' }] },
  });

  assert.equal(result.projectionReceipt.verdict, 'VR_TEACHING_WORKSPACE_PROJECTION_READY');
  assert.equal(result.projectionReceipt.counters.seen, 10);
  assert.equal(result.projectionReceipt.counters.projected, 10);
  assert.equal(result.projectionReceipt.counters.policyBlocked, 0);
  assert.equal(result.agentReadModel.verdict, 'VR_RESEARCH_AGENT_READY');
  assert.equal(result.projection.methodLibrary.length, 10);
  assert.equal(result.projection.capabilityGraphCandidates.length, 10);
  assert.ok(result.projection.proofRefs.includes('proofs/vr/battle-bridge-installed-vr-corpus-2026-09-29'));
});

test('Battle Bridge teaching remains local-package evidence, never self-certified runtime proof', () => {
  for (const record of packet.records) {
    assert.ok(record.evidencePlanes.includes('APPROVED_LOCAL_PACKAGE_EVIDENCE'));
    assert.ok(record.evidencePlanes.includes('STEPHANOS_INFERENCE_OR_PROPOSAL'));
    assert.ok(!record.evidencePlanes.includes('OBSERVED_RUNTIME_OR_HEADSET_PROOF'));
    assert.equal(record.observedIdentity, 'sha256:1e9b4ed9a990d8f576b91be4fb94e968f657a73c92af9a8091f53c1aa08af1c8');
  }
});
