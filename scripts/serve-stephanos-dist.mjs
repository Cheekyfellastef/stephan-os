import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';
import {
  repoRoot,
  stephanosDistIndexPath,
  stephanosDistMetadataPath,
} from './stephanos-build-utils.mjs';

const host = process.env.STEPHANOS_SERVE_HOST || '0.0.0.0';
const port = Number(process.env.STEPHANOS_SERVE_PORT || 4173);
const runtimeUrl = `http://127.0.0.1:${port}/apps/stephanos/dist/`;
const healthUrl = `http://127.0.0.1:${port}/__stephanos/health`;
const runtimeStatusPath = resolve(repoRoot, 'apps', 'stephanos', 'runtime-status.json');

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
    runtimeUrl,
    healthUrl,
    distEntryPath: 'apps/stephanos/dist/index.html',
    distEntryExists,
    distMetadataPath: 'apps/stephanos/dist/stephanos-build.json',
    distMetadataExists,
    launcherStatus: readRuntimeStatus(),
    checkedAt: new Date().toISOString(),
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
    return {
      reusable:
        payload?.service === 'stephanos-dist-server' &&
        payload?.runtimeUrl === runtimeUrl,
      payload,
    };
  } catch {
    return { reusable: false };
  }
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
  const safeRelativePath = normalize(requestPath).replace(/^([.][.][/\\])+/, '');
  let filePath = resolve(repoRoot, `.${safeRelativePath}`);

  if (!filePath.startsWith(repoRoot)) {
    sendNotFound(response);
    return;
  }

  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }

  if (!existsSync(filePath)) {
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
    console.log(`Open the built runtime at ${runtimeUrl}`);
    process.exit(0);
    return;
  }

  console.error(`Port ${port} is occupied by a non-Stephanos process, cannot continue.`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`Stephanos static server running at http://${host}:${port}/`);
  console.log(`Stephanos health endpoint: ${healthUrl}`);
  console.log(`Open the built runtime at ${runtimeUrl}`);
  console.log(`Open the launcher shell at http://127.0.0.1:${port}/`);
});
