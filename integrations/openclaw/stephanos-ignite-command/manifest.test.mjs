import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('./', import.meta.url);

const FORBIDDEN_GENERAL_AUTHORITY_PATTERNS = Object.freeze([
  /registerTool\s*\(/,
  /continueAgent\s*:\s*true/,
  /\bopenclaw\s+doctor\b/i,
  /\bcodex\b/i,
  /from\s+['"]node:child_process['"]/,
  /\b(?:exec|execFile|spawn|fork)(?:Sync)?\s*\(/,
  /['"`]\s*git(?:\.exe)?\s+(?:merge|push)\b/i,
  /['"`]\s*(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:install|add)\b/i,
]);

function assertNoGeneralAuthority(source) {
  for (const pattern of FORBIDDEN_GENERAL_AUTHORITY_PATTERNS) {
    assert.doesNotMatch(source, pattern);
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(new URL(path, root), 'utf8'));
}

test('declares the canonical stephanos ignite OpenClaw plugin id', async () => {
  const manifest = await readJson('openclaw.plugin.json');
  assert.equal(manifest.id, 'stephanos-ignite-command');
  assert.equal(manifest.activation.onStartup, true);
  assert.equal(manifest.configSchema.additionalProperties, false);
  assert.match(manifest.description, /owner-gated in-memory exact-head main update route/i);
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
  const handler = await readFile(new URL('lib/command-handler.mjs', root), 'utf8');
  const ownerLane = await readFile(new URL('lib/recovery-update.mjs', root), 'utf8');
  assert.match(ownerLane, /name:\s*'stephanos-ignite'/);
  assert.match(ownerLane, /acceptsArgs:\s*true/);
  assert.match(ownerLane, /requireAuth:\s*true/);
  assert.match(ownerLane, /OWNER_HANDLER_CAPABILITY/);
  assert.doesNotMatch(ownerLane, /export\s+(?:async\s+)?function\s+runBattleBridgeExactHeadFromOpenClawOwnerHandler/);
  assert.match(handler, /authenticatedContext:\s*\{ authenticatedByHost: true, commandName: 'stephanos-ignite', command: 'wake' \}/);
  assert.match(handler, /const result = await queueUpdateFn/);
  assert.equal(ownerLane.match(/api\.registerCommand\s*\(/g)?.length, 1);
  assertNoGeneralAuthority(source);
  assertNoGeneralAuthority(handler);
});

test('authority guard rejects executable authority without rejecting inert install status truth', () => {
  assert.doesNotThrow(() => assertNoGeneralAuthority("const sourceInstalled = result.sourceInstalled; lines.push('SOURCE_INSTALLED=true');"));
  for (const unsafe of [
    'api.registerTool({ name: "shell" });',
    'const route = { continueAgent: true };',
    'run("openclaw doctor");',
    'run("codex");',
    'import { spawn } from "node:child_process"; spawn("cmd.exe");',
    'execFile("git.exe", ["merge", "--ff-only", head]);',
    'run("git push origin main");',
    'run("npm install unsafe-package");',
  ]) {
    assert.throws(() => assertNoGeneralAuthority(unsafe), assert.AssertionError);
  }
});
