import test from 'node:test';
import assert from 'node:assert/strict';

import {
  dispatchPersistentRuntimeRepair,
  SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_SCHEMA,
} from './sovereign-commander-persistent-runtime-repair.mjs';

const HEAD = 'a'.repeat(40);

function successSpawn(expectedTarget) {
  return (_exe, args) => {
    assert.equal(args[0], '-NoLogo');
    const encoded = args.at(-1);
    const source = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.match(source, /Start-ScheduledTask/);
    assert.match(source, /RunLevel/);
    assert.match(source, /wscript\.exe/);
    assert.match(source, new RegExp(expectedTarget === 'backend'
      ? 'Stephanos Battle Bridge Backend'
      : 'Stephanos Battle Bridge Frontend'));
    assert.ok(source.includes(' ' + expectedTarget));
    return {
      status: 0,
      stdout: JSON.stringify({
        ok: true,
        taskName: expectedTarget === 'backend'
          ? 'Stephanos Battle Bridge Backend'
          : 'Stephanos Battle Bridge Frontend',
        stateBefore: 'Ready',
        dispatchAttempted: true,
      }),
      stderr: '',
    };
  };
}

test('backend dispatch uses only the fixed persistent task and preserves authority boundaries', () => {
  let sourceReads = 0;
  const result = dispatchPersistentRuntimeRepair({
    target: 'backend',
    expectedHead: HEAD,
    repoRoot: 'C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os',
    sourceHeadFn: () => { sourceReads++; return HEAD; },
    spawnSyncFn: successSpawn('backend'),
  });
  assert.equal(result.schemaVersion, SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_SCHEMA);
  assert.equal(result.ok, true);
  assert.equal(result.target, 'backend');
  assert.equal(result.dispatchAttempted, true);
  assert.equal(result.taskDefinitionChanged, false);
  assert.equal(result.sourceMutationAllowed, false);
  assert.equal(result.arbitraryShellAllowed, false);
  assert.equal(result.mergeAuthority, false);
  assert.equal(result.pcRestartAllowed, false);
  assert.equal(sourceReads, 2);
});

test('frontend dispatch validates the fixed S4U task before starting it', () => {
  const result = dispatchPersistentRuntimeRepair({
    target: 'frontend',
    expectedHead: HEAD,
    sourceHeadFn: () => HEAD,
    spawnSyncFn: (_exe, args) => {
      const source = Buffer.from(args.at(-1), 'base64').toString('utf16le');
      assert.match(source, /LogonType/);
      assert.match(source, /S4U/);
      return {
        status: 0,
        stdout: JSON.stringify({
          ok: true,
          taskName: 'Stephanos Battle Bridge Frontend',
          stateBefore: 'Ready',
          dispatchAttempted: true,
        }),
        stderr: '',
      };
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.target, 'frontend');
  assert.equal(result.finalVerdict, 'SOVEREIGN_PERSISTENT_RUNTIME_REPAIR_DISPATCHED');
});

test('source movement blocks dispatch before PowerShell is invoked', () => {
  let spawned = false;
  const result = dispatchPersistentRuntimeRepair({
    target: 'backend',
    expectedHead: HEAD,
    sourceHeadFn: () => 'b'.repeat(40),
    spawnSyncFn: () => { spawned = true; return {}; },
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PERSISTENT_RUNTIME_REPAIR_SOURCE_CHANGED');
  assert.equal(spawned, false);
});

test('source movement after Task Scheduler handoff fails closed', () => {
  let reads = 0;
  const result = dispatchPersistentRuntimeRepair({
    target: 'backend',
    expectedHead: HEAD,
    sourceHeadFn: () => (++reads === 1 ? HEAD : 'b'.repeat(40)),
    spawnSyncFn: successSpawn('backend'),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PERSISTENT_RUNTIME_REPAIR_SOURCE_CHANGED');
  assert.equal(result.dispatchAttempted, true);
  assert.equal(result.pcRestartAllowed, false);
});

test('unproven scheduled task execution never becomes success', () => {
  const result = dispatchPersistentRuntimeRepair({
    target: 'frontend',
    expectedHead: HEAD,
    sourceHeadFn: () => HEAD,
    spawnSyncFn: () => ({ status: 1, stdout: '', stderr: 'PERSISTENT_RUNTIME_TASK_ARGUMENTS_CHANGED\n' }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'PERSISTENT_RUNTIME_TASK_ARGUMENTS_CHANGED');
  assert.equal(result.dispatchAttempted, false);
});

test('unknown target and invalid source identity are rejected', () => {
  assert.equal(dispatchPersistentRuntimeRepair({
    target: 'other', expectedHead: HEAD,
  }).blocker, 'PERSISTENT_RUNTIME_REPAIR_TARGET_NOT_ALLOWED');
  assert.equal(dispatchPersistentRuntimeRepair({
    target: 'backend', expectedHead: 'not-a-sha',
  }).blocker, 'PERSISTENT_RUNTIME_REPAIR_EXPECTED_HEAD_REQUIRED');
});
