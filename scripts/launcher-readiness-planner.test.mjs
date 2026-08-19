import test from 'node:test';
import assert from 'node:assert/strict';
import { planLauncherReadiness, isAllowedLauncherStartCommand } from './launcher-readiness-planner.mjs';

const allReady = { backend: true, 'stephanos-ui': true, 'openclaw-gateway': true, 'shared-workspace': true };

test('all services ready returns ready', () => {
  assert.equal(planLauncherReadiness({ observedFacts: { services: allReady } }).finalVerdict, 'ready');
});

test('backend 8787 only plus missing UI 4173 returns partial-ui-missing', () => {
  const plan = planLauncherReadiness({ observedFacts: { services: { backend: true, 'openclaw-gateway': true, 'shared-workspace': true } } });
  assert.equal(plan.finalVerdict, 'partial-ui-missing');
  assert.deepEqual(plan.missingServices, ['stephanos-ui']);
});

test('stale shared workspace records block ready', () => {
  const plan = planLauncherReadiness({ observedFacts: { services: allReady, staleWorkspaceRecords: ['current/status UNKNOWN'] } });
  assert.equal(plan.finalVerdict, 'stale-workspace');
  assert.equal(plan.safetyBlockers[0].id, 'stale-workspace-records');
});

test('missing OpenClaw gateway returns partial-openclaw-missing', () => {
  const plan = planLauncherReadiness({ observedFacts: { services: { backend: true, 'stephanos-ui': true, 'shared-workspace': true } } });
  assert.equal(plan.finalVerdict, 'partial-openclaw-missing');
});

test('dirty source blocks launcher repair', () => {
  const plan = planLauncherReadiness({ observedFacts: { services: allReady }, sourceFacts: { dirtyPaths: ['scripts/source.mjs'] } });
  assert.equal(plan.finalVerdict, 'blocked-dirty-source');
});

test('runtime-only dirt is caveat, not source blocker', () => {
  const plan = planLauncherReadiness({ observedFacts: { services: allReady }, sourceFacts: { dirtyPaths: ['runtime-activity/events.jsonl'] } });
  assert.equal(plan.finalVerdict, 'ready');
  assert.equal(plan.caveats[0].id, 'runtime-only-dirt');
});

test('status-aware readiness accepts only the exact unstaged durable-memory runtime write', () => {
  const allowed = planLauncherReadiness({
    observedFacts: { services: allReady },
    sourceFacts: {
      statusLines: [' M stephanos-server/data/memory/durable-memory.json'],
      dirtyPaths: ['stephanos-server/data/memory/durable-memory.json'],
    },
  });
  assert.equal(allowed.finalVerdict, 'ready');
  assert.deepEqual(allowed.safetyBlockers, []);
  assert.deepEqual(allowed.caveats[0].paths, ['stephanos-server/data/memory/durable-memory.json']);

  for (const statusLine of [
    'M  stephanos-server/data/memory/durable-memory.json',
    ' D stephanos-server/data/memory/durable-memory.json',
    '?? stephanos-server/data/memory/durable-memory.json',
  ]) {
    const blocked = planLauncherReadiness({
      observedFacts: { services: allReady },
      sourceFacts: {
        statusLines: [statusLine],
        dirtyPaths: ['stephanos-server/data/memory/durable-memory.json'],
      },
    });
    assert.equal(blocked.finalVerdict, 'blocked-dirty-source', statusLine);
    assert.equal(blocked.safetyBlockers[0].id, 'dirty-source');
  }
});

test('path-only durable-memory evidence stays fail closed because status qualification is missing', () => {
  const plan = planLauncherReadiness({
    observedFacts: { services: allReady },
    sourceFacts: { dirtyPaths: ['stephanos-server/data/memory/durable-memory.json'] },
  });
  assert.equal(plan.finalVerdict, 'blocked-dirty-source');
  assert.deepEqual(plan.safetyBlockers[0].paths, ['stephanos-server/data/memory/durable-memory.json']);
});

test('generated dist deletion is runtime build churn rather than source dirt', () => {
  const plan = planLauncherReadiness({
    observedFacts: { services: allReady },
    sourceFacts: {
      statusLines: [' D apps/stephanos/dist/assets/index-oldhash.js'],
      dirtyPaths: ['apps/stephanos/dist/assets/index-oldhash.js'],
    },
  });
  assert.equal(plan.finalVerdict, 'ready');
  assert.deepEqual(plan.safetyBlockers, []);
  assert.deepEqual(plan.caveats[0].paths, ['apps/stephanos/dist/assets/index-oldhash.js']);
});

test('status-aware runtime dirt cannot hide an ordinary tracked source modification', () => {
  const plan = planLauncherReadiness({
    observedFacts: { services: allReady },
    sourceFacts: {
      statusLines: [
        ' M stephanos-server/data/memory/durable-memory.json',
        ' M scripts/source.mjs',
      ],
      dirtyPaths: [
        'stephanos-server/data/memory/durable-memory.json',
        'scripts/source.mjs',
      ],
    },
  });
  assert.equal(plan.finalVerdict, 'blocked-dirty-source');
  assert.deepEqual(plan.safetyBlockers[0].paths, ['scripts/source.mjs']);
});

test('unsafe launcher command is rejected', () => {
  const plan = planLauncherReadiness({ observedFacts: { services: allReady }, requestedStartCommand: 'rm -rf /' });
  assert.equal(isAllowedLauncherStartCommand('rm -rf /'), false);
  assert.equal(plan.finalVerdict, 'blocked-unsafe-launcher-command');
});

test('allowed start commands are descriptive only and not executed', () => {
  const plan = planLauncherReadiness({ launcherConfigFacts: { launcherMode: 'launcher-root', bootMode: 'cockpit' }, observedFacts: { services: allReady } });
  assert.ok(plan.allowedStartCommands.includes('powershell.exe -ExecutionPolicy Bypass -File .\\windows\\Launch-Stephanos-Local.ps1 -Mode launcher-root -BootMode cockpit'));
  assert.equal(plan.forbiddenActions.includes('start-services-during-readiness-planning'), true);
});

test('no kill/process mutation/merge/push authority is exposed', () => {
  const plan = planLauncherReadiness({ observedFacts: { services: allReady } });
  assert.ok(plan.forbiddenActions.includes('kill-processes'));
  assert.ok(plan.forbiddenActions.includes('mutate-runtime-files'));
  assert.ok(plan.forbiddenActions.includes('pull-merge-push'));
});
