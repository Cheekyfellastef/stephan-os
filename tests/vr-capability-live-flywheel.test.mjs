import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CONCEPT_CATALOG,
  CONCEPT_LIMIT,
  mergeLiveConcepts,
  rankConcepts,
} from '../apps/vr-capability-atlas/atlas-concepts.mjs';
import { projectVrCapabilityLiveTruth } from '../shared/agents/vrCapabilityLiveTruthV2.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledger = JSON.parse(await readFile(resolve(root, 'VR-Research-Lab/capability-readiness.json'), 'utf8'));
const NOW = Date.parse('2026-09-19T21:30:00+01:00');
const clone = (value) => JSON.parse(JSON.stringify(value));

test('Atlas concept horizon can grow beyond the ten seed concepts', () => {
  const projected = projectVrCapabilityLiveTruth({
    baseLedger: clone(ledger),
    baseConcepts: clone(CONCEPT_CATALOG.slice(0, 10)),
    workspaceConceptCandidates: [{
      id: 'orbital-workshop',
      title: 'Orbital workshop habitat',
      description: 'A new proof-backed concept.',
      tags: ['spatial', 'workshop'],
      atlasVisible: true,
      designProven: true,
      evidence: ['proofs/vr-capability/orbital-workshop/design'],
    }],
    nowMs: NOW,
  });
  assert.equal(projected.concepts.length, 11);
  assert.equal(Number.isFinite(CONCEPT_LIMIT), false);
  mergeLiveConcepts(projected.concepts);
  assert.ok(rankConcepts(CONCEPT_CATALOG, [], CONCEPT_LIMIT).length >= 11);
});

test('Atlas and backend are wired to the live proof feed and Spatial Workspace visual path', async () => {
  const html = await readFile(resolve(root, 'apps/vr-capability-atlas/index-v3.html'), 'utf8');
  const client = await readFile(resolve(root, 'apps/vr-capability-atlas/atlas-live-capability-feed.mjs'), 'utf8');
  const route = await readFile(resolve(root, 'stephanos-server/routes/shared-workspace.js'), 'utf8');
  const service = await readFile(resolve(root, 'stephanos-server/services/vrCapabilityFeedService.js'), 'utf8');
  const publisher = await readFile(resolve(root, 'shared/agents/vrCapabilityEvidencePublisherV1.mjs'), 'utf8');
  assert.match(html, /atlas-live-capability-feed\.mjs/);
  assert.match(html, /no longer limited to ten ideas/);
  assert.match(client, /\/api\/shared-workspace\/vr-capability-feed/);
  assert.match(client, /currentViewUrl/);
  assert.match(client, /mergeLiveConcepts/);
  assert.match(route, /\/vr-capability-feed/);
  assert.match(service, /projectVrCapabilityLiveTruth/);
  assert.match(publisher, /spatialWorkspaceVisual|visualEvidence/);
  assert.doesNotMatch(html, /10 responsive thumbnails/);
});
