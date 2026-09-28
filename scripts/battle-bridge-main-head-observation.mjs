import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readBrokeredGithubJson } from '../shared/agents/githubObservationBrokerV1.mjs';

export const BATTLE_BRIDGE_MAIN_HEAD_OBSERVATION_SCHEMA = 'stephanos.battle-bridge-main-head-observation.v1';
export const BATTLE_BRIDGE_MAIN_HEAD_REPOSITORY = 'Cheekyfellastef/stephan-os';
export const BATTLE_BRIDGE_MAIN_HEAD_ENDPOINT = `repos/${BATTLE_BRIDGE_MAIN_HEAD_REPOSITORY}/branches/main`;

export function readBattleBridgeBrokeredMainHead(options = {}) {
  const observed = readBrokeredGithubJson({
    key: 'canonical-main-head:Cheekyfellastef/stephan-os',
    endpoint: BATTLE_BRIDGE_MAIN_HEAD_ENDPOINT,
    ttlMs: 90_000,
    maxStaleMs: 180_000,
    ghCommand: options.ghCommand || process.env.STEPHANOS_GH_COMMAND || 'gh',
    workspaceRoot: options.workspaceRoot,
    env: options.env || process.env,
    spawnSyncFn: options.spawnSyncFn,
    nowMs: options.nowMs,
  });
  const sha = String(observed?.payload?.commit?.sha || '').trim().toLowerCase();
  if (!observed?.ok || !/^[0-9a-f]{40}$/.test(sha)) {
    return Object.freeze({
      ok: false,
      schemaVersion: BATTLE_BRIDGE_MAIN_HEAD_OBSERVATION_SCHEMA,
      blocker: observed?.reason || 'BROKERED_MAIN_HEAD_INVALID',
      sha: '',
      observationSource: observed?.source || '',
    });
  }
  return Object.freeze({
    ok: true,
    schemaVersion: BATTLE_BRIDGE_MAIN_HEAD_OBSERVATION_SCHEMA,
    sha,
    observationSource: observed.source,
    observedAtUtc: observed.observedAtUtc || '',
    arbitraryEndpointAllowed: false,
    mutationAllowed: false,
  });
}

function isDirectEntrypoint() {
  if (!process.argv[1]) return false;
  return path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

if (isDirectEntrypoint()) {
  const result = readBattleBridgeBrokeredMainHead();
  if (!result.ok) {
    process.stderr.write(`${result.blocker}\n`);
    process.exitCode = 2;
  } else {
    process.stdout.write(`${result.sha}\n`);
  }
}
