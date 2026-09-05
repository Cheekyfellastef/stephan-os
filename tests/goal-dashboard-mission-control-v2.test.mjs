import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');

test('Goal Dashboard V2 is a graphical mission-control screen rather than a basic card list', () => {
  for (const expected of [
    'goal-dashboard-mission-control-v2',
    'DELUXE LIVE MISSION CONTROL',
    'Programme road to unattended operation',
    'Capability health',
    'Open work distribution',
    'Recent movement',
    'Major build fronts',
    'Battle Bridge readiness',
    'Critical path',
    'Project health radar',
    'Next milestones',
    'Proof / truth matrix',
    'conic-gradient',
    'radar-shape',
  ]) {
    assert.equal(source.includes(expected), true, `missing Mission Control surface: ${expected}`);
  }
});

test('Goal Dashboard V2 keeps truth semantics explicit and refuses decorative fake certainty', () => {
  for (const expected of [
    'CURRENT',
    'STALE',
    'UNKNOWN',
    'CONFLICTING',
    'MISSING',
    'UNAVAILABLE',
    'categorical, evidence-derived',
    'No commit history is invented.',
    'No target date fabricated',
    'source ≠ CI ≠ review ≠ merged ≠ live',
  ]) {
    assert.equal(source.includes(expected), true, `missing truth boundary: ${expected}`);
  }
});

test('Goal Dashboard V2 has responsive, touch-sized composition and reduced-motion protection', () => {
  assert.match(source, /@media \(max-width:760px\)/);
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(source, /animation:none !important/);
  assert.match(source, /grid-template-columns:repeat\(2,1fr\)/);
});

test('Goal Dashboard V2 retains the existing bounded live feed and 4173-to-8787 routing contract', () => {
  assert.match(source, /\/api\/shared-workspace\/dashboard-feed/);
  assert.match(source, /\/api\/goal-projection\/live/);
  assert.match(source, /String\(loc\.port \|\| ''\) === '4173'/);
  assert.match(source, /':8787'/);
  assert.match(source, /function escapeHtml/);
  assert.match(source, /escapeHtml\(goal\.title\)/);
});
