import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { probeBackendFreshness } from '../shared/agents/backendFreshnessSupervisor.mjs';

export const BATTLE_BRIDGE_BACKEND_BASE_URL = 'http://127.0.0.1:8787';

export async function runBattleBridgeBackendFreshnessProbe({ fetchImpl = globalThis.fetch } = {}) {
  return probeBackendFreshness({
    baseUrl: BATTLE_BRIDGE_BACKEND_BASE_URL,
    fetchImpl,
    timeoutMs: 4000,
    safeRestartAvailable: true,
  });
}

function isDirectEntrypoint() {
  return Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

if (isDirectEntrypoint()) {
  if (process.argv.length !== 2) throw new Error('BATTLE_BRIDGE_BACKEND_FRESHNESS_ARGUMENTS_REJECTED');
  const proof = await runBattleBridgeBackendFreshnessProbe();
  process.stdout.write(`${JSON.stringify(proof)}\n`);
}
