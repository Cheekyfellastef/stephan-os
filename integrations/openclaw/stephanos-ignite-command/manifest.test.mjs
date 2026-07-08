import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('declares read-only startup plugin with bounded loopback config', async () => {
  const manifest = await readJson('openclaw.plugin.json');
  assert.equal(manifest.id, 'stephanos-ignite-command');
  assert.equal(manifest.activation.onStartup, true);
  assert.equal(manifest.configSchema.additionalProperties, false);
  assert.equal(manifest.configSchema.properties.openclawHealthEndpoint.default, 'http://127.0.0.1:8790/health');
  assert.equal(manifest.configSchema.properties.stephanosHealthEndpoint.default, 'http://127.0.0.1:8787/api/health');
});

test('registers authenticated command and no tools or shell execution', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8');
  const router = await readFile(new URL('lib/router.mjs', root), 'utf8');
  const combined = `${source}\n${router}`;
  assert.match(source, /name:\s*'stephanos-ignite'/);
  assert.match(source, /acceptsArgs:\s*true/);
  assert.match(source, /requireAuth:\s*true/);
  assert.doesNotMatch(combined, /registerTool\s*\(/);
  assert.doesNotMatch(combined, /child_process|spawn\s*\(|execFile\s*\(|exec\s*\(|powershell|pwsh|git\s+reset|process\.env/);
});
