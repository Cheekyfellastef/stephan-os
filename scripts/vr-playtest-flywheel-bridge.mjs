#!/usr/bin/env node
import { resolve } from 'node:path';
import { publishVrPlaytestSessionToFlywheelV1 } from '../shared/agents/vrPlaytestFlywheelBridgeV1.mjs';

function parseArgs(argv = process.argv.slice(2)) {
  const out = { sessionPath: '', root: '', repoRoot: process.cwd(), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--session') out.sessionPath = argv[++index] || '';
    else if (arg === '--shared-workspace') out.root = argv[++index] || '';
    else if (arg === '--repo-root') out.repoRoot = argv[++index] || '';
    else if (arg === '--json') out.json = true;
  }
  return out;
}

const args = parseArgs();
if (!args.sessionPath || !args.root) {
  process.stderr.write('Usage: node scripts/vr-playtest-flywheel-bridge.mjs --session <session.json> --shared-workspace <path> [--repo-root <repo>] [--json]\n');
  process.exit(2);
}

try {
  const result = await publishVrPlaytestSessionToFlywheelV1({
    sessionPath: resolve(args.sessionPath),
    root: resolve(args.root),
    repoRoot: resolve(args.repoRoot),
  });
  process.stdout.write(`${JSON.stringify(result, null, args.json ? 2 : 0)}\n`);
  process.exit(result.ok ? 0 : 1);
} catch (error) {
  process.stderr.write(`${String(error?.message || error)}\n`);
  process.exit(1);
}
