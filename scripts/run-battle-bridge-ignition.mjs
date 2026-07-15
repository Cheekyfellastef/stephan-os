#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const supervisorScript = path.join(repoRoot, 'scripts', 'battle-bridge-ignition-supervisor.mjs');
const backendStarterScript = path.join(repoRoot, 'scripts', 'windows', 'start-stephanos-backend.ps1');

function runStep(label, command, args) {
  console.log(`[IGNITION ENTRY] ${label}: ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    env: process.env,
  });

  if (result.error || result.status !== 0) {
    const details = [
      `status=${result.status ?? 'null'}`,
      `signal=${result.signal ?? 'null'}`,
      `error=${result.error?.message || 'none'}`,
    ].join(', ');
    console.error(`[IGNITION ENTRY] ${label} failed (${details})`);
    return false;
  }

  return true;
}

if (process.platform === 'win32') {
  const backendReady = runStep('backend-8787-preflight', 'powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    backendStarterScript,
    '-StartupTimeoutSeconds',
    '90',
    '-PollIntervalSeconds',
    '2',
  ]);

  if (!backendReady) {
    console.error('[IGNITION ENTRY] Battle Bridge supervisor not started because the backend-only 8787 preflight failed.');
    process.exit(1);
  }
}

const supervisorReady = runStep(
  'battle-bridge-ignition-supervisor',
  process.execPath,
  [supervisorScript, ...process.argv.slice(2)],
);

process.exit(supervisorReady ? 0 : 1);
