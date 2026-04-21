import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('backendClient + stephanosHomeNode startup import path initializes without TDZ/circular-init crash', async () => {
  const cacheBust = Date.now();
  const backendClientModuleUrl = new URL(`./backendClient.mjs?startup-init=${cacheBust}`, import.meta.url);
  const homeNodeModuleUrl = new URL(`./stephanosHomeNode.mjs?startup-init=${cacheBust}`, import.meta.url);

  const [backendClient, stephanosHomeNode] = await Promise.all([
    import(backendClientModuleUrl.href),
    import(homeNodeModuleUrl.href),
  ]);

  assert.equal(typeof backendClient.requestStephanosBackend, 'function');
  assert.equal(typeof stephanosHomeNode.probeStephanosHomeNode, 'function');
  assert.equal(typeof stephanosHomeNode.resolveStephanosBackendBaseUrl, 'function');
});

test('stephanosHomeNode avoids backendClient import-cycle reintroduction', async () => {
  const sourcePath = new URL('./stephanosHomeNode.mjs', import.meta.url);
  const source = await readFile(sourcePath, 'utf8');

  assert.equal(
    source.includes("from './backendClient.mjs'"),
    false,
    'stephanosHomeNode must not import backendClient directly; this reintroduces startup circular-init risk',
  );
});
