import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyUpdateDirt, compareUpdateDirt } from './stephanosUpdateDirt.mjs';

test('shared update dirt classifier separates approved runtime dirt from all source dirt', () => {
  const result = classifyUpdateDirt([
    ' M apps/stephanos/dist/index.html',
    ' M stephanos-server/data/memory/durable-memory.json',
    '?? shared/agents/new-source.mjs',
    ' M integrations/openclaw/stephanos-ignite-command/index.js',
  ].join('\n'));
  assert.deepEqual(result.runtime, [
    'apps/stephanos/dist/index.html',
    'stephanos-server/data/memory/durable-memory.json',
  ]);
  assert.deepEqual(result.source, [
    'shared/agents/new-source.mjs',
    'integrations/openclaw/stephanos-ignite-command/index.js',
  ]);
});

test('shared update dirt delta compares status plus path without losing runtime truth', () => {
  const before = classifyUpdateDirt(' M apps/stephanos/dist/index.html\n');
  const after = classifyUpdateDirt('?? apps/stephanos/dist/index.html\n');
  const delta = compareUpdateDirt(before, after);
  assert.equal(delta.sourceMutationDetected, false);
  assert.equal(delta.runtimeMutationDetected, true);
});

test('shared update dirt classifier fails closed when either rename endpoint is source-owned', () => {
  const sourceToRuntime = classifyUpdateDirt('R  shared/source.mjs -> apps/stephanos/dist/source.mjs\n');
  assert.deepEqual(sourceToRuntime.runtime, []);
  assert.deepEqual(sourceToRuntime.source, ['shared/source.mjs']);

  const runtimeToSource = classifyUpdateDirt('R  apps/stephanos/dist/source.mjs -> shared/source.mjs\n');
  assert.deepEqual(runtimeToSource.runtime, []);
  assert.deepEqual(runtimeToSource.source, ['shared/source.mjs']);

  const runtimeToRuntime = classifyUpdateDirt('R  apps/stephanos/dist/old.js -> apps/stephanos/dist/new.js\n');
  assert.deepEqual(runtimeToRuntime.runtime, [
    'apps/stephanos/dist/old.js',
    'apps/stephanos/dist/new.js',
  ]);
  assert.deepEqual(runtimeToRuntime.source, []);
});

test('shared update dirt classifier keeps quoted rename endpoints in the source decision', () => {
  const result = classifyUpdateDirt('R  "shared/old file.mjs" -> "apps/stephanos/dist/new file.mjs"\n');
  assert.deepEqual(result.runtime, []);
  assert.deepEqual(result.source, ['shared/old file.mjs']);
});

test('shared update dirt classifier allows only explicit runtime/dependency prefixes and blocks unknown or secret-shaped dirt', () => {
  const result = classifyUpdateDirt([
    '!! node_modules/',
    '!! stephanos-server/node_modules/',
    '?? logs/ignition.json',
    '?? data/activity/events.json',
    '?? data/knowledge-graph/current.json',
    '?? apps/stephanos/dist/index.html',
    '!! data/random.txt',
    '!! data/unknown.bin',
    '!! data/activity/private-key.txt',
    '!! unknown-cache/',
  ].join('\n'));
  assert.deepEqual(result.runtime, [
    'node_modules/',
    'stephanos-server/node_modules/',
    'logs/ignition.json',
    'data/activity/events.json',
    'data/knowledge-graph/current.json',
    'apps/stephanos/dist/index.html',
  ]);
  assert.deepEqual(result.source, [
    'data/random.txt',
    'data/unknown.bin',
    'data/activity/private-key.txt',
    'unknown-cache/',
  ]);
});
