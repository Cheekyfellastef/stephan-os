import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

test('fileURLToPath normalization keeps Windows file URL paths portable for render harness resolution', () => {
  const fakeWindowsFileUrl = new URL('file:///C:/Users/Stephan%20Callear/Documents/GitHub/stephan-os/stephanos-ui/src/test/renderHarness.mjs');
  const normalizedFilePath = fileURLToPath(fakeWindowsFileUrl);
  const repoRoot = path.win32.resolve(path.win32.dirname(normalizedFilePath), '../../..');

  assert.doesNotMatch(normalizedFilePath, /%20/);
  assert.match(normalizedFilePath, /Stephan Callear/);
  assert.match(repoRoot, /^\\?C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os$/i);
  assert.doesNotMatch(repoRoot, /^C:\\C:\\/i);
});
