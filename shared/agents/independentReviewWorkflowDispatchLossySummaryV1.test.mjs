import test from 'node:test';
import assert from 'node:assert/strict';

import { loadWorkflowDispatchRuns } from '../../scripts/launch-missing-independent-review-v1.mjs';

const WORKFLOW_ID = 318073448;
const BASE = 'f33e7ac5016f3422273c4cfbe36de6f15adc111a';
const RUN_NAME = 'stephanos-independent-review-pr-1946-head-c1ce37b25775cd0cb32589e1a274164d346eef21-binding-793684893e9b4cb6aa5e85e151ce7bf97d17735cbf8bbb43c74e6d122234761b';
const RECEIPT = Object.freeze({
  requestedAtUtc: '2026-08-22T10:54:01.916Z',
  runName: RUN_NAME,
});

function jsonResponse(payload) {
  return {
    ok: true,
    status: 200,
    async text() { return JSON.stringify(payload); },
  };
}

function exactDetail(id) {
  return {
    id,
    run_number: 700,
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
    conclusion: 'failure',
    created_at: '2026-08-22T10:54:02Z',
    pull_requests: [],
  };
}

test('lossy workflow list metadata cannot veto an exact hydrated review run', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    calls.push(value);
    if (value.endsWith('/actions/runs/700')) return jsonResponse(exactDetail(700));
    return jsonResponse({
      total_count: 1,
      workflow_runs: [{
        id: 700,
        workflow_id: WORKFLOW_ID,
        event: 'workflow_dispatch',
        head_branch: 'main',
        created_at: '2026-08-22T10:54:02Z',
        // GitHub list summaries are selection hints only. These deliberately
        // differ from the authoritative detail record and must not prevent
        // hydration before the strict content-addressed matcher runs.
        name: 'Workflow run',
        path: '',
        repository: {},
        display_title: 'Independent Merge Security Review',
      }],
    });
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
    assert.equal(runs[0].id, 700);
    assert.equal(runs[0].display_title, RUN_NAME);
    assert.equal(runs[0].head_sha, BASE);
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('summary selection still rejects runs older than the content-addressed launch', async () => {
  const originalFetch = globalThis.fetch;
  let detailReads = 0;
  globalThis.fetch = async (url) => {
    const value = String(url);
    if (/\/actions\/runs\/700$/.test(value)) {
      detailReads += 1;
      return jsonResponse(exactDetail(700));
    }
    return jsonResponse({
      total_count: 1,
      workflow_runs: [{
        id: 700,
        workflow_id: WORKFLOW_ID,
        event: 'workflow_dispatch',
        head_branch: 'main',
        created_at: '2026-08-22T10:53:59Z',
        display_title: 'lossy-title',
      }],
    });
  };

  try {
    const runs = await loadWorkflowDispatchRuns(
      'Cheekyfellastef',
      'stephan-os',
      WORKFLOW_ID,
      'test-token',
      RECEIPT,
    );
    assert.deepEqual(runs, []);
    assert.equal(detailReads, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
