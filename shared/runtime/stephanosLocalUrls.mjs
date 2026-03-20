const DEFAULT_LOCAL_HOST = '127.0.0.1';
const DEFAULT_LOCAL_PORT = 4173;
const DIST_MOUNT_PATH = '/apps/stephanos/dist/';
const HEALTH_PATH = '/__stephanos/health';
const LAUNCHER_SHELL_PATH = '/';
const DIST_ENTRY_PATH = 'apps/stephanos/dist/index.html';
const RUNTIME_STATUS_PATH = './apps/stephanos/runtime-status.json';

function normalizePort(port) {
  const numeric = Number.parseInt(String(port ?? ''), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : DEFAULT_LOCAL_PORT;
}

function extractPortFromUrlLike(value) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    return null;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.port) {
      return normalizePort(parsed.port);
    }
  } catch {
    // Ignore parse failures and fall back to looser matching below.
  }

  const portMatch = raw.match(/(?:^|[^0-9])(\d{2,5})(?=\/|$)/);
  if (!portMatch) {
    return null;
  }

  return normalizePort(portMatch[1]);
}

export function resolveStephanosServePort(...candidates) {
  for (const candidate of candidates) {
    if (candidate == null || candidate === '') {
      continue;
    }

    if (typeof candidate === 'number' || /^\d+$/.test(String(candidate).trim())) {
      return normalizePort(candidate);
    }

    const extracted = extractPortFromUrlLike(candidate);
    if (extracted) {
      return extracted;
    }
  }

  return DEFAULT_LOCAL_PORT;
}

export function createStephanosLocalUrls({ host = DEFAULT_LOCAL_HOST, port = DEFAULT_LOCAL_PORT } = {}) {
  const resolvedPort = normalizePort(port);
  const origin = `http://${host}:${resolvedPort}`;
  const runtimeUrl = `${origin}${DIST_MOUNT_PATH}`;

  return {
    host,
    port: resolvedPort,
    origin,
    distMountPath: DIST_MOUNT_PATH,
    distEntryPath: DIST_ENTRY_PATH,
    runtimeStatusPath: RUNTIME_STATUS_PATH,
    runtimeUrl,
    runtimeIndexUrl: `${runtimeUrl}index.html`,
    launcherShellUrl: `${origin}${LAUNCHER_SHELL_PATH}`,
    healthUrl: `${origin}${HEALTH_PATH}`,
  };
}

export function resolveStephanosLocalUrls(...candidates) {
  const resolvedPort = resolveStephanosServePort(...candidates);
  return createStephanosLocalUrls({ port: resolvedPort });
}
