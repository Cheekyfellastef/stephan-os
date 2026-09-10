#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { evaluateStarfieldVrLaunch, STARFIELD_VR_LAUNCH_ACTIONS } from '../shared/agents/starfieldVrLaunchPolicy.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

async function main() {
  const profilePath = argument('--profile');
  const observationsPath = argument('--observations');
  if (!profilePath || !observationsPath) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      action: STARFIELD_VR_LAUNCH_ACTIONS.BLOCKED,
      blockers: ['decision-input-path-missing'],
      warnings: [],
    })}\n`);
    return;
  }

  try {
    const [profile, observations] = await Promise.all([
      readJson(profilePath),
      readJson(observationsPath),
    ]);
    process.stdout.write(`${JSON.stringify(evaluateStarfieldVrLaunch(profile, observations))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      action: STARFIELD_VR_LAUNCH_ACTIONS.BLOCKED,
      blockers: ['decision-input-unreadable'],
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    })}\n`);
  }
}

await main();
