import { spawn } from 'node:child_process';

const host = process.env.OPENCLAW_STUB_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.OPENCLAW_STUB_PORT || '8790', 10);

function isLoopbackHost(value = '') {
  return ['127.0.0.1', 'localhost', '::1'].includes(String(value).trim().toLowerCase());
}

async function checkStatus() {
  try {
    const response = await fetch(`http://${host}:${port}/health`, { method: 'GET' });
    if (!response.ok) return { available: false, statusCode: response.status };
    const payload = await response.json();
    return {
      available: payload?.state === 'available',
      statusCode: response.status,
      executionAllowed: payload?.executionAllowed === true,
      service: payload?.service || 'openclaw-readonly-adapter-stub',
    };
  } catch {
    return { available: false, statusCode: null, executionAllowed: false, service: 'openclaw-readonly-adapter-stub' };
  }
}

async function waitForAvailability(timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await checkStatus();
    if (status.available) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return checkStatus();
}

async function main() {
  if (!isLoopbackHost(host)) {
    console.log(JSON.stringify({
      ensured: false,
      available: false,
      host,
      port,
      executionAllowed: false,
      nextAction: 'Use loopback host only (127.0.0.1, localhost, or ::1).',
    }));
    process.exit(1);
  }

  const initial = await checkStatus();
  if (initial.available) {
    console.log(JSON.stringify({ ensured: true, started: false, available: true, host, port, executionAllowed: false, service: initial.service }));
    process.exit(0);
  }

  const child = spawn(process.execPath, ['scripts/openclaw-readonly-adapter-stub.mjs'], {
    env: { ...process.env, OPENCLAW_STUB_HOST: host, OPENCLAW_STUB_PORT: String(port) },
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  const post = await waitForAvailability();
  const ok = post.available === true;
  console.log(JSON.stringify({
    ensured: ok,
    started: true,
    available: ok,
    host,
    port,
    executionAllowed: false,
    service: post.service || 'openclaw-readonly-adapter-stub',
    nextAction: ok ? 'Readonly OpenClaw adapter validated. Keep execution disabled until operator approval.' : 'Start or repair the readonly adapter: npm run openclaw:stub:start',
  }));
  process.exit(ok ? 0 : 1);
}

main();
