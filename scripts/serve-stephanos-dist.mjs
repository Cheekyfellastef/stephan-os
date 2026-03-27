import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  repoRoot,
  stephanosDistIndexPath,
  readDistMetadataJson,
  stephanosDistMetadataPath,
} from './stephanos-build-utils.mjs';
import { createStephanosLocalUrls } from '../shared/runtime/stephanosLocalUrls.mjs';

const host = process.env.STEPHANOS_SERVE_HOST || '0.0.0.0';
const port = Number(process.env.STEPHANOS_SERVE_PORT || 4173);
const ignitionMode = process.env.STEPHANOS_IGNITION_MODE || 'launcher-root';
const {
  distMountPath,
  runtimeUrl,
  runtimeIndexUrl,
  launcherShellUrl,
  healthUrl,
  distEntryPath,
} = createStephanosLocalUrls({ port });
const runtimeStatusPath = resolve(repoRoot, 'apps', 'stephanos', 'runtime-status.json');
const staticRootPath = repoRoot;
const LAUNCHER_CRITICAL_SOURCE_PATHS = Object.freeze([
  'main.js',
  'modules/command-deck/command-deck.js',
  'system/module_loader.js',
  'system/workspace.js',
]);

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const baseHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};
const mimeDebugEnabled = process.env.STEPHANOS_SERVE_DEBUG_MIME === '1';
const restartWindowMs = Number(process.env.STEPHANOS_RESTART_WINDOW_MS || 20_000);
const ignitionRestartState = {
  supported: true,
  requested: false,
  requestedAt: '',
  lastResult: 'none',
  source: 'none',
  reason: '',
};

const isMainModule =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

function sendNotFound(response) {
  response.writeHead(404, {
    ...baseHeaders,
    'Content-Type': 'text/plain; charset=utf-8',
  });
  response.end('Not found');
}

function sendRedirect(response, location) {
  response.writeHead(301, {
    ...baseHeaders,
    Location: location,
  });
  response.end();
}

function readRuntimeStatus() {
  if (!existsSync(runtimeStatusPath)) {
    return null;
  }

  try {
    return JSON.parse(readFileSync(runtimeStatusPath, 'utf8'));
  } catch (error) {
    return {
      state: 'error',
      message: `Invalid runtime status file: ${error.message}`,
    };
  }
}

function buildHealthPayload() {
  const distEntryExists = existsSync(stephanosDistIndexPath);
  const distMetadataExists = existsSync(stephanosDistMetadataPath);
  const buildMetadata = distMetadataExists ? readDistMetadataJson() : null;

  return {
    ok: distEntryExists,
    service: 'stephanos-dist-server',
    intendedMode: ignitionMode,
    port,
    staticRootPath,
    runtimeUrl,
    runtimeIndexUrl,
    launcherShellUrl,
    distMountPath,
    healthUrl,
    distEntryPath,
    distEntryExists,
    distMetadataPath: 'apps/stephanos/dist/stephanos-build.json',
    distMetadataExists,
    runtimeMarker: buildMetadata?.runtimeMarker || null,
    gitCommit: buildMetadata?.gitCommit || null,
    buildTimestamp: buildMetadata?.buildTimestamp || null,
    launcherStatus: readRuntimeStatus(),
    ignitionRestart: {
      supported: ignitionRestartState.supported,
      requested: ignitionRestartState.requested,
      lastRequestedAt: ignitionRestartState.requestedAt || null,
      lastResult: ignitionRestartState.lastResult || 'none',
      source: ignitionRestartState.source || 'none',
      reason: ignitionRestartState.reason || '',
    },
    launcherSourceTruth: getLauncherCriticalSourceTruth(),
    checkedAt: new Date().toISOString(),
  };
}

function hashText(value) {
  return createHash('sha256').update(value).digest('hex');
}

