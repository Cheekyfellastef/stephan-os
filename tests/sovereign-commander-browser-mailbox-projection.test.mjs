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
  connectedTabCount: 2,
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
    diagnosticTabCount:3
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
