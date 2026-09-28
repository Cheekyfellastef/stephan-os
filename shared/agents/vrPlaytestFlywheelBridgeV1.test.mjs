import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { ensureSharedWorkspaceLayout } from './sharedAgentWorkspaceStore.mjs';
import {
  analyseAerPlaytestLogV1,
  publishVrPlaytestSessionToFlywheelV1,
  VR_PLAYTEST_EVIDENCE_PACKET_SCHEMA_V1,
} from './vrPlaytestFlywheelBridgeV1.mjs';
import { readVrPlaytestFeed } from '../../stephanos-server/services/vrPlaytestFeedService.js';

const REPO_ROOT = process.cwd();
const NOW = '2026-09-28T14:00:00.000Z';

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value, null, 2) + '\n', 'utf8');
}

test('AER analyser extracts presenter discontinuities without raw-log promotion', () => {
  const analysis = analyseAerPlaytestLogV1([
    'ACTIVE,fault=0,prev=-1,current=-1,delta=0,engine=1,render=1,presenter=1,renderLoop=1,mode=observe',
    'SEQUENCE_FAULT,fault=1,prev=10,current=10,delta=0,prevParity=0,currentParity=0,engine=11,render=11,presenter=10,renderLoop=11,mode=observe',
    'SEQUENCE_FAULT,fault=2,prev=10,current=13,delta=3,prevParity=0,currentParity=1,engine=12,render=12,presenter=13,renderLoop=12,mode=observe',
  ].join('\n'));

  assert.equal(analysis.aerActiveSeen, true);
  assert.equal(analysis.sequenceFaultCount, 2);
  assert.equal(analysis.maxAbsDelta, 3);
  assert.equal(analysis.backwardsOrDuplicateCount, 1);
  assert.equal(analysis.skippedForwardCount, 1);
  assert.equal(analysis.sampleFaults.length, 2);
});

test('completed Starfield AER session fans out to evidence, Flywheel lesson, VR Lab and Starfield Lab projections', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-vr-flywheel-'));
  try {
    const layout = await ensureSharedWorkspaceLayout({ root, repoRoot: REPO_ROOT });
    assert.equal(layout.ok, true);

    const sessionId = 'observe-20260928-140000-001';
    const sessionDir = join(root, 'vr', 'aer-stabilizer', 'sessions', sessionId);
    const sessionPath = join(sessionDir, 'session.json');
    const modeStatePath = join(root, 'vr', 'vr-mode-state-current.json');
    const archiveLogPath = join(sessionDir, 'starfield-aer-stabilizer.log');

    await writeJson(sessionPath, {
      schemaVersion: 'stephanos.starfield-vr-aer-stabilizer-session.v1',
      enteredAtUtc: '2026-09-28T13:55:00.000Z',
      mode: 'OBSERVE',
      expectedBaselineHash: '63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41',
      expectedCustomHash: 'b0046baf0e4487c76d6a7c85c04b338e402f50f7557189e5e46a5b8c0932a76c',
      modeStatePath,
      archiveLogPath,
      gameProcessId: 1234,
    });
    await writeJson(modeStatePath, {
      schemaVersion: 'stephanos.vr-mode-state.v1',
      game: 'Starfield',
      route: 'MutaR / OpenXR',
      stabilizerMode: 'OBSERVE',
      rollback: 'RESTORED',
      restoredHash: '63db15c370d3b8f15faa292a95d5c3abd4c6571cef0d35a45310d998adfeae41',
      updatedAtUtc: NOW,
      observedGameProcessIds: [1234, 2345],
      evidence: {
        protectReady: true,
        protectThreshold: 3,
        archiveError: '',
      },
    });
    await mkdir(dirname(archiveLogPath), { recursive: true });
    await writeFile(archiveLogPath, [
      'ACTIVE,fault=0,prev=-1,current=-1,delta=0,engine=1,render=1,presenter=1,renderLoop=1,mode=observe',
      'SEQUENCE_FAULT,fault=1,prev=10,current=10,delta=0,prevParity=0,currentParity=0,engine=11,render=11,presenter=10,renderLoop=11,mode=observe',
      'SEQUENCE_FAULT,fault=2,prev=10,current=13,delta=3,prevParity=0,currentParity=1,engine=12,render=12,presenter=13,renderLoop=12,mode=observe',
      'SEQUENCE_FAULT,fault=3,prev=13,current=15,delta=2,prevParity=1,currentParity=1,engine=13,render=13,presenter=15,renderLoop=13,mode=observe',
      'SEQUENCE_FAULT,fault=4,prev=15,current=14,delta=-1,prevParity=1,currentParity=0,engine=14,render=14,presenter=14,renderLoop=14,mode=observe',
    ].join('\n') + '\n', 'utf8');

    const first = await publishVrPlaytestSessionToFlywheelV1({
      sessionPath,
      root,
      repoRoot: REPO_ROOT,
      nowMs: Date.parse(NOW),
    });

    assert.equal(first.ok, true);
    assert.equal(first.sequenceFaultCount, 4);
    assert.equal(first.protectReady, true);
    assert.deepEqual(first.promotedLessonIds, [`vr-starfield-aer-${sessionId}`]);

    const packet = JSON.parse(await readFile(
      join(root, 'vr', 'flywheel', 'evidence', `${sessionId}.json`),
      'utf8',
    ));
    assert.equal(packet.schemaVersion, VR_PLAYTEST_EVIDENCE_PACKET_SCHEMA_V1);
    assert.equal(packet.telemetry.sequenceFaultCount, 4);
    assert.equal(packet.modeProgression.protect, 'yellow');
    assert.equal(packet.flywheel.improvementCandidate.gapSource, 'PERFORMANCE_OR_RELIABILITY_GAP');
    assert.equal(packet.authority.goalCreationAllowed, false);

    const lesson = JSON.parse(await readFile(
      join(root, 'lessons', `vr-starfield-aer-${sessionId}.json`),
      'utf8',
    ));
    assert.equal(lesson.engineeringRecord.recordClass, 'AUTOMATION_CANDIDATE');
    assert.equal(lesson.engineeringRecord.status, 'CANDIDATE');
    assert.equal(lesson.mergeAuthority, false);
    assert.equal(lesson.runtimeMutationAllowed, false);

    const feed = await readVrPlaytestFeed({ root, repoRoot: REPO_ROOT, limit: 10 });
    assert.equal(feed.state, 'ready');
    assert.equal(feed.vrResearchLab.latest.sessionId, sessionId);
    assert.equal(feed.starfieldReferenceLab.latest.sessionId, sessionId);
    assert.equal(feed.starfieldReferenceLab.latest.nextMode, 'PROTECT');
    assert.equal(feed.flywheel.learningCandidateCount, 1);
    assert.equal(feed.flywheel.improvementCandidateCount, 1);

    const second = await publishVrPlaytestSessionToFlywheelV1({
      sessionPath,
      root,
      repoRoot: REPO_ROOT,
      nowMs: Date.parse(NOW) + 1000,
    });
    assert.equal(second.ok, true);
    assert.deepEqual(second.promotedLessonIds, []);
    assert.deepEqual(second.skippedLessonIds, [`vr-starfield-aer-${sessionId}`]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
