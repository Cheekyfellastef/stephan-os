import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  safeBrowserObservationProjection,
  browserObservationCompleteForAction,
  SOVEREIGN_COMMANDER_REMOTE_ACTIONS,
} from '../shared/agents/sovereignCommanderRemoteMailboxV1.mjs';

function envelope(value) {
  return {
    structuredContent: {
      stdout: 'SOVEREIGN_BROWSER_OBSERVATION_RESULT=' + JSON.stringify(value) + '\n',
    },
  };
}

const base = Object.freeze({
  schemaVersion: 'stephanos.sovereign-browser-observation.v1',
  ok: true,
  finalVerdict: 'BROWSER_OBSERVATION_CAPTURED',
  observedAtUtc: '2026-10-18T19:00:00.000Z',
  connectedTabCount: 1,
  admittedTabCount: 1,
  observedTabCount: 1,
  screenshotCount: 1,
  diagnosticTabCount: 1,
  evidenceHash: createHash('sha256').update('test receipt').digest('hex'),
  readOnly: true,
  observationOnly: true,
  servedHeadVerified: false,
  functionalAcceptanceVerified: false,
});

test('registered mailbox action projects bounded observation, never page data', () => {
  assert.ok(SOVEREIGN_COMMANDER_REMOTE_ACTIONS.includes('observe-open-stephanos-tabs'));
  const value = { ...base, url: 'http://localhost:4173/?secret=private', cookies: 'secret' };
  const projected = safeBrowserObservationProjection(envelope(value), 'observe-open-stephanos-tabs');
  assert.equal(projected.ok, true);
  assert.equal(projected.screenshotCount, 1);
  assert.equal(browserObservationCompleteForAction(projected), true);
  assert.doesNotMatch(JSON.stringify(projected), /cookies|private|localhost|url/);
});

test('missing marker or invalid scope cannot count as a browser receipt', () => {
  assert.equal(safeBrowserObservationProjection({ structuredContent: { stdout: 'hello' } }, 'observe-open-stephanos-tabs'), null);
  assert.equal(safeBrowserObservationProjection(envelope(base), 'repair-stephanos'), null);
  assert.equal(safeBrowserObservationProjection(envelope({ ...base, readOnly: false }), 'observe-open-stephanos-tabs'), null);
  assert.equal(safeBrowserObservationProjection(envelope({ ...base, servedHeadVerified: true }), 'observe-open-stephanos-tabs'), null);
});

test('diagnostic-only receipts are accepted as diagnostics, never screenshots', () => {
  const scanned = safeBrowserObservationProjection(envelope({
    ...base,
    finalVerdict:'BROWSER_OBSERVATION_DIAGNOSTIC',
    screenshotCount:0, observedTabCount:0,
    connectedTabCount:3, admittedTabCount:3, diagnosticTabCount:3
  }), 'observe-open-stephanos-tabs');
  assert.equal(scanned.ok,true);
  assert.equal(scanned.finalVerdict,'BROWSER_OBSERVATION_DIAGNOSTIC');
  assert.equal(scanned.screenshotCount,0);
  assert.equal(scanned.functionalAcceptanceVerified,false);
  assert.equal(browserObservationCompleteForAction(scanned),true);
  assert.equal(browserObservationCompleteForAction({...scanned,screenshotCount:1}),false);
});
test('partial evidence or forged functionality does not pass acceptance', () => {
  assert.equal(browserObservationCompleteForAction({ ...base, screenshotCount: 0 }), false);
  assert.equal(browserObservationCompleteForAction({ ...base, functionalAcceptanceVerified: true }), false);
  assert.equal(browserObservationCompleteForAction({ ...base, evidenceHash: 'bad' }), false);
  const partial = safeBrowserObservationProjection(envelope({ ...base, finalVerdict: 'BROWSER_OBSERVATION_PARTIAL' }), 'observe-open-stephanos-tabs');
  assert.equal(partial.ok, false);
  assert.equal(browserObservationCompleteForAction(partial), false);
});

function assertRejected(value, reason) {
  assert.equal(browserObservationCompleteForAction(value), false, reason);
  const projected = safeBrowserObservationProjection(envelope(value), 'observe-open-stephanos-tabs');
  assert.notEqual(projected?.ok, true, reason);
  assert.equal(browserObservationCompleteForAction(projected), false, reason);
}

test('mailbox completion requires a canonical native UTC timestamp', () => {
  for (const observedAtUtc of [undefined, null, '', 0, 'invalid', '2026-02-30T19:00:00.000Z',
    '2026-10-18', '2026-10-18T19:00:00Z', '2026-10-18T19:00:00.000+00:00']) {
    assertRejected({ ...base, observedAtUtc }, `timestamp ${String(observedAtUtc)}`);
  }
});

test('mailbox completion rejects every missing, null, mistyped or out-of-bounds count', () => {
  for (const field of ['connectedTabCount', 'admittedTabCount', 'diagnosticTabCount', 'observedTabCount', 'screenshotCount']) {
    for (const value of [undefined, null, '1', -1, 9, 1.5]) {
      assertRejected({ ...base, [field]: value }, `${field}=${String(value)}`);
    }
  }
});

test('mailbox completion matches the native count relationships and verdict', () => {
  for (const change of [
    { connectedTabCount: 2 }, { admittedTabCount: 2 }, { diagnosticTabCount: 2 },
    { connectedTabCount: 0, admittedTabCount: 0, diagnosticTabCount: 0 },
    { connectedTabCount: 9, admittedTabCount: 9, diagnosticTabCount: 9 },
    { observedTabCount: 2, screenshotCount: 2 },
    { observedTabCount: 0, screenshotCount: 0 },
    { finalVerdict: 'BROWSER_OBSERVATION_DIAGNOSTIC' },
    { blocker: 'BROWSER_ACTIVE_TAB_CHANGED' },
  ]) assertRejected({ ...base, ...change }, JSON.stringify(change));

  const largestScan = { ...base, finalVerdict: 'BROWSER_OBSERVATION_DIAGNOSTIC',
    connectedTabCount: 8, admittedTabCount: 8, diagnosticTabCount: 8,
    observedTabCount: 0, screenshotCount: 0 };
  assert.equal(browserObservationCompleteForAction(largestScan), true);
  assert.equal(safeBrowserObservationProjection(envelope(largestScan), 'observe-open-stephanos-tabs').ok, true);
});
