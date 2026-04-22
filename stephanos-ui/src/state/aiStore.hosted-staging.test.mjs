import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname);
const source = fs.readFileSync(path.join(THIS_DIR, 'aiStore.js'), 'utf8');

test('aiStore exposes hosted staging queue and explicit promotion actions', () => {
  assert.match(source, /hostedIdeaStagingQueue/);
  assert.match(source, /addHostedStagedItem/);
  assert.match(source, /promoteHostedStagedItem/);
  assert.match(source, /localAuthorityAvailable = runtimeStatusModel\?\.runtimeContext\?\.capabilityPosture\?\.localAuthorityAvailable === true/);
});
