import test from 'node:test';
import assert from 'node:assert/strict';
import { adjudicateOpenClawAdapterStub } from './openClawAdapterStub.mjs';

test('openClaw adapter stub defaults to design-only non-executing posture', () => {
  const summary = adjudicateOpenClawAdapterStub();
  assert.equal(summary.stubMode, 'design_only');
  assert.equal(summary.stubStatus, 'not_present');
  assert.equal(summary.stubCanExecute, false);
  assert.match(summary.stubNextAction, /create openclaw local adapter stub/i);
});

test('openClaw adapter stub remains non-executing in simulated/local_stub modes', () => {
  const simulated = adjudicateOpenClawAdapterStub({ stubMode: 'simulated' });
  const localOnly = adjudicateOpenClawAdapterStub({ stubMode: 'local_stub', stubStatus: 'health_check_only' });

  assert.equal(simulated.stubCanExecute, false);
  assert.equal(simulated.stubCanInspectOnly, true);
  assert.equal(localOnly.stubCanExecute, false);
  assert.equal(localOnly.stubCanInspectOnly, true);
});
