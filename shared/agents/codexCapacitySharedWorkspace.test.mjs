import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  CODEX_CAPACITY_TRUTH_STATE,
  createCodexCapacityWorkspaceRecords,
  createCodexCapacityWorkspaceSlice,
  createMeterObservationFromCodexStatusResult,
  parseCodexRemainingPercent,
  publishCodexCapacityToSharedWorkspace,
} from './codexCapacitySharedWorkspace.mjs';
import { validateSharedWorkspaceRecord } from './sharedAgentWorkspaceStore.mjs';

const NOW = '2026-08-10T12:00:00.000Z';
const NOW_MS = Date.parse(NOW);

function statusResult(overrides = {}) {
  return {
    ok: true,
    observedAtUtc: '2026-08-10T11:58:00.000Z',
    usageSurfaceMatched: true,
    meterSummary: '5 hour usage 71% remaining | Codex weekly remaining 3%',
    activeCodexTask: false,
    proofRefs: ['receipts/github-command-mailbox/meter-read.json'],
    ...overrides,
  };
}

test('selects the labelled Codex weekly percentage instead of an unrelated short-window meter', () => {
  assert.equal(parseCodexRemainingPercent(statusResult().meterSummary), 3);
  assert.equal(parseCodexRemainingPercent('Codex weekly remaining 100%'), 100);
  assert.equal(parseCodexRemainingPercent('71% | 3%'), null);
});

test('normalizes a trusted read-only status result without retaining raw UI text', () => {
  const observation = createMeterObservationFromCodexStatusResult(statusResult());
  assert.equal(observation.remainingPercent, 3);
  assert.equal(observation.availability, 'AVAILABLE');
  assert.equal(observation.confidence, 'high');
  assert.equal(Object.hasOwn(observation, 'meterSummary'), false);
});

test('publishes CURRENT meter truth while leaving task routing to the canonical controller', () => {
  const slice = createCodexCapacityWorkspaceSlice({ statusResult: statusResult(), timestampUtc: NOW }, { nowMs: NOW_MS });
  assert.equal(slice.truthState, CODEX_CAPACITY_TRUTH_STATE.CURRENT);
  assert.equal(slice.remainingPercent, 3);
  assert.equal(slice.meterTruthUsable, true);
  assert.equal(slice.capacityUsable, true);
  assert.equal(slice.selectedRoute, 'NOT_EVALUATED');
  assert.equal(slice.dispatchAllowed, false);
  assert.equal(slice.taskRouteDecisionRequired, true);
  assert.equal(slice.rawUiTextPublished, false);
});

test('a BUSY observation remains visible truth but is not advertised as usable capacity', () => {
  const slice = createCodexCapacityWorkspaceSlice({
    statusResult: statusResult({ activeCodexTask: true }),
    timestampUtc: NOW,
  });
  assert.equal(slice.truthState, CODEX_CAPACITY_TRUTH_STATE.CURRENT);
  assert.equal(slice.availability, 'BUSY');
  assert.equal(slice.meterTruthUsable, true);
  assert.equal(slice.capacityUsable, false);
});

test('stale and incomplete observations fail closed instead of advertising capacity', () => {
  const stale = createCodexCapacityWorkspaceSlice({
    statusResult: statusResult({ observedAtUtc: '2026-08-10T11:00:00.000Z' }),
    timestampUtc: NOW,
  });
  assert.equal(stale.truthState, CODEX_CAPACITY_TRUTH_STATE.STALE);
  assert.equal(stale.capacityUsable, false);
  assert.equal(stale.remainingPercent, null);
  assert.equal(stale.availability, 'UNKNOWN');

  const unknown = createCodexCapacityWorkspaceSlice({
    statusResult: statusResult({ ok: false, meterSummary: '', usageSurfaceMatched: false }),
    timestampUtc: NOW,
  });
  assert.equal(unknown.truthState, CODEX_CAPACITY_TRUTH_STATE.UNKNOWN);
  assert.equal(unknown.capacityUsable, false);
  assert.equal(unknown.remainingPercent, null);
});

test('status and event records validate through the canonical Shared Workspace store', () => {
  const records = createCodexCapacityWorkspaceRecords({ statusResult: statusResult(), timestampUtc: NOW });
  for (const record of [records.statusRecord, records.eventRecord]) {
    const validation = validateSharedWorkspaceRecord(record, { nowMs: NOW_MS });
    assert.equal(validation.valid, true, validation.errors.join(', '));
  }
});

test('publisher atomically updates current truth and appends a bounded event', async () => {
  const root = await mkdtemp(join(tmpdir(), 'codex-capacity-workspace-'));
  const repoRoot = join(root, 'repo');
  const workspaceRoot = join(root, 'workspace');
  const publication = await publishCodexCapacityToSharedWorkspace(workspaceRoot, {
    statusResult: statusResult(),
    timestampUtc: NOW,
  }, { repoRoot, nowMs: NOW_MS });

  assert.equal(publication.ok, true, publication.reason);
  const current = JSON.parse(await readFile(join(workspaceRoot, 'status', 'codex-capacity-current.json'), 'utf8'));
  assert.equal(current.truthState, 'CURRENT');
  assert.equal(current.remainingPercent, 3);
  assert.equal(current.taskRouteDecisionRequired, true);
  assert.equal(Object.hasOwn(current, 'meterSummary'), false);

  const events = await readFile(join(workspaceRoot, 'events', 'codex-capacity.jsonl'), 'utf8');
  assert.match(events, /codex-capacity-observation/);
  assert.doesNotMatch(events, /5 hour usage/);
});
