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


test('OpenClawTile shows safe readonly validation endpoint availability and operator-facing endpoint metadata', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  const requiredLabels = [
    'Validation endpoint:',
    'Validation endpoint path:',
    'Validation endpoint mode:',
    'Re-check readonly health/handshake',
    'Readonly adapter validated. OpenClaw can be observed and assessed. Execution remains disabled.',
    'Validation unavailable: missing safe readonly validation endpoint or config readiness',
    'OpenClaw Capability Trial',
    'Run readonly capability trial',
    'Forbidden actions:',
    'Control Plane Safety Lifecycle',
    'Engage Kill Switch',
    'Pause OpenClaw control plane',
    'Resume readonly validation/control plane',
    'Execution allowed:',
    'OpenClaw Oversight Proposal',
    'Self-modification allowed:',
    'Required oversight layers:',
    'Proposed next controls:',
    'Forbidden self-actions:',
    'OpenClaw can help design oversight, but cannot approve or apply its own power increase.',
  ];
  requiredLabels.forEach((label) => assert.equal(source.includes(label), true, `missing label: ${label}`));
});

test('OpenClawTile avoids stale readonly fallback statuses in governance sections', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  assert.equal(source.includes("proposalStatus || 'awaiting_readonly_validation'"), false);
  assert.equal(source.includes("packetStatus || 'awaiting_readonly_validation'"), false);
});
