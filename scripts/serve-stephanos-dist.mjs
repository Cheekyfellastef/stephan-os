import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
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
    checkedAt: new Date().toISOString(),
  };
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

async function probeExistingStephanosServer() {
  try {
    const response = await fetch(healthUrl, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      return { reusable: false };
    }

    const payload = await response.json();
    const resolvedRuntimeUrl = payload?.runtimeUrl || runtimeUrl;
    const runtimeReady = await probeHttp200(resolvedRuntimeUrl);

    return {
      reusable:
        payload?.service === 'stephanos-dist-server' &&
        payload?.distMountPath === distMountPath &&
        payload?.staticRootPath === staticRootPath &&
        runtimeReady,
      runtimeReady,
      runtimeUrl: resolvedRuntimeUrl,
      payload,
    };
  } catch {
    return { reusable: false };
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

if (isMainModule) {
  const server = createServer((request, response) => {
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

    const requestPath = new URL(request.url || '/', `http://${host}:${port}`).pathname;
    const { redirectTo, filePath } = resolveRequestFile(requestPath);

    if (redirectTo) {
      sendRedirect(response, redirectTo);
      return;
    }

    if (!filePath || !existsSync(filePath)) {
      sendNotFound(response);
      return;
    }

    const contentType = resolveContentType(filePath);
    response.writeHead(200, {
      ...baseHeaders,
      'Content-Type': contentType,
    });
    createReadStream(filePath).pipe(response);
  });

  server.on('error', async (error) => {
    if (error?.code !== 'EADDRINUSE') {
      console.error('[DIST SERVER LIVE] Failed to start static server.');
      console.error(error);
      process.exit(1);
      return;
    }

    const existingServer = await probeExistingStephanosServer();
    if (existingServer.reusable) {
      console.log(`[DIST SERVER LIVE] Stephanos dist server already running on ${port}, reusing`);
      console.log(`[DIST SERVER LIVE] Stephanos static root: ${relative(repoRoot, staticRootPath) || '.'}`);
      console.log(`[DIST SERVER LIVE] Open the built runtime at ${existingServer.runtimeUrl}`);
      console.log(`[DIST SERVER LIVE] Open the launcher shell at ${launcherShellUrl}`);
      process.exit(0);
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
