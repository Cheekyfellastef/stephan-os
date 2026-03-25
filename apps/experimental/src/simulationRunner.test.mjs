import test from 'node:test';
import assert from 'node:assert/strict';
import { runSandboxSimulation } from './simulationRunner.js';

function buildFixture() {
  return {
    intent: {
      id: 'intent_001',
      summary: 'Build modular planning system',
      priorities: ['modularity'],
      constraints: ['latency'],
    },
    decomposition: {
      layers: [{ layer: 'providers' }, { layer: 'runtime' }],
    },
    generatedSystem: {
      uiLayout: { regions: ['intent', 'decomposition', 'generation', 'simulation', 'evaluation', 'iteration'] },
      files: ['a.js', 'b.js'],
      apis: [{ path: '/api/example' }],
    },
  };
}

test('runSandboxSimulation routes advisor request via Stephanos backend instead of direct Ollama endpoint', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);

    if (url === '/api/health') {
      return {
        ok: true,
        async text() {
          return '';
        },
      };
    }

    if (url.endsWith('/api/ai/chat')) {
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            success: true,
            output_text: 'Use staged rollout checks for reliability.',
            data: { actual_provider_used: 'ollama' },
          });
        },
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  const result = await runSandboxSimulation({ ...buildFixture(), fetchImpl });

  assert.equal(result.aiAdvisor.requestedProvider, 'ollama');
  assert.equal(result.aiAdvisor.actualProvider, 'ollama');
  assert.equal(result.aiAdvisor.ok, true);
  assert.equal(calls.some((url) => String(url).includes('/api/ai/chat')), true);
  assert.equal(calls.some((url) => String(url).includes('localhost:11434')), false);
});
