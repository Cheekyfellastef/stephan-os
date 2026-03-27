import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function read(filePath) {
  return fs.readFileSync(new URL(`../../${filePath}`, import.meta.url), 'utf8');
}

test('ai helper routes backend transport through shared backend client', () => {
  const source = read('shared/ai/stephanosClient.mjs');
  assert.match(source, /requestStephanosBackend\s*\(/);
  assert.doesNotMatch(source, /fetchImpl\s*\(\s*endpoint/);
});

test('validator backend probes route through shared backend client transport helper', () => {
  const source = read('system/apps/app_validator.js');
  assert.match(source, /requestStephanosBackendSafely/);
  assert.match(source, /path:\s*['"]\/api\/health['"]/);
  assert.match(source, /path:\s*['"]\/api\/ai\/providers\/health['"]/);
});

test('validator runtime-status probe targets launcher-root runtime-status route', () => {
  const validatorSource = read('system/apps/app_validator.js');
  const localUrlsSource = read('shared/runtime/stephanosLocalUrls.mjs');
  assert.match(validatorSource, /STEPHANOS_STATUS_URL\s*=\s*STEPHANOS_LOCAL_URLS\.runtimeStatusPath/);
  assert.match(localUrlsSource, /const RUNTIME_STATUS_PATH = '\/apps\/stephanos\/runtime-status\.json';/);
});

test('runtime probe no longer fetches backend health directly', () => {
  const source = read('shared/runtime/stephanosHomeNode.mjs');
  assert.match(source, /requestStephanosBackend\s*\(/);
  assert.doesNotMatch(source, /fetchImpl\(url/);
});

test('migrated frontend/runtime transport files avoid direct localhost:11434 usage', () => {
  const files = [
    'shared/ai/stephanosClient.mjs',
    'shared/runtime/backendClient.mjs',
    'shared/runtime/stephanosHomeNode.mjs',
    'system/apps/app_validator.js',
  ];

  for (const file of files) {
    assert.doesNotMatch(read(file), /localhost:11434/);
  }
});
