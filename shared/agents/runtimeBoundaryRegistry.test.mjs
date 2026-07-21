import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import {
  RUNTIME_BOUNDARY_CLASSIFICATIONS,
  classifyRepositoryDirt,
  defaultOpenClawWorkspaceRoot,
  defaultRuntimeRoot,
  findRegistryEntryForRepoPath,
  getRuntimePath,
  registryAsSerializableObject,
} from './runtimeBoundaryRegistry.mjs';

test('runtime roots honour explicit configuration', () => {
  const env = {
    STEPHANOS_RUNTIME_ROOT: '/tmp/stephanos-runtime',
    STEPHANOS_OPENCLAW_WORKSPACE: '/tmp/openclaw-workspace',
  };
  assert.equal(defaultRuntimeRoot({ env, homeDir: '/ignored' }), path.resolve('/tmp/stephanos-runtime'));
  assert.equal(defaultOpenClawWorkspaceRoot({ env, homeDir: '/ignored' }), path.resolve('/tmp/openclaw-workspace'));
});

test('runtime path adapter resolves approved keys beneath their authoritative roots', () => {
  const env = {
    STEPHANOS_RUNTIME_ROOT: '/tmp/stephanos-runtime',
    STEPHANOS_OPENCLAW_WORKSPACE: '/tmp/openclaw-workspace',
  };
  assert.equal(getRuntimePath('dreams', { env }), path.resolve('/tmp/openclaw-workspace/memory'));
  assert.equal(getRuntimePath('receipts', { env }), path.resolve('/tmp/stephanos-runtime/receipts'));
  assert.throws(() => getRuntimePath('unknown', { env }), /Unknown runtime path key/);
});

test('legacy paths map to registry entries', () => {
  assert.equal(findRegistryEntryForRepoPath('memory/.dreams/latest.json').key, 'dreams');
  assert.equal(findRegistryEntryForRepoPath('apps/stephanos/dist/index.html').key, 'uiBuildStaging');
  assert.equal(findRegistryEntryForRepoPath('src/index.mjs'), null);
});

test('clean repository is source clean', () => {
  const result = classifyRepositoryDirt([]);
  assert.equal(result.classification, RUNTIME_BOUNDARY_CLASSIFICATIONS.SOURCE_CLEAN);
  assert.equal(result.blocksSync, false);
});

test('known runtime dirt is attributed but not mistaken for source', () => {
  const result = classifyRepositoryDirt([' M apps/stephanos/dist/index.html', '?? memory/.dreams/latest.json']);
  assert.equal(result.classification, RUNTIME_BOUNDARY_CLASSIFICATIONS.KNOWN_REGENERABLE_RUNTIME_DIRT);
  assert.equal(result.knownRuntime.length, 2);
  assert.equal(result.blocksSync, false);
});

test('unpublished source blocks', () => {
  const result = classifyRepositoryDirt([' M shared/agents/runtimeBoundaryRegistry.mjs']);
  assert.equal(result.classification, RUNTIME_BOUNDARY_CLASSIFICATIONS.BLOCKED_UNPUBLISHED_SOURCE);
  assert.equal(result.blocksSync, true);
});

test('malformed status fails closed', () => {
  const result = classifyRepositoryDirt(['bad']);
  assert.equal(result.classification, RUNTIME_BOUNDARY_CLASSIFICATIONS.BLOCKED_UNKNOWN_DIRT);
  assert.equal(result.blocksSync, true);
});

test('serializable registry exposes both approved roots and resolved destinations', () => {
  const registry = registryAsSerializableObject({
    env: {
      STEPHANOS_RUNTIME_ROOT: '/tmp/runtime',
      STEPHANOS_OPENCLAW_WORKSPACE: '/tmp/openclaw',
    },
  });
  assert.equal(registry.unknownPathsFailClosed, true);
  assert.match(registry.entries.receipts.resolvedExternalPath, /receipts$/);
  assert.match(registry.entries.dreams.resolvedExternalPath, /openclaw[\\/]memory$/);
});
