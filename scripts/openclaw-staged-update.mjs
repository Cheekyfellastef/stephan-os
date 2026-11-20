#!/usr/bin/env node

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OPENCLAW_STAGED_UPDATE_STATUS,
  buildOpenClawStagedUpdateV1,
} from '../shared/agents/openClawStagedUpdateV1.mjs';

export const OPENCLAW_STAGED_UPDATE_MAX_INPUT_BYTES = 512 * 1024;

async function readStdinJson(stdin = process.stdin) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of stdin) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    bytes += value.length;
    if (bytes > OPENCLAW_STAGED_UPDATE_MAX_INPUT_BYTES) {
      throw new Error(`Staged update input exceeds ${OPENCLAW_STAGED_UPDATE_MAX_INPUT_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) throw new Error('One JSON staged-update evidence object must be provided on stdin.');
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Staged update input must be one JSON object.');
  }
  return parsed;
}

export async function runOpenClawStagedUpdateCli({
  stdin = process.stdin,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  try {
    const input = await readStdinJson(stdin);
    const result = buildOpenClawStagedUpdateV1(input);
    stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return [
      OPENCLAW_STAGED_UPDATE_STATUS.BLOCKED_WITH_RESTORE_PATH,
      OPENCLAW_STAGED_UPDATE_STATUS.ROLLBACK_REQUIRED,
    ].includes(result.status) ? 2 : 0;
  } catch (error) {
    stderr.write(`OPENCLAW_STAGED_UPDATE_ERROR=${error instanceof Error ? error.message : String(error)}\n`);
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
  process.exitCode = await runOpenClawStagedUpdateCli();
}