function getLauncherCriticalSourceTruth() {
  return LAUNCHER_CRITICAL_SOURCE_PATHS.map((relativePath) => {
    const absolutePath = resolve(staticRootPath, relativePath);
    if (!existsSync(absolutePath)) {
      return {
        path: relativePath,
        exists: false,
        sha256: null,
      };
    }

    const source = readFileSync(absolutePath, 'utf8');
    return {
      path: relativePath,
      exists: true,
      sha256: hashText(source),
      size: Buffer.byteLength(source),
    };
  });
}

function probePortListening(portToProbe, hostToProbe = '127.0.0.1', timeoutMs = 350) {
  return new Promise((resolveProbe) => {
    const socket = net.connect({ host: hostToProbe, port: portToProbe });
    let settled = false;
    const finish = (isListening) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolveProbe(isListening);
    };

    socket.setTimeout(timeoutMs);
    socket.on('connect', () => finish(true));
    socket.on('timeout', () => finish(false));
    socket.on('error', () => finish(false));
  });
}

async function probeHttp200(url) {
  try {
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function probeServedRuntimeMarker(url) {
  try {
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        runtimeMarker: null,
      };
    }

    const html = await response.text();
    const runtimeMarkerMatch =
      html.match(/<meta\b[^>]*\bname=["']stephanos-build-runtime-marker["'][^>]*\bcontent=["']([^"']+)["'][^>]*>/i) ||
      html.match(/<meta\b[^>]*\bcontent=["']([^"']+)["'][^>]*\bname=["']stephanos-build-runtime-marker["'][^>]*>/i);
    return {
      ok: Boolean(runtimeMarkerMatch?.[1]),
      status: response.status,
      runtimeMarker: runtimeMarkerMatch?.[1] || null,
    };
  } catch {
    return {
      ok: false,
      status: null,
      runtimeMarker: null,
    };
  }
}

async function probeJavaScriptMime(url) {
  try {
    const response = await fetch(url, {
      headers: { 'Cache-Control': 'no-cache' },
    });
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    return {
      ok: response.ok && contentType === 'text/javascript; charset=utf-8',
      status: response.status,
      contentType,
    };
  } catch {
    return {
      ok: false,
      status: null,
      contentType: null,
    };
  }
}

async function verifyServedRuntime(url) {
  const [healthOk, runtimeOk] = await Promise.all([
    probeHttp200(healthUrl),
    probeHttp200(url),
  ]);

  return {
    healthOk,
    runtimeOk,
    ready: healthOk && runtimeOk,
  };
}

async function waitForPortToClose(targetPort, timeoutMs = restartWindowMs) {
  const startedAt = Date.now();
  while ((Date.now() - startedAt) < timeoutMs) {
    const listening = await probePortListening(targetPort);
    if (!listening) {
      return true;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  return false;
}

async function requestExistingServerRestart({
  expectedRuntimeMarker = null,
  reason = 'stale-runtime-marker',
  source = 'auto-restart-handoff',
} = {}) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/__stephanos/restart`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        expectedRuntimeMarker,
        reason,
        source,
      }),
    });
    if (!response.ok) {
      return { ok: false, status: response.status };
    }
    const payload = await response.json();
    return {
      ok: payload?.accepted === true,
      status: response.status,
      payload,
    };
  } catch {
    return { ok: false, status: null };
  }
}

async function probeExistingStephanosServer(expectedRuntimeMarker) {
  try {
    const probeOrigin = new URL(healthUrl).origin;
    const response = await fetch(healthUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return { reusable: false };
    }

    const payload = await response.json();
    const resolvedRuntimeUrl = payload?.runtimeUrl || runtimeUrl;
    const [runtimeReady, servedRuntimeMarkerProbe] = await Promise.all([
      probeHttp200(resolvedRuntimeUrl),
      probeServedRuntimeMarker(resolvedRuntimeUrl),
    ]);
    const [runtimeStatusModuleMime, localUrlsModuleMime, sourceTruthProbe] = await Promise.all([
      probeJavaScriptMime(`${probeOrigin}/shared/runtime/runtimeStatusModel.mjs`),
      probeJavaScriptMime(`${probeOrigin}/shared/runtime/stephanosLocalUrls.mjs?v=live-mime-probe`),
      probeLauncherCriticalSourceTruth(probeOrigin),
    ]);
    const moduleMimeReady = runtimeStatusModuleMime.ok && localUrlsModuleMime.ok;
    const sourceTruthReady = sourceTruthProbe.ok;
    const healthRuntimeMarker = payload?.runtimeMarker || null;
    const servedRuntimeMarker = servedRuntimeMarkerProbe.runtimeMarker || null;
    const markerMatchesExpected =
      Boolean(expectedRuntimeMarker) &&
      expectedRuntimeMarker === healthRuntimeMarker &&
      expectedRuntimeMarker === servedRuntimeMarker;

    return {
      reusable: canReuseStephanosServer({
        payload,
        runtimeReady,
        moduleMimeReady,
        sourceTruthReady,
        markerMatchesExpected,
      }),
      runtimeReady,
      moduleMimeReady,
      sourceTruthReady,
      markerMatchesExpected,
      expectedRuntimeMarker: expectedRuntimeMarker || null,
      observedRuntimeMarkers: {
        health: healthRuntimeMarker,
        servedIndex: servedRuntimeMarker,
      },
      servedRuntimeMarkerProbe,
      moduleMimeChecks: {
        runtimeStatusModel: runtimeStatusModuleMime,
        stephanosLocalUrls: localUrlsModuleMime,
      },
      sourceTruthProbe,
      runtimeUrl: resolvedRuntimeUrl,
      payload,
    };
  } catch {
    return { reusable: false };
  }
}

export function canReuseStephanosServer({
  payload,
  runtimeReady,
  moduleMimeReady,
  sourceTruthReady,
  markerMatchesExpected,
}) {
  return (
    payload?.service === 'stephanos-dist-server' &&
    payload?.distMountPath === distMountPath &&
    payload?.staticRootPath === staticRootPath &&
    runtimeReady &&
    moduleMimeReady &&
    sourceTruthReady &&
    markerMatchesExpected
  );
}

async function probeLauncherCriticalSourceTruth(origin) {
  const expected = getLauncherCriticalSourceTruth();
  const expectedMap = new Map(expected.map((entry) => [entry.path, entry.sha256]));

  try {
    const response = await fetch(`${origin}/__stephanos/source-truth`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        mismatches: ['endpoint unavailable'],
      };
    }

    const payload = await response.json();
    const servedEntries = Array.isArray(payload?.launcherCriticalSourceTruth)
      ? payload.launcherCriticalSourceTruth
      : [];
    const servedMap = new Map(servedEntries.map((entry) => [entry.path, entry.sha256]));
    const mismatches = [];

    for (const filePath of LAUNCHER_CRITICAL_SOURCE_PATHS) {
      if (expectedMap.get(filePath) !== servedMap.get(filePath)) {
        mismatches.push(filePath);
      }
    }

    return {
      ok: mismatches.length === 0,
      status: response.status,
      mismatches,
      servedEntries,
    };
  } catch {
    return {
      ok: false,
      status: null,
      mismatches: ['request failed'],
    };
  }
}

function resolveRequestFile(requestPath) {
  if (requestPath === '/apps/stephanos/dist') {
    return { redirectTo: distMountPath };
  }

  const normalizedPath = normalize(requestPath);
  const safeRelativePath = normalizedPath.replace(/^([.][.][/\\])+/, '');
  const candidatePath = resolve(staticRootPath, `.${safeRelativePath}`);

  if (!candidatePath.startsWith(staticRootPath)) {
    return { filePath: null };
  }

  let filePath = candidatePath;
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  return { filePath };
}

export function resolveContentType(filePath) {
  const filePathWithoutQuery = filePath.split('#', 1)[0].split('?', 1)[0];
  return mimeTypes[extname(filePathWithoutQuery).toLowerCase()] || 'application/octet-stream';
}

function resolveRequestExtension(requestPathname, filePath) {
  const requestExtension = extname(requestPathname).toLowerCase();
  if (requestExtension) {
    return requestExtension;
  }
  const filePathWithoutQuery = filePath.split('#', 1)[0].split('?', 1)[0];
  return extname(filePathWithoutQuery).toLowerCase();
}

function shouldLogLiveMimeDebug(pathname) {
  return (
    pathname === '/shared/runtime/runtimeStatusModel.mjs' ||
    pathname === '/shared/runtime/stephanosLocalUrls.mjs'
  );
}

export function createStephanosDistServer() {
  return createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, baseHeaders);
      response.end();
      return;
    }

    if ((request.url || '').startsWith('/__stephanos/health')) {
      response.writeHead(200, {
        ...baseHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      });
      response.end(`${JSON.stringify(buildHealthPayload(), null, 2)}\n`);
      return;
    }
    if ((request.url || '').startsWith('/__stephanos/restart')) {
      if (request.method !== 'POST') {
        response.writeHead(405, {
          ...baseHeaders,
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(`${JSON.stringify({ accepted: false, message: 'POST required' })}\n`);
        return;
      }

      const bodyParts = [];
      request.on('data', (chunk) => {
        bodyParts.push(chunk);
      });
      request.on('end', () => {
        let payload = {};
        try {
          payload = JSON.parse(Buffer.concat(bodyParts).toString('utf8') || '{}');
        } catch {
          payload = {};
        }
        ignitionRestartState.requested = true;
        ignitionRestartState.requestedAt = new Date().toISOString();
        ignitionRestartState.lastResult = 'accepted';
        ignitionRestartState.source = String(payload?.source || 'operator');
        ignitionRestartState.reason = String(payload?.reason || 'manual-restart-request');
        response.writeHead(202, {
          ...baseHeaders,
          'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(`${JSON.stringify({
          accepted: true,
          message: 'Ignition restart accepted; process shutting down for restart handoff.',
          requestedAt: ignitionRestartState.requestedAt,
        })}\n`);

        if (process.env.STEPHANOS_TEST_DISABLE_EXIT === '1') {
          return;
        }
        setTimeout(() => {
          response.socket?.destroy();
          process.exit(0);
        }, 120);
      });
      return;
    }
    if ((request.url || '').startsWith('/__stephanos/source-truth')) {
      response.writeHead(200, {
        ...baseHeaders,
        'Content-Type': 'application/json; charset=utf-8',
      });
      const healthPayload = buildHealthPayload();
      const launcherCriticalSourceTruth = getLauncherCriticalSourceTruth();
      response.end(`${JSON.stringify({
        runtimeMarker: healthPayload.runtimeMarker || null,
        buildTimestamp: healthPayload.buildTimestamp || null,
        sourceTruthAvailable: launcherCriticalSourceTruth.every((entry) => entry.exists === true),
        sourceDistParityOk: null,
        launcherCriticalSourceTruth,
        checkedAt: new Date().toISOString(),
      }, null, 2)}\n`);
      return;
    }

    const requestUrl = new URL(request.url || '/', `http://${host}:${port}`);
    const { redirectTo, filePath } = resolveRequestFile(requestUrl.pathname);

    if (redirectTo) {
      sendRedirect(response, redirectTo);
      return;
    }

    if (!filePath || !existsSync(filePath)) {
      sendNotFound(response);
      return;
    }

    const extension = resolveRequestExtension(requestUrl.pathname, filePath);
    const contentType = mimeTypes[extension] || resolveContentType(filePath);
    if (mimeDebugEnabled) {
      console.log(
        `[DIST SERVER MIME DEBUG] requestedUrl="${request.url || '/'}" pathname="${requestUrl.pathname}" filePath="${filePath}" contentType="${contentType}"`,
      );
    }
    if (shouldLogLiveMimeDebug(requestUrl.pathname)) {
      console.log(
        `[DIST SERVER LIVE MIME] requestedUrl="${request.url || '/'}" pathname="${requestUrl.pathname}" filePath="${filePath}" extension="${extension || '(none)'}" contentType="${contentType}"`,
      );
    }
    response.writeHead(200, {
      ...baseHeaders,
      'Content-Type': contentType,
    });
    if (shouldLogLiveMimeDebug(requestUrl.pathname)) {
      console.log(
        `[DIST SERVER LIVE MIME] writeHead path="${requestUrl.pathname}" contentType="${contentType}"`,
      );
    }
    createReadStream(filePath).pipe(response);
  });
}

if (isMainModule) {
  const [port4173Listening, port5173Listening] = await Promise.all([
    probePortListening(4173),
    probePortListening(5173),
  ]);
  console.log(`[DIST SERVER LIVE] Intended mode: ${ignitionMode}`);
  console.log(`[DIST SERVER LIVE] Intended final URL: ${launcherShellUrl}`);
  console.log(`[DIST SERVER LIVE] 4173 already listening: ${port4173Listening ? 'yes' : 'no'}`);
  console.log(`[DIST SERVER LIVE] 5173 already listening: ${port5173Listening ? 'yes' : 'no'}`);

  const server = createStephanosDistServer();

  server.on('error', async (error) => {
    if (error?.code !== 'EADDRINUSE') {
      console.error('[DIST SERVER LIVE] Failed to start static server.');
      console.error(error);
      process.exit(1);
      return;
    }

    const expectedBuildMetadata = existsSync(stephanosDistMetadataPath) ? readDistMetadataJson() : null;
    const expectedRuntimeMarker = expectedBuildMetadata?.runtimeMarker || null;
    const existingServer = await probeExistingStephanosServer(expectedRuntimeMarker);
    console.log(`[DIST SERVER LIVE] Expected runtime marker from local dist metadata: ${expectedRuntimeMarker || 'unavailable'}`);
    console.log(`[DIST SERVER LIVE] Existing server marker (health): ${existingServer.observedRuntimeMarkers?.health || 'unavailable'}`);
    console.log(`[DIST SERVER LIVE] Existing server marker (served index): ${existingServer.observedRuntimeMarkers?.servedIndex || 'unavailable'}`);
    if (existingServer.reusable) {
      console.log(`[DIST SERVER LIVE] Stephanos dist server already running on ${port}, reusing current process`);
      console.log(`[DIST SERVER LIVE] Stephanos static root: ${relative(repoRoot, staticRootPath) || '.'}`);
      console.log(`[DIST SERVER LIVE] Open the built runtime at ${existingServer.runtimeUrl}`);
      console.log(`[DIST SERVER LIVE] Open the launcher shell at ${launcherShellUrl}`);
      process.exit(0);
      return;
    }

    if (existingServer.payload?.service === 'stephanos-dist-server' && !existingServer.markerMatchesExpected) {
      console.error(`[DIST SERVER LIVE] Existing Stephanos server on port ${port} is stale; runtime marker mismatch.`);
      console.error(`[DIST SERVER LIVE] expected marker=${existingServer.expectedRuntimeMarker || 'unavailable'}`);
      console.error(`[DIST SERVER LIVE] observed marker from health=${existingServer.observedRuntimeMarkers?.health || 'unavailable'}`);
      console.error(`[DIST SERVER LIVE] observed marker from served index=${existingServer.observedRuntimeMarkers?.servedIndex || 'unavailable'}`);
      const restartResponse = await requestExistingServerRestart({
        expectedRuntimeMarker,
        reason: 'runtime-marker-mismatch',
      });
      if (!restartResponse.ok) {
        console.error(`[DIST SERVER LIVE] Refusing process reuse. Stop the stale process on port ${port} and restart.`);
        process.exit(1);
        return;
      }
      const closed = await waitForPortToClose(port);
      if (!closed) {
        console.error(`[DIST SERVER LIVE] Restart request accepted but stale server did not exit in time.`);
        process.exit(1);
        return;
      }
      server.listen(port, host);
      return;
    }

    if (existingServer.payload?.service === 'stephanos-dist-server' && existingServer.runtimeReady && !existingServer.moduleMimeReady) {
      console.error(`[DIST SERVER LIVE] Existing Stephanos server on port ${port} failed module MIME checks; refusing reuse.`);
      console.error(`[DIST SERVER LIVE] runtimeStatusModel.mjs -> status=${existingServer.moduleMimeChecks?.runtimeStatusModel?.status ?? 'n/a'}, content-type=${existingServer.moduleMimeChecks?.runtimeStatusModel?.contentType ?? 'n/a'}`);
      console.error(`[DIST SERVER LIVE] stephanosLocalUrls.mjs?v=live-mime-probe -> status=${existingServer.moduleMimeChecks?.stephanosLocalUrls?.status ?? 'n/a'}, content-type=${existingServer.moduleMimeChecks?.stephanosLocalUrls?.contentType ?? 'n/a'}`);
      const restartResponse = await requestExistingServerRestart({
        expectedRuntimeMarker,
        reason: 'module-mime-mismatch',
      });
      if (!restartResponse.ok) {
        console.error(`[DIST SERVER LIVE] Stop the stale process on port ${port} and restart to launch a fresh server.`);
        process.exit(1);
        return;
      }
      const closed = await waitForPortToClose(port);
      if (!closed) {
        console.error(`[DIST SERVER LIVE] Restart request accepted but stale server did not exit in time.`);
        process.exit(1);
        return;
      }
      server.listen(port, host);
      return;
    }

    if (existingServer.payload?.service === 'stephanos-dist-server' && existingServer.runtimeReady && !existingServer.sourceTruthReady) {
      console.error(`[DIST SERVER LIVE] Existing Stephanos server on port ${port} failed launcher source parity checks; refusing reuse.`);
      console.error(`[DIST SERVER LIVE] mismatched launcher-critical files: ${(existingServer.sourceTruthProbe?.mismatches || []).join(', ') || 'unknown'}`);
      const restartResponse = await requestExistingServerRestart({
        expectedRuntimeMarker,
        reason: 'launcher-source-parity-mismatch',
      });
      if (!restartResponse.ok) {
        console.error(`[DIST SERVER LIVE] Stop the stale process on port ${port} and restart to serve current launcher source.`);
        process.exit(1);
        return;
      }
      const closed = await waitForPortToClose(port);
      if (!closed) {
        console.error(`[DIST SERVER LIVE] Restart request accepted but stale server did not exit in time.`);
        process.exit(1);
        return;
      }
      server.listen(port, host);
      return;
    }

    console.error(`[DIST SERVER LIVE] Port ${port} is occupied by a non-Stephanos process, cannot continue.`);
    process.exit(1);
  });

  server.listen(port, host, async () => {
    const readiness = await verifyServedRuntime(runtimeUrl);
    if (!readiness.ready) {
      console.error('[DIST SERVER LIVE] Static server started but the declared runtime URL did not return HTTP 200.');
      console.error(`[DIST SERVER LIVE] Health URL ready: ${readiness.healthOk}`);
      console.error(`[DIST SERVER LIVE] Runtime URL ready: ${readiness.runtimeOk}`);
      process.exit(1);
      return;
    }

    const buildMetadata = existsSync(stephanosDistMetadataPath) ? readDistMetadataJson() : null;
    console.log(`[DIST SERVER LIVE] Stephanos static server running at http://${host}:${port}/`);
    console.log(`[DIST SERVER LIVE] Stephanos static root: ${relative(repoRoot, staticRootPath) || '.'}`);
    console.log(`[DIST SERVER LIVE] Stephanos health endpoint: ${healthUrl}`);
    console.log(`[DIST SERVER LIVE] Built runtime URL: ${runtimeUrl}`);
    console.log(`[DIST SERVER LIVE] Launcher shell URL: ${launcherShellUrl}`);
    if (buildMetadata) {
      console.log(`[DIST SERVER LIVE] Runtime marker: ${buildMetadata.runtimeMarker}`);
      console.log(`[DIST SERVER LIVE] Git commit: ${buildMetadata.gitCommit}`);
      console.log(`[DIST SERVER LIVE] Build timestamp: ${buildMetadata.buildTimestamp}`);
    }
  });
}
