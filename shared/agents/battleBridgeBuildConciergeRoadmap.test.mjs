import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP,
  BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES,
  plannedConciergeRoadmapVersions,
} from './battleBridgeBuildConciergeRoadmap.mjs';

const requiredVersions = ['V4', 'V5', 'V6', 'V7', 'V8'];

test('V4-V8 roadmap specs are source-owned with V4 browser proof, V5 auto-pick, V6 approval, and V7 post-merge sync implemented_guarded', () => {
  const planned = plannedConciergeRoadmapVersions();
  assert.deepEqual(planned.map((phase) => phase.version), requiredVersions);
  for (const phase of planned) {
    if (['V4', 'V5', 'V6', 'V7'].includes(phase.version)) assert.equal(phase.status, 'implemented_guarded');
    else assert.equal(phase.status, 'planned_guarded', `${phase.version} must not claim implementation`);
    assert.deepEqual(phase.requiredSurfaces, BATTLE_BRIDGE_BUILD_CONCIERGE_SURFACES);
    assert.ok(phase.guardrails.length >= 3, `${phase.version} needs guardrail specs`);
    assert.ok(phase.testsRequired.some((item) => item.includes(phase.version)));
  }
});

test('roadmap preserves required V4-V8 truth boundaries', () => {
  const byVersion = Object.fromEntries(BATTLE_BRIDGE_BUILD_CONCIERGE_ROADMAP.map((phase) => [phase.version, phase]));
  assert.match(byVersion.V4.intent, /checklist, screenshot path, console errors, and caveats/);
  assert.match(byVersion.V4.guardrails.join(' '), /No browser proof claim/);
  assert.match(byVersion.V5.intent, /open\/ready state, mergeability, clean required checks, declared allowlisted proof commands/);
  assert.match(byVersion.V5.guardrails.join(' '), /No fake GitHub proof/);
  assert.match(byVersion.V6.intent, /one canonical approve\/reject surface state/);
  assert.match(byVersion.V6.guardrails.join(' '), /UI\/state must never merge directly/i);
  assert.match(byVersion.V7.intent, /approved merge receipt is observed/);
  assert.match(byVersion.V7.guardrails.join(' '), /Dirty-tree auto mutation and PC restart are prohibited/);
  assert.match(byVersion.V8.intent, /one active proof lane unless isolation is explicit/);
  assert.match(byVersion.V8.guardrails.join(' '), /Visible blockers, progress, and next action/);
});
