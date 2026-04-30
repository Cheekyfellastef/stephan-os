import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./openclaw-readonly-adapter-stub.mjs', import.meta.url));
const statusScript = fileURLToPath(new URL('./openclaw-readonly-adapter-status.mjs', import.meta.url));

async function waitForReady(proc) {
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout waiting for stub startup')), 5000);
    proc.stdout.on('data', (chunk) => {
      if (String(chunk).includes('listening on')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    proc.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`stub exited early (${code})`));
    });
  });
}

test('stub health and handshake are available and readonly-only', async (t) => {
  const port = 18790;
  const proc = spawn(process.execPath, [script], { env: { ...process.env, OPENCLAW_STUB_HOST: '127.0.0.1', OPENCLAW_STUB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill('SIGTERM'));
  await waitForReady(proc);

  const healthResponse = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.state, 'available');
  assert.equal(health.executionAllowed, false);

  const handshakeResponse = await fetch(`http://127.0.0.1:${port}/handshake`);
  assert.equal(handshakeResponse.status, 200);
  const handshake = await handshakeResponse.json();
  assert.equal(handshake.compatible, true);
  assert.equal(handshake.readonlyAssurance.executionDisabled, true);
  assert.equal(handshake.capabilityDeclaration.canExecuteActions, false);
  assert.equal(handshake.capabilityDeclaration.canRunCommands, false);
  assert.equal(handshake.capabilityDeclaration.canEditFiles, false);
  assert.equal(handshake.capabilityDeclaration.canWriteGit, false);
  assert.equal(handshake.capabilityDeclaration.canControlBrowser, false);
});

test('stub refuses non-loopback host exposure', async () => {
  const proc = spawn(process.execPath, [script], { env: { ...process.env, OPENCLAW_STUB_HOST: '0.0.0.0', OPENCLAW_STUB_PORT: '18791' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const code = await new Promise((resolve) => proc.once('exit', resolve));
  assert.equal(code, 1);
});

test('stub exposes no command/file/git/browser endpoints and status script tracks availability', async (t) => {
  const port = 18792;
  const statusDown = spawn(process.execPath, [statusScript], { env: { ...process.env, OPENCLAW_STUB_HOST: '127.0.0.1', OPENCLAW_STUB_PORT: String(port) } });
  const downCode = await new Promise((resolve) => statusDown.once('exit', resolve));
  assert.equal(downCode, 1);

  const proc = spawn(process.execPath, [script], { env: { ...process.env, OPENCLAW_STUB_HOST: '127.0.0.1', OPENCLAW_STUB_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => proc.kill('SIGTERM'));
  await waitForReady(proc);

  for (const path of ['/command', '/execute', '/files', '/git', '/browser']) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method: 'GET' });
    assert.equal(response.status, 404);
  }

  const statusUp = spawn(process.execPath, [statusScript], { env: { ...process.env, OPENCLAW_STUB_HOST: '127.0.0.1', OPENCLAW_STUB_PORT: String(port) } });
  const upCode = await new Promise((resolve) => statusUp.once('exit', resolve));
  assert.equal(upCode, 0);
});
