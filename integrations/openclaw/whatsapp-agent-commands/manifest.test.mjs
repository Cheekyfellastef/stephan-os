import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('declares a startup plugin with no mutation contracts', async () => {
  const manifest = await readJson('openclaw.plugin.json');
  assert.equal(manifest.id, 'stephanos-whatsapp-agent-commands');
  assert.equal(manifest.activation.onStartup, true);
  assert.equal(manifest.contracts, undefined);
  assert.equal(manifest.configSchema.additionalProperties, false);
});

test('loads the JavaScript command entry directly', async () => {
  const packageJson = await readJson('package.json');
  assert.deepEqual(packageJson.openclaw.extensions, ['./index.js']);
  assert.equal(packageJson.type, 'module');
});

test('registers three authenticated argument commands and no tools', async () => {
  const source = await readFile(new URL('index.js', root), 'utf8');
  const contract = await readFile(new URL('lib/agent-command-contract.mjs', root), 'utf8');
  assert.match(contract, /command:\s*'standalone'/);
  assert.match(contract, /command:\s*'scout-coder'/);
  assert.match(contract, /command:\s*'scout_coder'/);
  assert.match(contract, /targetAgentId:\s*'standalone'/);
  assert.match(contract, /targetAgentId:\s*'stephanos-scout-coder'/);
  assert.match(source, /acceptsArgs:\s*true/);
  assert.match(source, /requireAuth:\s*true/);
  assert.doesNotMatch(source, /continueAgent:\s*true/);
  assert.doesNotMatch(source, /registerTool\s*\(/);
  assert.doesNotMatch(source, /registerCommand\s*\(\s*{\s*name:\s*'stephanos'/s);
});
