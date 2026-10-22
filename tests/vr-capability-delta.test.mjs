import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CONCEPT_CATALOG } from '../apps/vr-capability-atlas/atlas-concepts.mjs';
import {
  CAPABILITY_READINESS_SCHEMA,
  capabilityReadinessForConcept,
  maturityBandForPercent,
  scoreCapabilityEntry,
} from '../apps/vr-capability-atlas/capability-readiness-core.mjs';
import { buildCurrentCapabilitySvg } from '../apps/vr-capability-atlas/atlas-capability-delta.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledger = JSON.parse(await readFile(resolve(root, 'VR-Research-Lab/capability-readiness.json'), 'utf8'));
const nowMs = Date.parse('2026-09-19T21:15:00+01:00');

test('capability readiness is absolute and every Atlas concept has canonical evidence state', () => {
  assert.equal(ledger.schemaVersion, CAPABILITY_READINESS_SCHEMA);
  assert.equal(ledger.scoring.absolute, true);
  assert.equal(ledger.scoring.normalized, false);
  assert.equal(ledger.scoring.unknownContributes, 0);
  const registered = new Set(ledger.capabilities.map((entry) => entry.id));
  assert.equal(CONCEPT_CATALOG.length, 10);
  for (const concept of CONCEPT_CATALOG) assert.ok(registered.has(concept.id), `missing readiness entry for ${concept.id}`);
});

test('current capability maturity is conservative rather than normalized to the strongest concept', () => {
  const factory = capabilityReadinessForConcept(ledger, 'capability-factory', { nowMs });
  const starship = capabilityReadinessForConcept(ledger, 'living-starship', { nowMs });
  assert.equal(factory.percent, 40);
  assert.equal(starship.percent, 10);
  assert.equal(maturityBandForPercent(factory.percent), 'prototype');
  assert.equal(maturityBandForPercent(starship.percent), 'design-grounded');
});

test('100 capability can only mean every proof gate is proven', () => {
  const scored = scoreCapabilityEntry({ stages: {
    design: { status: 'proven' },
    implementation: { status: 'proven' },
    automatedProof: { status: 'proven' },
    runtimeProof: { status: 'proven' },
    operatorAcceptance: { status: 'proven' },
  }});
  assert.equal(scored.percent, 100);
  assert.equal(scored.complete, true);

  const noAcceptance = scoreCapabilityEntry({ stages: {
    design: { status: 'proven' },
    implementation: { status: 'proven' },
    automatedProof: { status: 'proven' },
    runtimeProof: { status: 'proven' },
  }});
  assert.equal(noAcceptance.percent, 80);
  assert.equal(noAcceptance.complete, false);
});

test('grounded current-capability pictures visibly encode maturity and never claim more proof than the ledger', () => {
  const starship = CONCEPT_CATALOG.find((concept) => concept.id === 'living-starship');
  const factory = CONCEPT_CATALOG.find((concept) => concept.id === 'capability-factory');
  const starshipState = capabilityReadinessForConcept(ledger, starship.id, { nowMs });
  const factoryState = capabilityReadinessForConcept(ledger, factory.id, { nowMs });
  const starshipSvg = buildCurrentCapabilitySvg(starship, starshipState);
  const factorySvg = buildCurrentCapabilitySvg(factory, factoryState);
  assert.match(starshipSvg, /CURRENT CAPABILITY PROJECTION/);
  assert.match(starshipSvg, />10%<\/text>/);
  assert.match(starshipSvg, /DESIGN-GROUNDED/);
  assert.match(factorySvg, />40%<\/text>/);
  assert.match(factorySvg, /IMPLEMENTED PROTOTYPE/);
});

test('Atlas wires a mirrored current-capability strip plus Concept Current Capability Delta hero modes', async () => {
  const html = await readFile(resolve(root, 'apps/vr-capability-atlas/index-v3.html'), 'utf8');
  const client = await readFile(resolve(root, 'apps/vr-capability-atlas/atlas-capability-delta.mjs'), 'utf8');
  const runtime = await readFile(resolve(root, 'apps/vr-capability-atlas/atlas-capability-delta-runtime.mjs'), 'utf8');
  assert.match(html, /Concept Views/);
  assert.match(html, /current-capability projection/);
  assert.match(html, /atlas-capability-delta\.mjs/);
  assert.match(html, /atlas-capability-delta-runtime\.mjs/);
  assert.match(client, /Current Capability Views/);
  assert.match(client, /data-current-concept-id/);
  assert.match(client, /data-capability-mode="concept"/);
  assert.match(client, /data-capability-mode="current"/);
  assert.match(client, /data-capability-mode="delta"/);
  assert.match(client, /Capability delta:/);
  assert.match(runtime, /data-capability-mode="current"/);
});

test('stale evidence shows unavailable instead of manufacturing a capability percentage', () => {
  const stale = capabilityReadinessForConcept(ledger, 'capability-factory', { nowMs: Date.parse('2026-10-10T22:00:00+01:00') });
  assert.equal(stale.available, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.percent, null);
});
