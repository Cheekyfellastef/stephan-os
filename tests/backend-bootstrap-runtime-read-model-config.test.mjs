import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../stephanos-server/backend-bootstrap.mjs', import.meta.url), 'utf8');

test('process-bound backend restores canonical dashboard read-model configuration before server import', () => {
  const configCall = source.indexOf('if (bootstrapIsProcessBound) configureCanonicalRuntimeReadModels();');
  const serverImport = source.lastIndexOf("await import(pathToFileURL(resolve(canonicalRepoRoot, 'stephanos-server', 'server.js')).href);");

  assert.notEqual(configCall, -1);
  assert.notEqual(serverImport, -1);
  assert.ok(configCall < serverImport, 'runtime read-model configuration must be restored before server import');

  assert.match(source, /const canonicalGithubRepository = 'Cheekyfellastef\/stephan-os';/);
  assert.match(source, /process\.env\.STEPHANOS_SHARED_AGENT_WORKSPACE = resolve\(join\(userHome, 'Documents', 'Stephanos-openclaw-workspace'\)\);/);
  assert.match(source, /process\.env\.STEPHANOS_GITHUB_REPOSITORY = canonicalGithubRepository;/);
});

test('runtime read-model restoration preserves explicit bounded configuration when already present', () => {
  assert.match(source, /if \(!String\(process\.env\.STEPHANOS_SHARED_AGENT_WORKSPACE \|\| ''\)\.trim\(\) && userHome\)/);
  assert.match(source, /if \(!String\(process\.env\.STEPHANOS_GITHUB_REPOSITORY \|\| ''\)\.trim\(\)\)/);
});
