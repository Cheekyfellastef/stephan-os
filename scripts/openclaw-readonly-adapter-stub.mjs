import http from 'node:http';

const DEFAULT_HOST = process.env.OPENCLAW_STUB_HOST || '127.0.0.1';
const DEFAULT_PORT = Number.parseInt(process.env.OPENCLAW_STUB_PORT || '8790', 10);
const OPENCLAW_PROTOCOL_VERSION = 'openclaw-readonly-v1';

function isLoopbackHost(host = '') {
  return ['127.0.0.1', 'localhost', '::1'].includes(String(host).trim().toLowerCase());
}

if (!isLoopbackHost(DEFAULT_HOST)) {
  console.error(`[openclaw-stub] Refusing to start: host ${DEFAULT_HOST} is not loopback/local-only.`);
  process.exit(1);
}

function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

const server = http.createServer((request, response) => {
  const checkedAt = new Date().toISOString();
  if (request.method !== 'GET') {
    writeJson(response, 405, { state: 'blocked', error: 'Method not allowed', checkedAt, executionAllowed: false });
    return;
  }
  if (request.url === '/health') {
    writeJson(response, 200, {
      state: 'available',
      service: 'openclaw-readonly-adapter-stub',
      mode: 'readonly_status_only',
      executionAllowed: false,
      canExecute: false,
      checkedAt,
    });
    return;
  }
  if (request.url === '/handshake') {
    writeJson(response, 200, {
      state: 'available',
      protocolVersion: OPENCLAW_PROTOCOL_VERSION,
      expectedProtocolVersion: OPENCLAW_PROTOCOL_VERSION,
      compatible: true,
      adapterIdentity: {
        id: 'openclaw-readonly-adapter-stub',
        label: 'OpenClaw Readonly Adapter Stub',
        version: '1.0.0',
        source: 'stub_local_loopback',
      },
      readonlyAssurance: {
        readonlyOnly: true,
        executionDisabled: true,
        writeAccessDisabled: true,
        commandExecutionDisabled: true,
        browserControlDisabled: true,
        gitWriteDisabled: true,
        networkActionDisabled: true,
      },
      capabilityDeclaration: {
        canExecuteActions: false,
        canRunCommands: false,
        canEditFiles: false,
        canWriteGit: false,
        canControlBrowser: false,
      },
      checkedAt,
    });
    return;
  }
  writeJson(response, 404, { state: 'missing', error: 'Not found', checkedAt, executionAllowed: false });
});

server.listen(DEFAULT_PORT, DEFAULT_HOST, () => {
  console.log(`[openclaw-stub] listening on http://${DEFAULT_HOST}:${DEFAULT_PORT}`);
});
