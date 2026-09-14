import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendSourceFile = fileURLToPath(import.meta.url);
const canonicalRepoRoot = resolve(dirname(backendSourceFile), '..');
const canonicalGitDirectory = resolve(canonicalRepoRoot, '.git');

function minimalBackendChildGitEnvironment() {
  const allowedNames = new Set([
    'systemroot',
    'windir',
    'comspec',
    'pathext',
    'temp',
    'tmp',
    'tmpdir',
  ]);
  return Object.fromEntries(
    Object.entries(process.env).filter(([name]) => allowedNames.has(name.toLowerCase())),
  );
}

function enforceBattleBridgeBackendChildExpectedHead() {
  const expectedHead = String(process.env.STEPHANOS_BACKEND_SOURCE_HEAD || '').trim().toLowerCase();
  if (!expectedHead) return;
  if (!/^[0-9a-f]{40}$/.test(expectedHead)) {
    throw new Error('BACKEND_CHILD_EXPECTED_HEAD_INVALID');
  }

  const gitExecutable = process.platform === 'win32'
    ? 'C:\\Program Files\\Git\\cmd\\git.exe'
    : '/usr/bin/git';
  const proof = spawnSync(gitExecutable, [
    `--git-dir=${canonicalGitDirectory}`,
    `--work-tree=${canonicalRepoRoot}`,
    'rev-parse',
    'HEAD',
  ], {
    cwd: canonicalRepoRoot,
    env: minimalBackendChildGitEnvironment(),
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5_000,
    maxBuffer: 64 * 1024,
  });
  if (proof.error || proof.status !== 0) {
    throw new Error('BACKEND_CHILD_EXACT_HEAD_PROOF_FAILED');
  }
  const observedHead = String(proof.stdout || '').split(/\r?\n/, 1)[0].trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(observedHead)) {
    throw new Error('BACKEND_CHILD_EXACT_HEAD_PROOF_INVALID');
  }
  if (observedHead !== expectedHead) {
    throw new Error(`BACKEND_CHILD_EXPECTED_HEAD_MISMATCH expected=${expectedHead} observed=${observedHead}`);
  }
}

const backendExpectedHead = String(process.env.STEPHANOS_BACKEND_SOURCE_HEAD || '').trim().toLowerCase();
if (backendExpectedHead
  && globalThis[Symbol.for('stephanos.backend.exact-head-bootstrap')] !== backendExpectedHead) {
  throw new Error('BACKEND_CHILD_IMMUTABLE_BOOTSTRAP_REQUIRED');
}
enforceBattleBridgeBackendChildExpectedHead();

await import('dotenv/config');
const { default: express } = await import('express');
const { default: cors } = await import('cors');
const { default: http } = await import('node:http');
const { default: aiRouter } = await import('./routes/ai.js');
const { default: aiAdminRouter } = await import('./routes/ai-admin.js');
const { default: memoryRouter } = await import('./routes/memory.js');
const { default: tileStateRouter } = await import('./routes/tile-state.js');
const { default: localShellRouter } = await import('./routes/local-shell.js');
const { default: musicRouter } = await import('./routes/music.js');
const { default: setupRouter } = await import('./routes/setup.js');
const { default: githubRouter } = await import('./routes/github.js');
const { default: missionOperationsRouter } = await import('./routes/mission-operations.js');
const { default: buildConciergeRouter } = await import('./routes/build-concierge.js');
const { default: goalProjectionRouter } = await import('./routes/goal-projection.js');
const { default: sharedWorkspaceRouter } = await import('./routes/shared-workspace.js');
const { default: operatorApprovalsRouter } = await import('./routes/operator-approvals.js');
const { startBattleBridgePublisherLoopForBackend } = await import('./services/battleBridgePublisherLifecycle.js');
const { createLogger } = await import('./utils/logger.js');
const { DEFAULT_PROVIDER_KEY } = await import('../shared/ai/providerDefaults.mjs');
const {
  buildHealthDiagnostics,
  getServerPort,
  isAllowedPrivateFrontendOrigin,
  resolveAllowedOrigins,
} = await import('./config/runtimeConfig.js');
const { isAllowedTailscaleFrontendOrigin } = await import('./config/tailscaleOrigin.js');
const { memoryService } = await import('./services/memoryService.js');
const { durableMemoryService } = await import('./services/durableMemoryService.js');
const { providerSecretStore } = await import('./services/providerSecretStore.js');

const logger = createLogger('server');
const app = express();

const PORT = getServerPort();
const allowedOrigins = resolveAllowedOrigins();
const allowedOriginsSet = new Set(allowedOrigins);
const healthUrl = `http://127.0.0.1:${PORT}/api/health`;
const backendSourceHead = String(process.env.STEPHANOS_BACKEND_SOURCE_HEAD || '').trim().toLowerCase();
const backendIdentity = Object.freeze({
  schemaVersion: 'stephanos.backend-runtime-identity.v1',
  runtimeId: 'stephanos-battle-bridge-backend',
  sourceHead: /^[0-9a-f]{40}$/.test(backendSourceHead) ? backendSourceHead : '',
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) {
        callback(null, true);
        return;
      }

      if (
        allowedOriginsSet.has(origin)
        || isAllowedPrivateFrontendOrigin(origin)
        || isAllowedTailscaleFrontendOrigin(origin)
      ) {
        callback(null, true);
        return;
      }

      const error = new Error(`CORS origin denied: ${origin}`);
      error.statusCode = 403;
      error.allowedOrigins = allowedOrigins;
      callback(error);
    },
  }),
);
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (req, res) => {
  res.json({
    ...buildHealthDiagnostics(process.env, req, {
      providerSecretStatus: providerSecretStore.getMaskedStatusSnapshot(),
      secretAuthority: 'backend-local-secret-store',
    }),
    schemaVersion: 'stephanos.backend-health.v1',
    backendIdentity,
  });
});

