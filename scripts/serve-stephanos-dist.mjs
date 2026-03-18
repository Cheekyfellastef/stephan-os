import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, resolve } from 'node:path';
import {
  repoRoot,
  stephanosDistIndexPath,
  stephanosDistMetadataPath,
} from './stephanos-build-utils.mjs';

const host = process.env.STEPHANOS_SERVE_HOST || '0.0.0.0';
const port = Number(process.env.STEPHANOS_SERVE_PORT || 4173);
const distMountPath = '/apps/stephanos/dist/';
const runtimeUrl = `http://127.0.0.1:${port}${distMountPath}`;
const runtimeIndexUrl = `${runtimeUrl}index.html`;
const launcherShellUrl = `http://127.0.0.1:${port}/`;
const healthUrl = `http://127.0.0.1:${port}/__stephanos/health`;
const runtimeStatusPath = resolve(repoRoot, 'apps', 'stephanos', 'runtime-status.json');
const staticRootPath = repoRoot;

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
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
    distEntryPath: 'apps/stephanos/dist/index.html',
    distEntryExists,
    distMetadataPath: 'apps/stephanos/dist/stephanos-build.json',
    distMetadataExists,
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

  const contentType = mimeTypes[extname(filePath)] || 'application/octet-stream';
  response.writeHead(200, {
    ...baseHeaders,
    'Content-Type': contentType,
  });
  createReadStream(filePath).pipe(response);
});

server.on('error', async (error) => {
  if (error?.code !== 'EADDRINUSE') {
    console.error('[stephanos serve] Failed to start static server.');
    console.error(error);
    process.exit(1);
    return;
  }

  const existingServer = await probeExistingStephanosServer();
  if (existingServer.reusable) {
    console.log(`Stephanos dist server already running on ${port}, reusing`);
    console.log(`Stephanos static root: ${relative(repoRoot, staticRootPath) || '.'}`);
    console.log(`Open the built runtime at ${existingServer.runtimeUrl}`);
    console.log(`Open the launcher shell at ${launcherShellUrl}`);
    process.exit(0);
    return;
  }

  console.error(`Port ${port} is occupied by a non-Stephanos process, cannot continue.`);
  process.exit(1);
});

server.listen(port, host, async () => {
  const readiness = await verifyServedRuntime(runtimeUrl);
  if (!readiness.ready) {
    console.error('[stephanos serve] Static server started but the declared runtime URL did not return HTTP 200.');
    console.error(`Health URL ready: ${readiness.healthOk}`);
    console.error(`Runtime URL ready: ${readiness.runtimeOk}`);
    process.exit(1);
    return;
  }

  console.log(`Stephanos static server running at http://${host}:${port}/`);
  console.log(`Stephanos static root: ${relative(repoRoot, staticRootPath) || '.'}`);
  console.log(`Stephanos health endpoint: ${healthUrl}`);
  console.log(`Open the built runtime at ${runtimeUrl}`);
  console.log(`Open the launcher shell at ${launcherShellUrl}`);
});
