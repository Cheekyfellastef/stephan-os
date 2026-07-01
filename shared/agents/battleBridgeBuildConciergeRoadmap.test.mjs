import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP,
  BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES,
  plannedConciergeRoadmapVersions,
} from './battleBridgeBuildConciergeRoadmap.mjs';

const requiredVersions = ['V4', 'V5', 'V6', 'V7', 'V8'];

test('V4-V8 roadmap specs are source-owned and planned_guarded until implemented', () => {
  const planned = plannedConciergeRoadmapVersions();
  assert.deepEqual(planned.map((phase) => phase.version), requiredVersions);
  for (const phase of planned) {
    assert.equal(phase.status, 'planned_guarded', `${phase.version} must not claim implementation`);
    assert.deepEqual(phase.requiredSurfaces, BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES);
    assert.ok(phase.guardrails.length >= 3, `${phase.version} needs guardrail specs`);
    assert.ok(phase.testsRequired.some((item) => item.includes(phase.version)));
  }
});

test('roadmap preserves required V4-V8 truth boundaries', () => {
  const byVersion = Object.fromEntries(BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP.map((phase) => [phase.version, phase]));
  assert.match(byVersion.V4.intent, /checklist, screenshot path, console errors, and caveats/);
  assert.match(byVersion.V4.guardrails.join(' '), /No browser proof claim/);
  assert.match(byVersion.V5.intent, /mergeability, blockers, labels, and declared proof commands/);
  assert.match(byVersion.V5.guardrails.join(' '), /No fake GitHub proof/);
  assert.match(byVersion.V6.intent, /one approve\/reject UI state/);
  assert.match(byVersion.V6.guardrails.join(' '), /must not merge without a matching approval token/i);
  assert.match(byVersion.V7.intent, /After an approved merge only/);
  assert.match(byVersion.V7.guardrails.join(' '), /Dirty-tree auto mutation and PC restart are prohibited/);
  assert.match(byVersion.V8.intent, /one active proof lane unless isolation is explicit/);
  assert.match(byVersion.V8.guardrails.join(' '), /Visible blockers, progress, and next action/);
});
