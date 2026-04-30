const host = process.env.OPENCLAW_STUB_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.OPENCLAW_STUB_PORT || '8790', 10);

async function main() {
  try {
    const response = await fetch(`http://${host}:${port}/health`, { method: 'GET' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const available = payload?.state === 'available';
    console.log(JSON.stringify({ available, host, port, executionAllowed: payload?.executionAllowed === true ? true : false, service: payload?.service || '' }));
    process.exit(available ? 0 : 1);
  } catch {
    console.log(JSON.stringify({ available: false, host, port, executionAllowed: false, service: 'openclaw-readonly-adapter-stub' }));
    process.exit(1);
  }
}

main();
