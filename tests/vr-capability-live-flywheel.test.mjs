import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONCEPT_CATALOG,
  CONCEPT_LIMIT,
  mergeLiveConcepts,
  rankConcepts,
} from '../apps/vr-capability-atlas/atlas-concepts.mjs';
import { capabilityReadinessForConcept } from '../apps/vr-capability-atlas/capability-readiness-core.mjs';
import {
  aggregateVerificationResults,
  createVerifierResult,
  VERIFICATION_STATUS,
  writeVerificationPacketToSharedWorkspace,
} from '../shared/agents/verificationHarness.mjs';
import { readSharedWorkspaceDashboardFeed } from '../shared/agents/shared-workspace-dashboard-feed.mjs';
import {
  createVrCapabilityProofRef,
  buildVrCapabilityVerificationMetadata,
} from '../shared/agents/vrCapabilityProofContractV1.mjs';
import {
  createVrCapabilityEvidenceRecord,
  publishVrCapabilityEvidence,
} from '../shared/agents/vrCapabilityEvidencePublisherV1.mjs';
import { projectVrCapabilityLiveState } from '../shared/agents/vrCapabilityLiveProjectionV1.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baseLedger = JSON.parse(await readFile(resolve(root, 'VR-Research-Lab/capability-readiness.json'), 'utf8'));
const NOW = Date.parse('2026-09-19T21:30:00+01:00');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('Verification Harness PASS proof refs automatically promote the matching VR capability stage', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'stephanos-vr-capability-proof-'));
  const proofRef = createVrCapabilityProofRef('living-starship', 'implementation');
  const check = createVerifierResult({
    checkId: 'living-starship-implementation',
    verifierType: 'FileVerifier',
    status: VERIFICATION_STATUS.PASS,
    target: 'living-starship-implementation',
    evidence: ['implementation=true'],
    timestampUtc: '2026-09-19T20:28:00Z',
    proofRefs: [proofRef],
  });
  const aggregate = aggregateVerificationResults({
    aggregateId: 'living-starship-implementation',
    checks: [check],
    timestampUtc: '2026-09-19T20:28:00Z',
  });
  const write = await writeVerificationPacketToSharedWorkspace(workspace, aggregate, { repoRoot: root, nowMs: NOW });
  assert.equal(write.ok, true);

  const shared = await readSharedWorkspaceDashboardFeed({
    root: workspace,
    repoRoot: root,
    nowMs: NOW,
    staleAfterMs: 24 * 60 * 60 * 1000,
  });
  const live = projectVrCapabilityLiveState({
    baseLedger: clone(baseLedger),
    baseConcepts: clone(CONCEPT_CATALOG.slice(0, 10)),
    records: shared.records,
    nowMs: NOW,
  });
  const starship = capabilityReadinessForConcept(live.ledger, 'living-starship', { nowMs: NOW });
  assert.equal(starship.available, true);
  assert.equal(starship.percent, 40);
  assert.equal(starship.gates.find((gate) => gate.id === 'implementation').proven, true);
  assert.ok(live.evidenceSummary.acceptedPromotionCount >= 1);
});

test('ambiguous or failed records never promote capability readiness', () => {
  const live = projectVrCapabilityLiveState({
    baseLedger: clone(baseLedger),
    baseConcepts: clone(CONCEPT_CATALOG.slice(0, 10)),
    records: {
      proofRecords: [
        { status: 'PASS', capabilityId: 'living-starship', proofRefs: ['proofs/other-proof'] },
        { status: 'FAIL', proofRefs: [createVrCapabilityProofRef('living-starship', 'implementation')] },
      ],
    },
    nowMs: NOW,
  });
  const starship = capabilityReadinessForConcept(live.ledger, 'living-starship', { nowMs: NOW });
  assert.equal(starship.percent, 10);
  assert.ok(live.evidenceSummary.ignoredAmbiguousCount >= 1);
});

test('Spatial Workspace verified capture becomes the Current Capability visual source', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'stephanos-vr-spatial-proof-'));
  const published = await publishVrCapabilityEvidence(workspace, {
    capabilityId: 'living-starship',
    stage: 'runtimeProof',
    passed: true,
    timestampUtc: '2026-09-19T20:29:00Z',
    summary: 'Living Starship observed in Spatial Workspace',
    visualEvidence: {
      url: '/api/spatial-workspace/captures/living-starship-current.webp',
      source: 'spatial-workspace',
      state: 'OBSERVED',
      observedAt: '2026-09-19T20:29:00Z',
    },
  }, { repoRoot: root, nowMs: NOW });
  assert.equal(published.ok, true);

  const shared = await readSharedWorkspaceDashboardFeed({ root: workspace, repoRoot: root, nowMs: NOW, staleAfterMs: 86_400_000 });
  const live = projectVrCapabilityLiveState({ baseLedger: clone(baseLedger), baseConcepts: clone(CONCEPT_CATALOG.slice(0, 10)), records: shared.records, nowMs: NOW });
  const starship = capabilityReadinessForConcept(live.ledger, 'living-starship', { nowMs: NOW });
  assert.equal(starship.gates.find((gate) => gate.id === 'runtimeProof').proven, true);
  assert.equal(starship.visual.currentViewUrl, '/api/spatial-workspace/captures/living-starship-current.webp');
  assert.equal(starship.visual.currentViewSource, 'spatial-workspace');
  assert.equal(live.evidenceSummary.spatialVisualCount, 1);
});

