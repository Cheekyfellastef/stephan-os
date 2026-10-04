#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  validateOpenClawUpdateBattleBridgeCommand,
} from '../shared/agents/openClawUpdateBattleBridgeAdapterV1.mjs';

export const OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_INPUT_BYTES = 64 * 1024;

async function readStdinJson(stdin = process.stdin) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += value.length;
    if (bytes > OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_INPUT_BYTES) {
      throw new Error(`Battle Bridge adapter input exceeds ${OPENCLAW_UPDATE_BATTLE_BRIDGE_MAX_INPUT_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new Error('One JSON Battle Bridge update command must be provided on stdin.');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Battle Bridge update command must be one JSON object.');
  }
  return parsed;
}

export async function runOpenClawUpdateBattleBridgeAdapterCli({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
  now = new Date(),
} = {}) {
  try {
    const command = await readStdinJson(stdin);
    const result = validateOpenClawUpdateBattleBridgeCommand(command, { now });
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.ok ? 0 : 2;
  } catch (error) {
    stderr.write(`OPENCLAW_UPDATE_BATTLE_BRIDGE_ERROR=${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function isDirectCliEntrypoint({
  metaUrl = import.meta.url,
  argv1 = process.argv[1],
  cwd = process.cwd(),
  platform = process.platform,
} = {}) {
  if (!argv1) return false;
  const modulePath = fileURLToPath(metaUrl);
  const scriptPath = platform === 'win32' ? path.win32.resolve(cwd, argv1) : path.resolve(cwd, argv1);
  const normalizeForPlatform = (value) => {
    const normalized = platform === 'win32' ? path.win32.normalize(value) : path.normalize(value);
    if (platform !== 'win32') return normalized;
    return normalized.replace(/^\\([A-Za-z]:\\)/, '$1').toLowerCase();
  };
  return normalizeForPlatform(modulePath) === normalizeForPlatform(scriptPath);
}

if (isDirectCliEntrypoint()) {
  process.exitCode = await runOpenClawUpdateBattleBridgeAdapterCli();
}
