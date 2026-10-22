#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const git = 'C:\\Program Files\\Git\\cmd\\git.exe';
const powershell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const restartScript = resolve(repoRoot, 'scripts', 'windows', 'restart-approved-stephanos-runtime.ps1');
const SHA40 = /^[0-9a-f]{40}$/;

function run(executable, args, options = {}) {
  return spawnSync(executable, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout ?? 30_000,
    maxBuffer: 256 * 1024,
  });
}

const branch = run(git, ['-C', repoRoot, 'branch', '--show-current']);
const head = run(git, ['-C', repoRoot, 'rev-parse', 'HEAD']);
const sourceHead = String(head.stdout || '').trim().toLowerCase();

if (branch.status !== 0 || String(branch.stdout || '').trim() !== 'main' || head.status !== 0 || !SHA40.test(sourceHead)) {
  process.stdout.write(JSON.stringify({
    schemaVersion: 'stephanos.sovereign-runtime-restart.v1',
    ok: false,
    blocker: 'SOVEREIGN_COMMANDER_CANONICAL_MAIN_REQUIRED',
    sourceHead,
    target: 'backend',
  }) + '\n');
  process.exit(1);
}

const result = run(powershell, [
  '-NoProfile',
  '-NonInteractive',
  '-ExecutionPolicy', 'Bypass',
  '-File', restartScript,
  '-Target', 'backend',
  '-ExpectedHead', sourceHead,
  '-TimeoutSeconds', '90',
], { timeout: 120_000 });

const ok = !result.error && result.status === 0;
process.stdout.write(JSON.stringify({
  schemaVersion: 'stephanos.sovereign-runtime-restart.v1',
  ok,
  blocker: ok ? '' : 'SOVEREIGN_COMMANDER_RUNTIME_RESTART_FAILED',
  sourceHead,
  target: 'backend',
  exitStatus: Number.isInteger(result.status) ? result.status : null,
}) + '\n');

if (!ok) {
  const stderr = String(result.stderr || '').trim();
  if (stderr) process.stderr.write(stderr.slice(0, 4096) + '\n');
}
process.exit(ok ? 0 : 1);
