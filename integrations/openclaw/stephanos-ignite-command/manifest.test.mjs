import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('declares the canonical stephanos ignite OpenClaw plugin id', async () => {
  const manifest = await readJson('openclaw.plugin.json');
  assert.equal(manifest.id, 'stephanos-ignite-command');
  assert.equal(manifest.activation.onStartup, true);
  assert.equal(manifest.configSchema.additionalProperties, false);
});

test('loads the JavaScript command entry directly', async () => {
  const packageJson = await readJson('package.json');
  assert.deepEqual(packageJson.openclaw.extensions, ['./index.js']);
  assert.equal(packageJson.type, 'module');
  const source = await readFile(new URL('index.js', root), 'utf8');
  assert.match(source, /definePluginEntry/);
});

test('registers one authenticated ignite command with no general tool or agent authority', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8');
  assert.match(source, /name:\s*'stephanos-ignite'/);
  assert.match(source, /acceptsArgs:\s*true/);
  assert.match(source, /requireAuth:\s*true/);
  assert.match(source, /authenticatedContext:\s*\{ authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' \}/);
  assert.doesNotMatch(source, /registerTool\s*\(/);
  assert.doesNotMatch(source, /continueAgent:\s*true/);
  assert.doesNotMatch(source, /registerTool|openclaw\s+doctor|codex|merge|push|install/);
});
