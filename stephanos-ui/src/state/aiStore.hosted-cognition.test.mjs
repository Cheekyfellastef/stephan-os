import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const THIS_DIR = path.dirname(new URL(import.meta.url).pathname);
const source = fs.readFileSync(path.join(THIS_DIR, 'aiStore.js'), 'utf8');

test('hosted cognition save state includes unsaved/saved/save-failed and restored diagnostics', () => {
  assert.match(source, /state:\s*'unsaved'/);
  assert.match(source, /state:\s*'saved'/);
  assert.match(source, /state:\s*'save-failed'/);
  assert.match(source, /\?\s*'restored'\s*:\s*'idle'/);
  assert.match(source, /restoredFromSession/);
  assert.match(source, /providerProxyUrls/);
  assert.match(source, /hydrationFailure/);
  assert.match(source, /failed to hydrate executable Worker URL/);
  assert.match(source, /hostedCloudCognition:\s*savedHostedCloudCognition/);
});
