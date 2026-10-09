import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const sourceUrl = new URL('./run-battle-bridge-recovery-mesh-guardian-hidden.ps1', import.meta.url);

test('recovery guardian does not narrow unsigned Windows task failures to signed Int32', async () => {
  const source = await readFile(sourceUrl, 'utf8');
  assert.match(source, /\$lastResult = if \(\$info\) \{ \[long\]\$info\.LastTaskResult \}/);
  assert.match(source, /\-and \[long\]\$postInfo\.LastTaskResult -eq 0/);
  assert.doesNotMatch(source, /\[int\]\$(?:info|postInfo)\.LastTaskResult/);
});

test('Windows task result 0x800710E0 exceeds signed Int32 and must stay a failure', () => {
  const taskResult = 0x800710E0;
  assert.equal(taskResult, 2147946720);
  assert.equal(taskResult > 2 ** 31 - 1, true);
  assert.notEqual(taskResult, 0);
});
