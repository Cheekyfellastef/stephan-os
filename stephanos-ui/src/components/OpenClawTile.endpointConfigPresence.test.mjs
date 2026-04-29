import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const tilePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'OpenClawTile.jsx');

test('OpenClawTile renders endpoint configuration controls and session-only safety notices', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  const requiredLabels = [
    'Endpoint Configuration (session-only v1)',
    'label input',
    'host input',
    'port input',
    'expected protocol input/select',
    'allowed probes select',
    'apply/update button',
    'reset/clear session config button',
    'session-only, no secrets stored',
    'no health check, no handshake, no connection, no live automation',
    'OpenClaw adapter config ready:',
    'OpenClaw adapter config next action:',
    'OpenClaw adapter config blocker:',
    'OpenClaw adapter config warning:',
  ];
  requiredLabels.forEach((label) => assert.equal(source.includes(label), true, `missing label: ${label}`));
});
