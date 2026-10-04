import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('./index.html', import.meta.url), 'utf8');

test('standalone Goal Dashboard shows V4 implemented and blocked browser-proof truth', () => {
  for (const value of [
    'Build Concierge',
    'V4 Browser Proof Capture',
    'implemented_guarded',
    'V4 browser proof status',
    'blocked_unavailable',
    'V4 proof unavailable blocker',
    'Browser proof runner/runtime unavailable; browser proof is not claimed from this static page.',
    'console errors',
    'caveats',
    'V6 Operator Approval Surface',
    'V6 approval status',
    'awaiting_operator_token',
    'exact-head approval token binds PR number plus current head SHA',
    'no UI merge claim',
    'V6 rejection status',
    'implemented_guarded',
    'V7–V8 planned_guarded',
  ]) {
    assert.equal(html.includes(value), true, `missing standalone Goal Dashboard value: ${value}`);
  }
});

test('Goal Dashboard publishes human-language cards and eight real view controls', () => {
  for (const view of ['overview', 'build-fronts', 'goals', 'missions', 'proof', 'runtime', 'history', 'approvals']) {
    assert.match(html, new RegExp(`role="tab" data-dashboard-view="${view}"`));
    assert.match(html, new RegExp(`data-dashboard-page="${view}"`));
  }
  for (const phrase of [
    'Some saved project records are old and need refreshing.',
    'What is in the way',
    'What happens next',
    'Technical details',
    'initializeDashboardNavigation()',
    "window.addEventListener('popstate'",
    'Missions',
    'outcomes above goals · canonical lineage only',
    'No mission records are published by the current feed.',
    'function renderMissions',
    'Mission → child goals',
    'System looking',
    'mission-looking-count',
    'mission-unwatched-count',
    'SYSTEM IS LOOKING AT THIS',
    'UNWATCHED · NO ACTIVE CONTROLLER SIGNAL',
    'Responsible owner',
    'Last evaluated',
    'Heartbeat / watcher',
    'Active lane / worker',
    'Most recent watcher',
    'Current activity',
    'Last material action',
    'Oldest evaluation',
    'Next intended action',
    'Proof freshness',
    'Recent mission events',
    'Awaiting decomposition',
    'function missionObservability',
    'dataset.systemLooking',
    'Decisions that genuinely need you',
    'Stephanos maintenance',
    'data-decision-action="APPROVE"',
    'data-decision-action="DENY"',
    '/api/operator-approvals/',
  ]) assert.equal(html.includes(phrase), true, `missing dashboard usability contract: ${phrase}`);
});


test('mission observability keeps proof mission-scoped and newest events first', () => {
  assert.equal(html.includes("ownerControllers.flatMap(item=>Array.isArray(item?.proofRefs)?item.proofRefs:[])"), false);
  assert.match(html, /mission\?\.proofRef/);
  assert.match(html, /lane\?\.proofRef/);
  assert.match(html, /missionTimestamp\(b\?\.timestampUtc\).*missionTimestamp\(a\?\.timestampUtc\)/);
  assert.match(html, /\.slice\(0,5\)/);
});
