#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { updateStephanosFromChat } from '../shared/agents/stephanosChatUpdate.mjs';
import { runBattleBridgeDiagnostics } from '../shared/agents/codexDispatchHostOps.mjs';
import {
  BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE,
  BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY,
  buildBattleBridgeGitHubCommandReceipt,
  executeBattleBridgeGitHubCommand,
  selectNextBattleBridgeGitHubCommand,
} from '../shared/agents/battleBridgeGitHubCommandMailbox.mjs';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const expectedRepoRoot = resolve(process.env.USERPROFILE || homedir(), 'Documents', 'GitHub', 'stephan-os');
const workspaceRoot = resolve(process.env.STEPHANOS_SHARED_WORKSPACE_ROOT || join(homedir(), 'Documents', 'Stephanos', 'shared-agent-workspace'));
const receiptRoot = join(workspaceRoot, 'github-command-mailbox');
const statePath = join(receiptRoot, 'state.json');
const MAX_GITHUB_JSON_BYTES = 2 * 1024 * 1024;

function bounded(value, limit = 12000) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > limit ? `${text.slice(0, limit)}\n...[truncated]` : text;
}

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    cwd: options.cwd || repoRoot,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: options.timeout || 900000,
    maxBuffer: options.maxBuffer || MAX_GITHUB_JSON_BYTES,
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  return {
    ok: !result.error && result.status === 0,
    status: result.status ?? null,
    stdout: options.preserveStdout ? stdout : bounded(stdout),
    stderr: bounded(stderr),
    error: result.error?.message || '',
  };
}

export function parseBoundedGitHubJson(stdout, maxBytes = MAX_GITHUB_JSON_BYTES) {
  const text = String(stdout || '');
  const byteLength = Buffer.byteLength(text, 'utf8');
  if (byteLength > maxBytes) {
    throw new Error(`GITHUB_RESPONSE_TOO_LARGE:${byteLength}:${maxBytes}`);
  }
  try {
    return JSON.parse(text || 'null');
  } catch (error) {
    throw new Error(`GITHUB_RESPONSE_JSON_INVALID:${error?.message || String(error)}`);
  }
}

function loadState() {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return { consumedRequestIds: [] }; }
}

function saveState(state) {
  mkdirSync(receiptRoot, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
}

function writeReceipt(receipt) {
  mkdirSync(receiptRoot, { recursive: true });
  const path = join(receiptRoot, `${receipt.requestId}.json`);
  writeFileSync(path, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return path;
}

function ghJson(args) {
  const result = run('gh.exe', args, {
    timeout: 120000,
    preserveStdout: true,
    maxBuffer: MAX_GITHUB_JSON_BYTES,
  });
  if (!result.ok) throw new Error(result.error || result.stderr || 'gh command failed');
  return parseBoundedGitHubJson(result.stdout);
}

function postReceipt(receipt) {
  const body = [
    '<!-- stephanos-battle-bridge-command-receipt -->',
    '```json',
    bounded(receipt, 10000),
    '```',
  ].join('\n');
  return run('gh.exe', ['issue', 'comment', String(BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE), '--repo', BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY, '--body', body], { timeout: 120000 });
}

async function installUnattendedSync() {
  const installer = join(repoRoot, 'scripts', 'windows', 'install-battle-bridge-github-sync.ps1');
  if (!existsSync(installer)) return { ok: false, blocker: 'MERGED_SYNC_INSTALLER_MISSING', installer };
  const result = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', installer, '-StartNow']);
  return { ...result, installer, fixedCommand: true, arbitraryShellAllowed: false };
}

async function readDeploymentStatus() {
  const source = run('git.exe', ['rev-parse', 'HEAD'], { timeout: 120000 });
  const branch = run('git.exe', ['branch', '--show-current'], { timeout: 120000 });
  const task = run('powershell.exe', ['-NoProfile', '-Command', "Get-ScheduledTask -TaskName 'Stephanos Battle Bridge GitHub Sync' -ErrorAction SilentlyContinue | Select-Object TaskName,State | ConvertTo-Json -Compress"], { timeout: 120000 });
  return { ok: source.ok && branch.ok, sourceHead: source.stdout.trim(), branch: branch.stdout.trim(), task };
}

export async function runBattleBridgeGitHubCommandMailbox({ now = () => new Date() } = {}) {
  if (process.platform !== 'win32') return { ok: false, blocker: 'WINDOWS_REQUIRED' };
  if (repoRoot.toLowerCase() !== expectedRepoRoot.toLowerCase()) {
    return { ok: false, blocker: 'CANONICAL_CHECKOUT_REQUIRED', repoRoot, expectedRepoRoot };
  }
  const comments = ghJson(['api', `repos/${BATTLE_BRIDGE_GITHUB_COMMAND_REPOSITORY}/issues/${BATTLE_BRIDGE_GITHUB_COMMAND_ISSUE}/comments`, '--paginate']);
  const state = loadState();
  const selected = selectNextBattleBridgeGitHubCommand(comments, {
    consumedRequestIds: new Set(state.consumedRequestIds || []),
    now: now(),
  });
  if (selected.verdict === 'NO_COMMAND_READY') return selected;
  if (!selected.ok) return selected;

  const acceptedAt = now().toISOString();
  let receipt = buildBattleBridgeGitHubCommandReceipt({ command: selected.command, state: 'ACCEPTED', acceptedAt, heartbeatAt: acceptedAt, proofRefs: [selected.commentUrl] });
  const receiptPath = writeReceipt(receipt);
  postReceipt({ ...receipt, receiptPath });

  const execution = await executeBattleBridgeGitHubCommand(selected.command, {
    updateStephanos: (command) => updateStephanosFromChat({ operatorApproval: command.operatorApproval, expectedBranch: 'main' }),
    installUnattendedSync,
    runDiagnostics: () => runBattleBridgeDiagnostics(),
    readDeploymentStatus,
  });

  const completedAt = now().toISOString();
  receipt = buildBattleBridgeGitHubCommandReceipt({
    command: selected.command,
    state: execution.ok ? 'DONE' : 'BLOCKED',
    acceptedAt,
    heartbeatAt: completedAt,
    completedAt,
    result: execution,
    blocker: execution.blocker || execution.result?.blocker || '',
    proofRefs: [selected.commentUrl, receiptPath],
  });
  writeReceipt(receipt);
  state.consumedRequestIds = [...new Set([...(state.consumedRequestIds || []), selected.command.requestId])].slice(-500);
  state.lastReceipt = receipt;
  saveState(state);
  postReceipt({ ...receipt, receiptPath });
  return { ...receipt, receiptPath };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBattleBridgeGitHubCommandMailbox()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      process.exitCode = result?.ok === false ? 1 : 0;
    })
    .catch((error) => {
      process.stderr.write(`${error?.stack || error?.message || String(error)}\n`);
      process.exitCode = 1;
    });
}
