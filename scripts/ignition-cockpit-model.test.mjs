import test from 'node:test';
import assert from 'node:assert/strict';
import { projectIgnitionCockpit } from './ignition-cockpit-model.mjs';

const goodProof = { healthProbePass: true, runtimeMarkerMatches: true, moduleMimeChecksPass: true };

test('ready requires build, verify, and served runtime proof', () => {
  const cockpit = projectIgnitionCockpit({ buildPassed: true, verifyPassed: true, serverStarted: true, servedProof: goodProof });
  assert.equal(cockpit.trafficLight, 'green');
  assert.equal(cockpit.readyToEnterStephanos, true);
  assert.equal(cockpit.enterStephanosEnabled, true);
});

test('amber state is used when server started but served proof is pending', () => {
  const cockpit = projectIgnitionCockpit({ buildPassed: true, verifyPassed: true, serverStarted: true, servedProof: { healthProbePass: true, runtimeMarkerMatches: null, moduleMimeChecksPass: null } });
  assert.equal(cockpit.trafficLight, 'amber');
  assert.equal(cockpit.readyToEnterStephanos, false);
  assert.match(cockpit.exactNextOperatorAction, /served runtime proof/);
});

test('red state preserves blocker and exact next action', () => {
  const cockpit = projectIgnitionCockpit({ blocker: 'served-runtime-module-mime-mismatch', exactNextOperatorAction: 'Restart 4173 and rerun proof.' });
  assert.equal(cockpit.trafficLight, 'red');
  assert.equal(cockpit.readyToEnterStephanos, false);
  assert.equal(cockpit.exactNextOperatorAction, 'Restart 4173 and rerun proof.');
});

test('stage progress is weighted and tracks transitions', () => {
  const cockpit = projectIgnitionCockpit({ stages: [
    { id: 'source-update', label: 'Source update', weight: 10, status: 'complete' },
    { id: 'build', label: 'Build', weight: 30, status: 'running' },
    { id: 'verify', label: 'Verify', weight: 60, status: 'pending' },
  ] });
  assert.equal(cockpit.progressPercentage, 10);
  assert.equal(cockpit.currentAction, 'Build');
  assert.equal(cockpit.lastCompletedAction, 'Source update');
});

test('splash renders latest-main proof visibly with traffic-light stages', () => {
  const cockpit = projectIgnitionCockpit({
    buildPassed: true,
    verifyPassed: true,
    serverStarted: true,
    servedProof: goodProof,
    sourceUpdateProof: {
      verdict: 'UPDATED',
      runningLatestMain: true,
      localHeadAfter: '3fc4fdf1aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      exactBlocker: '',
    },
    gitBranchIntelligence: { associatedPr: { title: 'Repair shared workspace API test isolation' } },
  });
  assert.equal(cockpit.proofSummary.runningLatestMain, true);
  assert.equal(cockpit.proofSummary.commitShortSha, '3fc4fdf1aaaa');
  assert.equal(cockpit.proofSummary.prTitle, 'Repair shared workspace API test isolation');
  assert.deepEqual(cockpit.stages.map((stage) => stage.label), ['Source update', 'Build Output', 'Verify', 'Runtime']);
  assert.ok(cockpit.stages.every((stage) => ['green', 'amber', 'red', 'blue'].includes(stage.trafficLight)));
});


test('captain status separates latest main build output and runtime proof', () => {
  const cockpit = projectIgnitionCockpit({
    buildPassed: true,
    verifyPassed: true,
    serverStarted: true,
    servedProof: goodProof,
    sourceUpdateProof: { runningLatestMain: true, buildOutputDirty: true, localHeadAfter: 'ffffeeee11112222333344445555666677778888' },
  });
  assert.equal(cockpit.captainStatus, 'RUNNING LATEST MAIN');
  assert.equal(cockpit.captainStatusSummary.buildOutputDirty, true);
  assert.equal(cockpit.captainStatusSummary.runtimeProofReady, true);
  assert.match(cockpit.captainStatusSummary.exactNextAction, /Enter Stephanos/);
});
