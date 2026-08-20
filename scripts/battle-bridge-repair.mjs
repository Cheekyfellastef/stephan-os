import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  battleBridgeCanonicalRepositoryArgs,
  resolveBattleBridgeGitExecution,
} from '../shared/agents/battleBridgeExecutionBoundaryV1.mjs';
import {
  collectCanonicalIgnitionSourceTruth,
  evaluateCanonicalIgnitionSourceTruth,
} from './battle-bridge-ignition-supervisor.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const psScript = path.join(repoRoot, 'scripts', 'windows', 'repair-stephanos-battle-bridge.ps1');
const logsDir = path.join(repoRoot, 'logs', 'battle-bridge');
const healthUrl = 'http://127.0.0.1:8787/api/health';
const SHA40 = /^[0-9a-f]{40}$/;

function assertExpectedHeadImmediatelyBeforeMutation() {
  let expectedHead = String(process.env.STEPHANOS_EXPECTED_HEAD || '').trim().toLowerCase();
  if (expectedHead && !SHA40.test(expectedHead)) throw new Error('BATTLE_BRIDGE_BACKEND_EXPECTED_HEAD_INVALID');
  if (!expectedHead) {
    const sourceTruth = collectCanonicalIgnitionSourceTruth({
      cwd: repoRoot,
      environment: process.env,
      platform: process.platform,
      spawnSyncFn: spawnSync,
    });
    const canonicalSourceTruth = evaluateCanonicalIgnitionSourceTruth(sourceTruth);
    expectedHead = String(canonicalSourceTruth.sourceTruth?.head || '').trim().toLowerCase();
    if (!canonicalSourceTruth.ok || !SHA40.test(expectedHead)) {
      throw new Error(`BATTLE_BRIDGE_BACKEND_CANONICAL_HEAD_UNPROVEN:${canonicalSourceTruth.blocker?.id || 'source-truth-unproven'}`);
    }
  }
  const gitExecution = resolveBattleBridgeGitExecution({ platform: process.platform, environment: process.env });
  const result = spawnSync(
    gitExecution.executable,
    [...gitExecution.fixedConfigArgs, ...battleBridgeCanonicalRepositoryArgs(repoRoot), 'rev-parse', 'HEAD'],
    { cwd: repoRoot, env: gitExecution.environment, encoding: 'utf8', shell: false, windowsHide: true, timeout: 120_000 },
  );
  const observedHead = String(result?.stdout || '').trim().toLowerCase();
  if (result?.error || result?.status !== 0 || observedHead !== expectedHead) {
    throw new Error('BATTLE_BRIDGE_BACKEND_EXPECTED_HEAD_MISMATCH');
  }
  return expectedHead;
}

function findPowerShell() {
  for (const cmd of ['powershell', 'pwsh']) {
    const res = spawnSync(cmd, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
    if (res.status === 0) return cmd;
  }
  return null;
}

async function waitForHealth(timeoutMs = 20000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = spawnSync('curl', ['-sS', '-o', '/tmp/stephanos-health.json', '-w', '%{http_code}', healthUrl], { encoding: 'utf8' });
    if ((res.stdout || '').trim() === '200') return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const ps = findPowerShell();
if (ps) {
  assertExpectedHeadImmediatelyBeforeMutation();
  const result = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

console.log('PowerShell is unavailable; running portable backend-only repair.');
console.log(`Backend health endpoint: ${healthUrl}`);
console.log('Frontend/dist server not started by this backend repair fallback (port 4173).');
mkdirSync(logsDir, { recursive: true });

const healthOk = await waitForHealth(2000);
if (healthOk) {
  console.log(`Backend already healthy at ${healthUrl}`);
  process.exit(0);
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const stdoutPath = path.join(logsDir, `backend-start-${timestamp}.stdout.log`);
const stderrPath = path.join(logsDir, `backend-start-${timestamp}.stderr.log`);
const stdoutStream = createWriteStream(stdoutPath, { flags: 'a' });
const stderrStream = createWriteStream(stderrPath, { flags: 'a' });

assertExpectedHeadImmediatelyBeforeMutation();
const child = spawn('node', ['stephanos-server/server.js'], {
  cwd: repoRoot,
  detached: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(stdoutStream);
child.stderr.pipe(stderrStream);
child.unref();

console.log(`Portable backend start launched (pid=${child.pid ?? 'unknown'}).`);
console.log(`stdout log: ${path.relative(repoRoot, stdoutPath)}`);
console.log(`stderr log: ${path.relative(repoRoot, stderrPath)}`);

const recovered = await waitForHealth();
if (!recovered) {
  console.error(`Failed to recover backend health at ${healthUrl}`);
  console.error(`Inspect stderr tail at ${path.relative(repoRoot, stderrPath)}`);
  process.exit(1);
}
console.log(`Backend recovered and healthy at ${healthUrl}`);
console.log('Note: Tailscale serve mapping is not managed in portable fallback mode.');
