import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'MissionCommandDeck.jsx');

test('MissionCommandDeck renders command deck visual sections and status strip labels', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  [
    'Route Truth',
    'Launch State',
    'Active Provider',
    'OpenClaw',
    'Codex PR Repair',
    'Memory',
    'Verification',
    'System Watcher',
    'Mission Routing / Delegation Readiness',
    'Agent Assignment Matrix',
    'Codex PR Repair Contract',
    'Operator Decision Console',
    'Support Snapshot / Runtime Truth',
    'Activity Feed',
    'Approval Required',
    'Operator approval needed to proceed',
    'No default manual code surgery',
  ].forEach((label) => assert.equal(source.includes(label), true, `missing label: ${label}`));
});

test('MissionCommandDeck keeps decisions visual only and introduces no execution automation', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  ['Retry Checks', 'Repair PR', 'Recreate PR', 'Hold'].forEach((label) => assert.equal(source.includes(label), true));
  ['exec(', 'spawn(', 'fetch(', 'merge', 'git push'].forEach((token) => assert.equal(source.includes(token), false, `unexpected automation token: ${token}`));
});
