import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CAPABILITY_READINESS_SCHEMA,
  capabilityReadinessForConcept,
  scoreCapabilityEntry,
} from '../apps/vr-capability-atlas/capability-readiness-core.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledger = JSON.parse(await readFile(resolve(root, 'VR-Research-Lab/capability-readiness.json'), 'utf8'));

test('capability readiness is absolute, evidence-gated and not normalized against research fit', () => {
  assert.equal(ledger.schemaVersion, CAPABILITY_READINESS_SCHEMA);
  assert.equal(ledger.scoring.absolute, true);
  assert.equal(ledger.scoring.normalized, false);
  assert.equal(ledger.scoring.unknownContributes, 0);

  const factory = capabilityReadinessForConcept(ledger, 'capability-factory', {
    nowMs: Date.parse('2026-09-19T21:00:00+01:00'),
  });
  assert.equal(factory.available, true);
  assert.equal(factory.percent, 40);
  assert.equal(factory.complete, false);

  const starship = capabilityReadinessForConcept(ledger, 'living-starship', {
    nowMs: Date.parse('2026-09-19T21:00:00+01:00'),
  });
  assert.equal(starship.percent, 10);
});

test('100 capability means every proof gate is explicitly proven', () => {
  const complete = scoreCapabilityEntry({
    stages: {
      design: { status: 'proven' },
      implementation: { status: 'proven' },
      automatedProof: { status: 'proven' },
      runtimeProof: { status: 'proven' },
      operatorAcceptance: { status: 'proven' },
    },
  });
  assert.equal(complete.percent, 100);
  assert.equal(complete.complete, true);

  const missingAcceptance = scoreCapabilityEntry({
    stages: {
      design: { status: 'proven' },
      implementation: { status: 'proven' },
      automatedProof: { status: 'proven' },
      runtimeProof: { status: 'proven' },
      operatorAcceptance: { status: 'pending' },
    },
  });
  assert.equal(missingAcceptance.percent, 80);
  assert.equal(missingAcceptance.complete, false);
});

test('stale or unavailable evidence never produces a guessed capability percentage', () => {
  const stale = capabilityReadinessForConcept(ledger, 'capability-factory', {
    nowMs: Date.parse('2026-10-10T21:00:00+01:00'),
  });
  assert.equal(stale.available, false);
  assert.equal(stale.stale, true);
  assert.equal(stale.percent, null);

  const unknown = capabilityReadinessForConcept(ledger, 'not-a-real-capability', {
    nowMs: Date.parse('2026-09-19T21:00:00+01:00'),
  });
  assert.equal(unknown.available, false);
  assert.equal(unknown.percent, null);
});

test('Atlas UI loads capability readiness after the main Atlas renderer and labels both percentages', async () => {
  const html = await readFile(resolve(root, 'apps/vr-capability-atlas/index-v3.html'), 'utf8');
  const client = await readFile(resolve(root, 'apps/vr-capability-atlas/atlas-capability-readiness.mjs'), 'utf8');
  const atlasIndex = html.indexOf('./atlas-v3.js');
  const readinessIndex = html.indexOf('./atlas-capability-readiness.mjs');
  assert.ok(atlasIndex >= 0);
  assert.ok(readinessIndex > atlasIndex);
  assert.match(html, /Capability readiness is not normalized/);
  assert.match(html, /capability-readiness\.json/);
  assert.match(client, /% capability/);
  assert.match(client, /stale evidence shows as unavailable/);
});
