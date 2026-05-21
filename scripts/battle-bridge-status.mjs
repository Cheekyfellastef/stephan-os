#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const psScript = path.join(repoRoot, 'scripts', 'windows', 'status-stephanos-backend-autostart.ps1');
const logsDir = path.join(repoRoot, 'logs', 'battle-bridge');

function findPowerShell() {
  for (const cmd of ['powershell', 'pwsh']) {
    const res = spawnSync(cmd, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
    if (res.status === 0) return cmd;
  }
  return null;
}

function latestTail(pattern) {
  if (!existsSync(logsDir)) return null;
  const files = readdirSync(logsDir)
    .filter((name) => pattern.test(name))
    .map((name) => ({ name, full: path.join(logsDir, name) }))
    .sort((a, b) => b.name.localeCompare(a.name));
  if (!files.length) return null;
  const lines = readFileSync(files[0].full, 'utf8').split(/\r?\n/).slice(-40).join('\n');
  return { file: path.relative(repoRoot, files[0].full), lines };
}

const ps = findPowerShell();
if (ps) {
  const result = spawnSync(ps, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}

console.log('=== Stephanos Battle Bridge Status (portable fallback) ===');
console.log('PowerShell is unavailable; running Linux/macOS diagnostics fallback.');

const health = spawnSync('curl', ['-sS', '-o', '/tmp/stephanos-health.json', '-w', '%{http_code}', 'http://127.0.0.1:8787/api/health'], { encoding: 'utf8' });
const httpCode = (health.stdout || '').trim();
console.log(`Local backend /api/health HTTP status: ${httpCode || 'unreachable'}`);

const stderrTail = latestTail(/^backend-start-.*\.stderr\.log$/);
if (stderrTail) {
  console.log(`\nLatest backend stderr tail (${stderrTail.file}):`);
  console.log(stderrTail.lines || '(empty)');
} else {
  console.log('\nNo backend-start stderr logs found under logs/battle-bridge.');
}
