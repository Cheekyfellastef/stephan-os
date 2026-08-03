#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPENCLAW_UPDATE_PREFLIGHT_STATUS,
  buildOpenClawUpdatePreflightV1,
} from '../shared/agents/openClawUpdatePreflightV1.mjs';

const MAX_INPUT_BYTES = 256 * 1024;

async function readStdin() {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) throw new Error(`Preflight input exceeds ${MAX_INPUT_BYTES} bytes.`);
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new Error('One JSON preflight observation must be provided on stdin.');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Preflight input must be one JSON object.');
  }
  return parsed;
}

export async function runOpenClawUpdatePreflightCli({ stdout = process.stdout, stderr = process.stderr } = {}) {
  try {
    const input = await readStdin();
    const result = buildOpenClawUpdatePreflightV1(input);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result.status === OPENCLAW_UPDATE_PREFLIGHT_STATUS.BLOCKED_WITH_RESTORE_PATH ? 2 : 0;
  } catch (error) {
    stderr.write(`OPENCLAW_UPDATE_PREFLIGHT_ERROR=${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

export function isDirectCliEntrypoint({ metaUrl = import.meta.url, argv1 = process.argv[1], cwd = process.cwd(), platform = process.platform } = {}) {
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
  process.exitCode = await runOpenClawUpdatePreflightCli();
}
