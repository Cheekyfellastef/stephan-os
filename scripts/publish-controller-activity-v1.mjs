#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { publishControllerActivityV1 } from '../shared/agents/controllerActivityPublisherV1.mjs';

function fail(message) {
  throw new Error(message);
}

async function main() {
  const inputPath = String(process.argv[2] || '').trim();
  if (!inputPath) fail('CONTROLLER_ACTIVITY_INPUT_PATH_REQUIRED');

  const raw = await readFile(inputPath, 'utf8');
  const input = JSON.parse(raw);
  const repoRoot = fileURLToPath(new URL('../', import.meta.url));
  const workspaceRoot = process.env.STEPHANOS_SHARED_AGENT_WORKSPACE;

  const result = await publishControllerActivityV1(input, {
    workspaceRoot,
    repoRoot,
  });

  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    blocker: String(error?.message || error),
    finalVerdict: 'CONTROLLER_ACTIVITY_PUBLICATION_BLOCKED',
  })}\n`);
  process.exitCode = 1;
});
