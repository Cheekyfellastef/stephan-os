import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/goal-dashboard/index.html', import.meta.url), 'utf8');

test('Goal Dashboard static page contains Build Concierge V2-V8 truth rail', () => {
  for (const expected of [
    'Build Concierge',
    'V2',
    'V3 next',
    'implemented_guarded',
    'exact-head approval required',
    'V4 Browser Proof Capture',
    'V5 Auto Pick Next Safe Work',
    'V6 Operator Approval Surface',
    'V7 Post-Merge Sync and Reproof',
    'V8 Multi-Goal Queue',
  ]) {
    assert.equal(source.includes(expected), true, `missing static Build Concierge text: ${expected}`);
  }
});

test('Goal Dashboard static page keeps Build Concierge live proof claims blocked', () => {
  for (const expected of [
    'GitHub proof, local proof, and browser proof are not claimed from this static page.',    'unknown remains unknown',
    'static seeded visibility only',
  ]) {
    assert.equal(source.includes(expected), true, `missing honest static proof boundary: ${expected}`);
  }
});

test('Goal Dashboard static Build Concierge copy follows canonical roadmap text', () => {
  assert.equal(source.includes('V2 Operator Surfaces'), true);
  assert.equal(source.includes('V3 Local Proof Runner'), true);
  assert.equal(source.includes('V4 Browser Proof Capture'), true);
});

test('Goal Dashboard static Concierge rail wraps long exact-head and merge-hold text safely', () => {
  assert.equal(source.includes('overflow-wrap: anywhere'), true);
});
