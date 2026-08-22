import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadWorkflowDispatchRuns,
} from '../../scripts/launch-missing-independent-review-v1.mjs';

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function dispatchRun(id) {
  return {
    id,
    run_number: id,
    run_attempt: 1,
    workflow_id: 318073448,
    name: 'Independent Merge Security Review',
    path: '.github/workflows/independent-merge-security-review.yml',
    event: 'workflow_dispatch',
    repository: { full_name: 'Cheekyfellastef/stephan-os' },
    head_branch: 'main',
    head_sha: '64d9556e630d38c93ff8aa5f0c1081ac0105bff6',
    display_title: `dispatch-${id}`,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-08-22T00:00:00Z',
    pull_requests: [],
  };
}

test('workflow-dispatch review history paginates beyond a full first page', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const parsed = new URL(String(url));
    const page = Number(parsed.searchParams.get('page'));
    if (page === 1) {
      return jsonResponse({
        total_count: 101,
        workflow_runs: Array.from({ length: 100 }, (_, index) => dispatchRun(index + 1)),
      });
    }
    if (page === 2) {
      return jsonResponse({
        total_count: 101,
        workflow_runs: [dispatchRun(101)],
      });
    }
    throw new Error(`unexpected page ${page}`);
  };

  try {
    const runs = await loadWorkflowDispatchRuns('Cheekyfellastef', 'stephan-os', 318073448, 'test-token');
    assert.equal(runs.length, 101);
    assert.equal(runs.at(-1).id, 101);
    assert.equal(calls.length, 2);
    assert.match(calls[0], /event=workflow_dispatch&branch=main&per_page=100&page=1$/);
    assert.match(calls[1], /event=workflow_dispatch&branch=main&per_page=100&page=2$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('workflow-dispatch review history fails closed beyond the bounded pagination budget', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const parsed = new URL(String(url));
    const page = Number(parsed.searchParams.get('page'));
    return jsonResponse({
      total_count: 2500,
      workflow_runs: Array.from({ length: 100 }, (_, index) => dispatchRun((page - 1) * 100 + index + 1)),
    });
  };

  try {
    await assert.rejects(
      () => loadWorkflowDispatchRuns('Cheekyfellastef', 'stephan-os', 318073448, 'test-token'),
      /GitHub pagination exceeded 2000 records/,
    );
    assert.equal(calls, 20);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
