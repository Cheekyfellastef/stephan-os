const DEFAULT_LOCAL_HOST = '127.0.0.1';
const DEFAULT_LOCAL_PORT = 4173;
const DEFAULT_DEV_PORT = 5173;
const DIST_MOUNT_PATH = '/apps/stephanos/dist/';
const HEALTH_PATH = '/__stephanos/health';
const LAUNCHER_SHELL_PATH = '/';
const DIST_ENTRY_PATH = 'apps/stephanos/dist/index.html';
const RUNTIME_STATUS_PATH = './apps/stephanos/runtime-status.json';
const DEV_RUNTIME_HOSTS = ['localhost', '127.0.0.1'];

function normalizePort(port, fallbackPort = DEFAULT_LOCAL_PORT) {
  const numeric = Number.parseInt(String(port ?? ''), 10);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : fallbackPort;
}

function ensureTrailingSlash(pathname = '/') {
  return pathname.endsWith('/') ? pathname : `${pathname}/`;
}

function createOrigin(host, port) {
  return `http://${host}:${port}`;
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

function createRuntimeTarget({ kind, label, host, port, path = '/', healthUrl = null }) {
  const normalizedPath = ensureTrailingSlash(path);
  const normalizedPort = normalizePort(port, kind === 'dev' ? DEFAULT_DEV_PORT : DEFAULT_LOCAL_PORT);
  const origin = createOrigin(host, normalizedPort);
  const url = `${origin}${normalizedPath}`;

  return {
    kind,
    label,
    host,
    port: normalizedPort,
    origin,
    path: normalizedPath,
    url,
    probeUrl: url,
    healthUrl,
  };
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
  const origin = createOrigin(host, resolvedPort);
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


export function createStephanosHomeNodeTarget({ host = '', uiPort = DEFAULT_DEV_PORT, backendPort = 8787, source = 'manual', lastSeenAt = '', reachable = false } = {}) {
  const urls = createStephanosLocalUrls({ host, port: uiPort });

  return {
    kind: 'home-node',
    label: `home node (${host}:${normalizePort(uiPort, DEFAULT_DEV_PORT)})`,
    host,
    ip: host,
    port: normalizePort(uiPort, DEFAULT_DEV_PORT),
    backendPort: normalizePort(backendPort, 8787),
    origin: urls.origin,
    path: '/',
    url: `${urls.origin}/`,
    probeUrl: `${urls.origin}/`,
    healthUrl: `http://${host}:${normalizePort(backendPort, 8787)}/api/health`,
    source,
    lastSeenAt,
    reachable: Boolean(reachable),
  };
}

export function createStephanosRuntimeTargets({
  distHost = DEFAULT_LOCAL_HOST,
  distPort = DEFAULT_LOCAL_PORT,
  devPort = DEFAULT_DEV_PORT,
} = {}) {
  const distUrls = createStephanosLocalUrls({ host: distHost, port: distPort });

  return [
    ...DEV_RUNTIME_HOSTS.map((host) => createRuntimeTarget({
      kind: 'dev',
      label: `dev runtime (${host}:${normalizePort(devPort, DEFAULT_DEV_PORT)})`,
      host,
      port: devPort,
      path: '/',
    })),
    createRuntimeTarget({
      kind: 'dist',
      label: `dist runtime (${distHost}:${distUrls.port})`,
      host: distHost,
      port: distUrls.port,
      path: DIST_MOUNT_PATH,
      healthUrl: distUrls.healthUrl,
    }),
  ];
}

export function getStephanosPreferredRuntimeTarget(targets = [], preferredKinds = ['dev', 'home-node', 'dist']) {
  for (const kind of preferredKinds) {
    const match = targets.find((target) => target?.kind === kind);
    if (match) {
      return match;
    }
  }

  return targets[0] || null;
}

export function getStephanosRuntimeTargetByKind(targets = [], kind = '') {
  return targets.find((target) => target?.kind === kind) || null;
}

export function resolveStephanosLocalUrls(...candidates) {
  const resolvedPort = resolveStephanosServePort(...candidates);
  return createStephanosLocalUrls({ port: resolvedPort });
}