test('capability freshness is per capability, so one fresh proof cannot freshen unrelated stale capability truth', () => {
  const future = Date.parse('2026-10-10T21:30:00+01:00');
  const live = projectVrCapabilityLiveState({
    baseLedger: clone(baseLedger),
    baseConcepts: clone(CONCEPT_CATALOG.slice(0, 10)),
    records: {
      proofRecords: [{
        status: 'PASS',
        timestampUtc: '2026-10-10T20:25:00Z',
        proofId: 'capability-factory-runtime-refresh',
        proofRefs: [createVrCapabilityProofRef('capability-factory', 'runtimeProof')],
      }],
    },
    nowMs: future,
  });
  const factory = capabilityReadinessForConcept(live.ledger, 'capability-factory', { nowMs: future });
  const starship = capabilityReadinessForConcept(live.ledger, 'living-starship', { nowMs: future });
  assert.equal(factory.available, true);
  assert.equal(starship.available, false);
  assert.equal(starship.stale, true);
});

test('concept catalogue is no longer capped at ten and can grow from canonical live concept candidates', () => {
  const candidate = {
    id: 'orbital-workshop',
    title: 'Orbital workshop habitat',
    description: 'A persistent spatial workshop assembled from newly proven workspace ideas.',
    tags: ['spatial', 'workshop', 'persistent'],
    atlasVisible: true,
    designProven: true,
    evidence: ['proofs/vr-capability/orbital-workshop/design'],
    visual: { conceptViewUrl: '/api/media/vr-concepts/orbital-workshop' },
  };
  const live = projectVrCapabilityLiveState({
    baseLedger: clone(baseLedger),
    baseConcepts: clone(CONCEPT_CATALOG.slice(0, 10)),
    workspaceConceptCandidates: [candidate],
    records: {},
    nowMs: NOW,
  });
  assert.equal(live.concepts.length, 11);
  assert.equal(live.ledger.capabilities.find((entry) => entry.id === 'orbital-workshop')?.stages?.design?.status, 'proven');
  assert.equal(Number.isFinite(CONCEPT_LIMIT), false);
  mergeLiveConcepts([live.concepts.find((concept) => concept.id === 'orbital-workshop')]);
  const ranked = rankConcepts(CONCEPT_CATALOG, [], CONCEPT_LIMIT);
  assert.ok(ranked.length >= 11);
});

test('canonical proof contract produces Verification Harness compatible safe proof refs', () => {
  const metadata = buildVrCapabilityVerificationMetadata({ capabilityId: 'physical-interaction', stage: 'automatedProof' });
  assert.equal(metadata.proofRefs[0], 'proofs/vr-capability/physical-interaction/automatedProof');
  const record = createVrCapabilityEvidenceRecord({
    capabilityId: 'physical-interaction',
    stage: 'operatorAcceptance',
    accepted: true,
    timestampUtc: '2026-09-19T20:20:00Z',
  });
  assert.equal(record.status, 'PASS');
  assert.match(record.body, /operatorAcceptance/);
});

test('Atlas and backend are wired to the live capability feed and scalable concept horizon', async () => {
  const html = await readFile(resolve(root, 'apps/vr-capability-atlas/index-v3.html'), 'utf8');
  const client = await readFile(resolve(root, 'apps/vr-capability-atlas/atlas-live-capability-feed.mjs'), 'utf8');
  const route = await readFile(resolve(root, 'stephanos-server/routes/shared-workspace.js'), 'utf8');
  const service = await readFile(resolve(root, 'stephanos-server/services/vrCapabilityFeedService.js'), 'utf8');
  assert.match(html, /atlas-live-capability-feed\.mjs/);
  assert.match(html, /no longer limited to ten ideas/);
  assert.match(client, /\/api\/shared-workspace\/vr-capability-feed/);
  assert.match(client, /currentViewUrl/);
  assert.match(client, /mergeLiveConcepts/);
  assert.match(route, /\/vr-capability-feed/);
  assert.match(service, /projectVrCapabilityLiveState/);
  assert.doesNotMatch(html, /10 responsive thumbnails/);
});
