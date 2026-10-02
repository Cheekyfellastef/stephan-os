import { spawnSync } from 'node:child_process';
import { freeMem, totalMem, uptime } from 'node:os';
import { fileURLToPath } from 'node:url';

export const BATTLE_BRIDGE_OBSERVATION_SCHEMA = 'stephanos.battle-bridge-observation.v1';

const LOOPBACK = '127.0.0.1';
const SERVICE_TARGETS = Object.freeze([
  Object.freeze({ id: 'ui', url: 'http://127.0.0.1:4173/' }),
  Object.freeze({ id: 'backend', url: 'http://127.0.0.1:8787/api/health' }),
  Object.freeze({ id: 'openclaw', url: 'http://127.0.0.1:18789/' }),
  Object.freeze({ id: 'sovereign-commander', url: 'http://127.0.0.1:18791/health' }),
  Object.freeze({ id: 'ollama', url: 'http://127.0.0.1:11434/api/tags' }),
]);

function finiteInteger(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback;
}

function safeText(value, max = 160) {
  return String(value ?? '').trim().slice(0, max);
}

async function request(fetchFn, url, { json = false, timeoutMs = 1500 } = {}) {
  try {
    const response = await fetchFn(url, {
      method: 'GET',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: json ? 'application/json' : '*/*' },
    });
    let body = null;
    if (json && response.ok) {
      try { body = await response.json(); } catch {}
    }
    return Object.freeze({ reachable: true, ok: response.ok, status: Number(response.status) || 0, body });
  } catch {
    return Object.freeze({ reachable: false, ok: false, status: 0, body: null });
  }
}

function normalizeInstalledModels(payload = {}) {
  return Object.freeze((Array.isArray(payload?.models) ? payload.models : []).slice(0, 64).map((model) => Object.freeze({
    name: safeText(model?.name || model?.model, 120),
    sizeBytes: finiteInteger(model?.size),
    parameterSize: safeText(model?.details?.parameter_size, 40),
    quantizationLevel: safeText(model?.details?.quantization_level, 40),
    family: safeText(model?.details?.family, 80),
  })).filter((model) => model.name));
}

function normalizeLoadedModels(payload = {}) {
  return Object.freeze((Array.isArray(payload?.models) ? payload.models : []).slice(0, 64).map((model) => Object.freeze({
    name: safeText(model?.name || model?.model, 120),
    sizeBytes: finiteInteger(model?.size),
    sizeVramBytes: finiteInteger(model?.size_vram),
    contextLength: finiteInteger(model?.context_length),
  })).filter((model) => model.name));
}

export function parseNvidiaSmiObservation(result = {}) {
  if (result?.error || Number(result?.status) !== 0) {
    return Object.freeze({ available: false, name: '', memoryTotalMiB: null, memoryUsedMiB: null, memoryFreeMiB: null, utilizationGpuPercent: null });
  }
  const line = String(result?.stdout || '').split(/\r?\n/).map((entry) => entry.trim()).find(Boolean) || '';
  const fields = line.split(',').map((entry) => entry.trim());
  if (fields.length < 5) {
    return Object.freeze({ available: false, name: '', memoryTotalMiB: null, memoryUsedMiB: null, memoryFreeMiB: null, utilizationGpuPercent: null });
  }
  return Object.freeze({
    available: true,
    name: safeText(fields[0], 120),
    memoryTotalMiB: finiteInteger(fields[1]),
    memoryUsedMiB: finiteInteger(fields[2]),
    memoryFreeMiB: finiteInteger(fields[3]),
    utilizationGpuPercent: finiteInteger(fields[4]),
  });
}

function collectGpu(spawnSyncFn) {
  const executable = process.platform === 'win32'
    ? 'C:\\Windows\\System32\\nvidia-smi.exe'
    : 'nvidia-smi';
  const result = spawnSyncFn(executable, [
    '--query-gpu=name,memory.total,memory.used,memory.free,utilization.gpu',
    '--format=csv,noheader,nounits',
  ], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 3000,
    maxBuffer: 64 * 1024,
  });
  return parseNvidiaSmiObservation(result);
}

export async function collectBattleBridgeObservation({
  fetchFn = globalThis.fetch,
  spawnSyncFn = spawnSync,
  now = () => new Date(),
  memory = () => ({ totalBytes: totalMem(), freeBytes: freeMem() }),
  uptimeFn = uptime,
} = {}) {
  const serviceEntries = await Promise.all(SERVICE_TARGETS.map(async (target) => {
    const result = await request(fetchFn, target.url, { json: target.id === 'ollama' || target.id === 'sovereign-commander' });
    return [target.id, Object.freeze({ reachable: result.reachable, ready: result.ok, httpStatus: result.status })];
  }));
  const services = Object.freeze(Object.fromEntries(serviceEntries));

  const [tags, loaded] = await Promise.all([
    request(fetchFn, `http://${LOOPBACK}:11434/api/tags`, { json: true, timeoutMs: 2500 }),
    request(fetchFn, `http://${LOOPBACK}:11434/api/ps`, { json: true, timeoutMs: 2500 }),
  ]);
  const installedModels = tags.ok ? normalizeInstalledModels(tags.body) : Object.freeze([]);
  const loadedModels = loaded.ok ? normalizeLoadedModels(loaded.body) : Object.freeze([]);

  const memoryFacts = memory();
  const totalBytes = finiteInteger(memoryFacts?.totalBytes, 0) || 0;
  const freeBytes = Math.min(totalBytes, finiteInteger(memoryFacts?.freeBytes, 0) || 0);

  return Object.freeze({
    schemaVersion: BATTLE_BRIDGE_OBSERVATION_SCHEMA,
    ok: true,
    capturedAtUtc: now().toISOString(),
    hostRole: 'battle-bridge',
    uptimeSeconds: finiteInteger(uptimeFn(), 0),
    memory: Object.freeze({
      totalBytes,
      freeBytes,
      usedBytes: Math.max(0, totalBytes - freeBytes),
    }),
    gpu: collectGpu(spawnSyncFn),
    ollama: Object.freeze({
      reachable: tags.reachable || loaded.reachable,
      installedModelCount: installedModels.length,
      loadedModelCount: loadedModels.length,
      installedModels,
      loadedModels,
    }),
    services,
    readOnly: true,
    arbitraryShellAllowed: false,
    secretMaterialIncluded: false,
    finalVerdict: 'BATTLE_BRIDGE_OBSERVATION_READY',
  });
}

export async function runBattleBridgeObservation(options = {}) {
  const observation = await collectBattleBridgeObservation(options);
  process.stdout.write(`${JSON.stringify(observation)}\n`);
  return observation;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runBattleBridgeObservation()
    .catch((error) => {
      process.stderr.write(`${safeText(error?.message || error, 240)}\n`);
      process.exitCode = 1;
    });
}
