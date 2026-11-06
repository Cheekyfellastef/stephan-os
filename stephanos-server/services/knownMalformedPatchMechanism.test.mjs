// The existing escrow node-changed profile discovers .test.mjs files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { inspectStructuredNewFileContractV1 } from './providerNeutralSourceBuilderService.js';

test('loaded new-file inspector exercises the real validator and empty-context model schema', () => {
  assert.deepEqual(inspectStructuredNewFileContractV1().observations, {
    acceptsEmptySnapshotNewFile: true,
    rejectsInventedOldContents: true,
    rejectsEmptyOldForExistingFile: true,
    rejectsOutOfScope: true,
    rejectsTraversal: true,
    rejectsEmptyNewFile: true,
    modelRequestAcceptsStructuredEditsWithoutSnapshots: true,
  });
});

test('inspection binds the module source and returns only immutable mechanism observations', async () => {
  const source = await readFile(new URL('./providerNeutralSourceBuilderService.js', import.meta.url));
  const result = inspectStructuredNewFileContractV1();
  assert.equal(result.schemaVersion, 'stephanos.structured-new-file-contract.v1');
  assert.equal(result.loadedSourceSha256, createHash('sha256').update(source).digest('hex'));
  assert.deepEqual(Object.keys(result).sort(), ['loadedSourceSha256', 'observations', 'schemaVersion']);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.observations), true);
  assert.throws(() => { result.observations.acceptsEmptySnapshotNewFile = false; }, TypeError);
  assert.deepEqual(inspectStructuredNewFileContractV1(), result);
});

test('inspection rejects caller-selected edits, paths, proof flags and providers', () => {
  for (const input of [undefined, {}, { verified: true }, { path: '../outside' },
    { edits: [{ path: 'shared/agents/lessonMemoryStore.mjs', old: '', new: 'changed' }] },
    { generatePatch: () => { throw new Error('must not run'); } }]) {
    assert.throws(() => inspectStructuredNewFileContractV1(input),
      { name: 'TypeError', message: 'STRUCTURED_NEW_FILE_INSPECTION_TAKES_NO_INPUT' });
  }
});

test('inspection does not invoke the configured network provider', () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error('network forbidden in inspection'); };
  try {
    assert.equal(inspectStructuredNewFileContractV1().observations.acceptsEmptySnapshotNewFile, true);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
