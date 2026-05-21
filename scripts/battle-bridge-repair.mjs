import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const psScript = path.join(repoRoot, 'scripts', 'windows', 'repair-stephanos-battle-bridge.ps1');
const logsDir = path.join(repoRoot, 'logs', 'battle-bridge');

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
    const res = spawnSync('curl', ['-sS', '-o', '/tmp/stephanos-health.json', '-w', '%{http_code}', 'http://127.0.0.1:8787/api/health'], { encoding: 'utf8' });
    if ((res.stdout || '').trim() === '200') return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

const ps = findPowerShell();
if (ps) {
  const result = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

console.log('PowerShell is unavailable; running portable backend-only repair.');
mkdirSync(logsDir, { recursive: true });

const healthOk = await waitForHealth(2000);
if (healthOk) {
  console.log('Backend already healthy at http://127.0.0.1:8787/api/health');
  process.exit(0);
}

const child = spawn('node', ['stephanos-server/server.js'], {
  cwd: repoRoot,
  detached: true,
  stdio: 'ignore',
});
child.unref();

const recovered = await waitForHealth();
if (!recovered) {
  console.error('Failed to recover backend health at http://127.0.0.1:8787/api/health');
  process.exit(1);
}
console.log('Backend recovered and healthy at http://127.0.0.1:8787/api/health');
console.log('Note: Tailscale serve mapping is not managed in portable fallback mode.');
