import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadWorkflowDispatchRuns,
} from '../../scripts/launch-missing-independent-review-v1.mjs';

const WORKFLOW_ID = 318073448;
const BASE = 'bd764f538a3d40fbd5c4c40fe6ff37798c9febd2';
const REQUESTED_AT = '2026-08-22T10:00:00.500Z';
const RUN_NAME = 'stephanos-independent-review-pr-1946-head-2fac6f7-binding-test';
const RECEIPT = Object.freeze({ requestedAtUtc: REQUESTED_AT, runName: RUN_NAME });

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify(payload);
    },
  };
}

function dispatchRun(id, overrides = {}) {
  return {
    id,
    run_number: id,
    run_attempt: 1,
    workflow_id: WORKFLOW_ID,
    name: 'Independent Merge Security Review',
    path: '.github/workflows/independent-merge-security-review.yml',
    event: 'workflow_dispatch',
    repository: { full_name: 'Cheekyfellastef/stephan-os' },
    head_branch: 'main',
    head_sha: BASE,
    display_title: RUN_NAME,
    status: 'completed',
    conclusion: 'success',
    created_at: '2026-08-22T10:00:01Z',
    pull_requests: [],
    ...overrides,
  };
}

function oldSummary(id) {
  return {
    id,
    created_at: '2026-08-22T09:59:59Z',
    display_title: `historical-dispatch-${id}`,
  };
}

function trimmedTargetSummary(id = 101, overrides = {}) {
  return {
    id,
    created_at: '2026-08-22T10:00:01Z',
    display_title: RUN_NAME,
    ...overrides,
  };
}

function pageFromUrl(url) {
  return Number(new URL(String(url)).searchParams.get('page'));
}

test('workflow-dispatch review history paginates then hydrates only the bounded plausible target', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const value = String(url);
    if (value.includes(`/actions/runs/101`)) return jsonResponse(dispatchRun(101));
    const page = pageFromUrl(value);
    if (page === 1) {
      return jsonResponse({
        total_count: 101,
        workflow_runs: Array.from({ length: 100 }, (_, index) => oldSummary(index + 1)),
      });
    }
    if (page === 2) {
      return jsonResponse({
        total_count: 101,
        workflow_runs: [trimmedTargetSummary(101)],
      });
    }
    throw new Error(`unexpected request ${value}`);
  };

  try {
    const runs = await loadWorkflowDispatchRuns(
      'Cheekyfellastef',
      'stephan-os',
      WORKFLOW_ID,
      'test-token',
      RECEIPT,
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, 101);
    assert.equal(runs[0].workflow_id, WORKFLOW_ID);
    assert.equal(runs[0].display_title, RUN_NAME);
    assert.equal(calls.length, 3);
    assert.match(calls[0], /event=workflow_dispatch&branch=main&per_page=100&page=1$/);
    assert.match(calls[1], /event=workflow_dispatch&branch=main&per_page=100&page=2$/);
    assert.match(calls[2], /\/actions\/runs\/101$/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('permission-trimmed workflow-dispatch summary becomes usable only through exact detail hydration', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const value = String(url);
    if (value.includes('/actions/runs/500')) return jsonResponse(dispatchRun(500));
    return jsonResponse({ total_count: 1, workflow_runs: [trimmedTargetSummary(500)] });
  };

  try {
    const runs = await loadWorkflowDispatchRuns(
      'Cheekyfellastef',
      'stephan-os',
      WORKFLOW_ID,
      'test-token',
      RECEIPT,
    );
    assert.equal(runs.length, 1);
    assert.equal(runs[0].id, 500);
    assert.equal(runs[0].path, '.github/workflows/independent-merge-security-review.yml');
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('substituted workflow-dispatch detail identity fails closed', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('/actions/runs/500')) return jsonResponse(dispatchRun(501));
    return jsonResponse({ total_count: 1, workflow_runs: [trimmedTargetSummary(500)] });
  };

  try {
    await assert.rejects(
      () => loadWorkflowDispatchRuns(
        'Cheekyfellastef',
        'stephan-os',
        WORKFLOW_ID,
        'test-token',
        RECEIPT,
      ),
      /summary\/detail id mismatch/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('duplicate plausible workflow-dispatch summary identity fails closed', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (value.includes('/actions/runs/500')) return jsonResponse(dispatchRun(500));
    return jsonResponse({
      total_count: 2,
      workflow_runs: [trimmedTargetSummary(500), trimmedTargetSummary(500)],
    });
  };

  try {
    await assert.rejects(
      () => loadWorkflowDispatchRuns(
        'Cheekyfellastef',
        'stephan-os',
        WORKFLOW_ID,
        'test-token',
        RECEIPT,
      ),
      /duplicate workflow-dispatch run summary id 500/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('workflow-dispatch hydration is hard bounded before detail reads', async () => {
  const originalFetch = globalThis.fetch;
  let detailReads = 0;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (/\/actions\/runs\/[0-9]+$/.test(value)) {
      detailReads += 1;
      throw new Error('detail hydration must not begin after bound exceeded');
    }
    return jsonResponse({
      total_count: 21,
      workflow_runs: Array.from({ length: 21 }, (_, index) => trimmedTargetSummary(index + 1)),
    });
  };

  try {
    await assert.rejects(
      () => loadWorkflowDispatchRuns(
        'Cheekyfellastef',
        'stephan-os',
        WORKFLOW_ID,
        'test-token',
        RECEIPT,
      ),
      /hydration exceeded 20 plausible records/,
    );
    assert.equal(detailReads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('workflow-dispatch review history fails closed beyond the bounded pagination budget', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url) => {
    calls += 1;
    const page = pageFromUrl(url);
    return jsonResponse({
      total_count: 2500,
      workflow_runs: Array.from({ length: 100 }, (_, index) => oldSummary((page - 1) * 100 + index + 1)),
    });
  };

  try {
    await assert.rejects(
      () => loadWorkflowDispatchRuns(
        'Cheekyfellastef',
        'stephan-os',
        WORKFLOW_ID,
        'test-token',
        RECEIPT,
      ),
      /GitHub pagination exceeded 2000 records/,
    );
    assert.equal(calls, 20);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
