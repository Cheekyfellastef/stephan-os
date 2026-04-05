import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isLocalAdminRequest } from '../routes/ai-admin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const routeSource = fs.readFileSync(path.join(__dirname, '../routes/local-shell.js'), 'utf8');

function buildRequest({ ip = '127.0.0.1', origin = 'http://localhost:4173', host = 'localhost:8787' } = {}) {
  return {
    headers: { origin, host },
    socket: { remoteAddress: ip },
    ip,
  };
}

test('local-shell route guard denies hosted runtime requests', () => {
  const allowed = isLocalAdminRequest(buildRequest({ origin: 'https://cheekyfellastef.github.io' }));
  assert.equal(allowed, false);
});

test('local-shell route guard allows loopback desktop runtime requests', () => {
  const allowed = isLocalAdminRequest(buildRequest());
  assert.equal(allowed, true);
});

test('local-shell router exposes read-only git ritual state endpoint behind local runtime guard', () => {
  assert.match(routeSource, /router\.get\('\/git-ritual-state',\s*requireLocalDesktopRuntime/);
  assert.match(routeSource, /inspectLocalGitRitualState\(\)/);
});