memoryService.load();
durableMemoryService.load();

app.use('/api/ai', aiRouter);
app.use('/api/ai-admin', aiAdminRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/tile-state', tileStateRouter);
app.use('/api/local', localShellRouter);
app.use('/api/music', musicRouter);
app.use('/api/setup', setupRouter);
app.use('/api/github', githubRouter);
app.use('/api/mission-operations', (req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson({ ...body, backendIdentity });
  next();
}, missionOperationsRouter);
app.use('/api/build-concierge', buildConciergeRouter);
app.use('/api/goal-projection', goalProjectionRouter);
app.use('/api/shared-workspace', sharedWorkspaceRouter);
app.use('/api/operator-approvals', operatorApprovalsRouter);

app.use((error, _req, res, next) => {
  if (error?.message?.startsWith('CORS origin denied:')) {
    res.status(403).json({
      ok: false,
      error: 'CORS origin denied',
      denied_origin: error.message.replace('CORS origin denied: ', ''),
      allowed_origin_count: allowedOrigins.length,
      allowed_origins: allowedOrigins,
      configured_via: ['FRONTEND_ORIGIN', 'FRONTEND_ORIGINS'],
    });
    return;
  }

  next(error);
});
async function probeExistingStephanosServer() {
  try {
    const response = await fetch(healthUrl, {
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
    });

    if (!response.ok) {
      return { reusable: false };
    }

    const payload = await response.json();
    const reusableBaseUrls = new Set([
      `http://localhost:${PORT}`,
      `http://127.0.0.1:${PORT}`,
    ]);
    return {
      reusable:
        payload?.service === 'stephanos-server' &&
        reusableBaseUrls.has(payload?.backend_base_url) &&
        reusableBaseUrls.has(payload?.backend_internal_base_url || payload?.backend_base_url),
      payload,
    };
  } catch {
    return { reusable: false };
  }
}

const server = http.createServer(app);
let battleBridgePublisherLoopHandle = null;
async function startBackendPublisherLoop() {
  battleBridgePublisherLoopHandle = await startBattleBridgePublisherLoopForBackend({
    env: process.env,
    repoRoot: process.cwd(),
    intervalMs: process.env.STEPHANOS_BATTLE_BRIDGE_PUBLISHER_INTERVAL_MS,
  });
  logger.info(`Battle Bridge publisher loop startup: ${battleBridgePublisherLoopHandle.started ? 'started' : 'not-started'} (${battleBridgePublisherLoopHandle.reason})`);
}
function stopBackendPublisherLoop() {
  const result = battleBridgePublisherLoopHandle?.stop?.();
  if (result?.stopped) logger.info(`Battle Bridge publisher loop shutdown: ${result.finalVerdict}`);
}
let shutdownStarted = false;
function shutdownBackend(signal) {
  if (shutdownStarted) return;
  shutdownStarted = true;
  stopBackendPublisherLoop();
  if (!server.listening) {
    process.exit(0);
    return;
  }
  server.close((error) => {
    if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
      logger.error(`Stephanos server shutdown failed after ${signal}.`, error);
      process.exit(1);
      return;
    }
    process.exit(0);
  });
}
process.once('SIGINT', () => shutdownBackend('SIGINT'));
process.once('SIGTERM', () => shutdownBackend('SIGTERM'));

server.on('error', async (error) => {
  if (error?.code !== 'EADDRINUSE') {
    logger.error('Stephanos server failed to start.', error);
    console.error('[BACKEND LIVE] Stephanos server failed to start.', error);
    process.exit(1);
    return;
  }

  const existingServer = await probeExistingStephanosServer();
  if (existingServer.reusable) {
    logger.info(`Stephanos server already running on http://localhost:${PORT}, reusing`);
    console.log(`[BACKEND LIVE] Stephanos server already running on http://localhost:${PORT}, reusing`);
    process.exit(0);
    return;
  }

  logger.error(`Port ${PORT} is occupied by a non-Stephanos process, cannot continue.`);
  console.error(`[BACKEND LIVE] Port ${PORT} is occupied by a non-Stephanos process, cannot continue.`);
  process.exit(1);
});

enforceBattleBridgeBackendChildExpectedHead();
server.listen(PORT, () => {
  void startBackendPublisherLoop();
  logger.info(`Stephanos server listening on http://localhost:${PORT}`);
  logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
  logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`Default provider router target: ${DEFAULT_PROVIDER_KEY} (free-tier default)`);
  console.log(`[BACKEND LIVE] Stephanos server listening on http://localhost:${PORT}`);
  console.log(`[BACKEND LIVE] Health endpoint: ${healthUrl}`);
  console.log(`[BACKEND LIVE] Allowed origins: ${allowedOrigins.join(', ')}`);
  console.log(`[BACKEND LIVE] Default provider router target: ${DEFAULT_PROVIDER_KEY}`);
});
