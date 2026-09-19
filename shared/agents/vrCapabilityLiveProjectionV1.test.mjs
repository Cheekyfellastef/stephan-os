import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { capabilityReadinessForConcept } from '../../apps/vr-capability-atlas/capability-readiness-core.mjs';
import { CONCEPT_CATALOG } from '../../apps/vr-capability-atlas/atlas-concepts.mjs';
import {
  aggregateVerificationResults,
  createVerifierResult,
  VERIFICATION_STATUS,
  writeVerificationPacketToSharedWorkspace,
} from './verificationHarness.mjs';
import { readSharedWorkspaceDashboardFeed } from './shared-workspace-dashboard-feed.mjs';
import { createVrCapabilityProofRef } from './vrCapabilityProofContractV1.mjs';
import { publishVrCapabilityEvidence } from './vrCapabilityEvidencePublisherV1.mjs';
import { projectVrCapabilityLiveTruth } from './vrCapabilityLiveTruthV2.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const baseLedger = JSON.parse(await readFile(resolve(repoRoot, 'VR-Research-Lab/capability-readiness.json'), 'utf8'));
const NOW = Date.parse('2026-09-19T21:30:00+01:00');
const clone = (value) => JSON.parse(JSON.stringify(value));

test('Verification Harness canonical proof ref promotes one exact VR capability gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-vr-live-proof-'));
  const ref = createVrCapabilityProofRef('living-starship', 'implementation');
  const check = createVerifierResult({
    checkId: 'living-starship-implementation',
    verifierType: 'FileVerifier',
    status: VERIFICATION_STATUS.PASS,
    target: 'living-starship',
    evidence: ['implementation=true'],
    timestampUtc: '2026-09-19T20:28:00Z',
    proofRefs: [ref],
  });
  const aggregate = aggregateVerificationResults({ aggregateId: 'living-starship-implementation', checks: [check], timestampUtc: '2026-09-19T20:28:00Z' });
  const written = await writeVerificationPacketToSharedWorkspace(root, aggregate, { repoRoot, nowMs: NOW });
  assert.equal(written.ok, true);
  const shared = await readSharedWorkspaceDashboardFeed({ root, repoRoot, nowMs: NOW, staleAfterMs: 86_400_000 });
  const projected = projectVrCapabilityLiveTruth({ baseLedger: clone(baseLedger), baseConcepts: clone(CONCEPT_CATALOG), records: shared.records, nowMs: NOW });
  const result = capabilityReadinessForConcept(projected.ledger, 'living-starship', { nowMs: NOW });
  assert.equal(result.percent, 40);
  assert.equal(result.gates.find((gate) => gate.id === 'implementation')?.proven, true);
});

test('failed and ambiguous VR evidence stays fail-closed without inflating capability', () => {
  const projected = projectVrCapabilityLiveTruth({
    baseLedger: clone(baseLedger),
    baseConcepts: clone(CONCEPT_CATALOG),
    records: { proofRecords: [
      { status: 'PASS', capabilityId: 'living-starship', proofRefs: ['proofs/unrelated'] },
      { status: 'FAIL', timestampUtc: '2026-09-19T20:29:00Z', proofRefs: [createVrCapabilityProofRef('living-starship', 'runtimeProof')] },
    ] },
    nowMs: NOW,
  });
  assert.equal(capabilityReadinessForConcept(projected.ledger, 'living-starship', { nowMs: NOW }).percent, 10);
});

test('newer failed proof revokes an older live promotion instead of leaving a stale high score', () => {
  const ref = createVrCapabilityProofRef('living-starship', 'implementation');
  const projected = projectVrCapabilityLiveTruth({
    baseLedger: clone(baseLedger),
    baseConcepts: clone(CONCEPT_CATALOG),
    records: { proofRecords: [
      { proofId: 'new-fail', status: 'FAIL', timestampUtc: '2026-09-19T20:29:00Z', proofRefs: [ref] },
      { proofId: 'old-pass', status: 'PASS', timestampUtc: '2026-09-19T20:20:00Z', proofRefs: [ref] },
    ] },
    nowMs: NOW,
  });
  const result = capabilityReadinessForConcept(projected.ledger, 'living-starship', { nowMs: NOW });
  assert.equal(result.percent, 10);
  assert.equal(result.gates.find((gate) => gate.id === 'implementation')?.proven, false);
  assert.equal(projected.evidenceSummary.revokedStageCount, 1);
});

test('verified Spatial Workspace visual evidence becomes the live Current Capability source', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-vr-live-visual-'));
  const published = await publishVrCapabilityEvidence(root, {
    capabilityId: 'spatial-bridge',
    stage: 'runtimeProof',
    passed: true,
    timestampUtc: '2026-09-19T20:29:00Z',
    visualEvidence: {
      url: 'https://battle-bridge.invalid/captures/spatial-bridge.webp',
      source: 'spatial-workspace',
      state: 'OBSERVED',
    },
  }, { repoRoot, nowMs: NOW });
  assert.equal(published.ok, true);
  const shared = await readSharedWorkspaceDashboardFeed({ root, repoRoot, nowMs: NOW, staleAfterMs: 86_400_000 });
  const projected = projectVrCapabilityLiveTruth({ baseLedger: clone(baseLedger), baseConcepts: clone(CONCEPT_CATALOG), records: shared.records, nowMs: NOW });
  const result = capabilityReadinessForConcept(projected.ledger, 'spatial-bridge', { nowMs: NOW });
  assert.equal(result.visual.currentViewUrl, 'https://battle-bridge.invalid/captures/spatial-bridge.webp');
  assert.equal(result.visual.currentViewSource, 'spatial-workspace');
  assert.equal(projected.evidenceSummary.spatialVisualCount, 1);
});

test('canonical live concept candidate expands the Atlas beyond the ten seed concepts', () => {
  const projected = projectVrCapabilityLiveTruth({
    baseLedger: clone(baseLedger),
    baseConcepts: clone(CONCEPT_CATALOG.slice(0, 10)),
    workspaceConceptCandidates: [{
      id: 'orbital-workshop',
      title: 'Orbital workshop habitat',
      description: 'A new canonical spatial workshop concept.',
      tags: ['spatial', 'workshop'],
      atlasVisible: true,
      designProven: true,
      evidence: ['proofs/vr-capability/orbital-workshop/design'],
    }],
    nowMs: NOW,
  });
  assert.equal(projected.concepts.length, 11);
  assert.equal(projected.ledger.capabilities.find((entry) => entry.id === 'orbital-workshop')?.stages?.design?.status, 'proven');
});
