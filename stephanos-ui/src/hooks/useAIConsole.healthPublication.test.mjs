import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('./useAIConsole.js', import.meta.url), 'utf8');
const start = source.indexOf('  const refreshHealth = useCallback(') + '  const refreshHealth = useCallback('.length;
const body = source.slice(start, source.indexOf('\n  }, [runtimeConfig, setApiStatus', start) + 4);
function fixture(telemetry) {
  const statuses = [];
  const context = {
    Date, Boolean, String, Object, console,
    recordPerfCounter() {}, recordPerfEvent() {},
    runtimeGovernorStateRef: { current: { mode: 'active' } },
    healthRefreshBackoffUntilMsRef: { current: 0 }, healthRefreshInFlightRef: { current: false },
    providerHealthRef: { current: {} }, runtimeConfig: { baseUrl: 'http://127.0.0.1:8787' },
    resolveRuntimeConfig: async () => ({ runtimeConfig: {} }),
    checkApiHealth: async () => ({ ok: true, status: 200, data: { service: 'stephanos-server' } }),
    buildRuntimeContextFromHealth: () => ({}), finalizeRuntimeContext: () => ({ runtimeContext: {}, runtimeStatus: {} }),
    reconcileBackendHealthTruth: () => ({ lastBackendHealthProbeResult: 'ok:true' }),
    setApiStatus: status => statuses.push(status), lastExecutionMetadata: {},
    getProviderHealth: telemetry, provider: 'mock', routeMode: 'local', effectiveProviderConfigs: {}, fallbackEnabled: false, fallbackOrder: [], devMode: false,
    setProviderHealth() {}, setHostedCloudCognitionHealth() {}, hostedCloudLastHealthRef: { current: {} },
    transportErrorToUi: () => ({ output: 'error' }),
  };
  return { run: vm.runInNewContext(`(${body})`, context), statuses };
}
test('real refreshHealth publishes successful backend evidence while optional provider health is pending', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(() => pending);
  const run = f.run({ force: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.statuses.length, 1);
  assert.equal(f.statuses[0].backendReachable, true);
  release({ data: {} }); await run;
  assert.equal(f.statuses.length, 1);
});
test('provider telemetry failure preserves a successful backend receipt', async () => {
  const f = fixture(async () => { throw new Error('provider unavailable'); });
  await f.run({ force: true });
  assert.equal(f.statuses.length, 1);
  assert.equal(f.statuses[0].backendReachable, true);
});
