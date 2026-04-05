import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommitMessageProgress,
  applyPhaseCopyTransition,
  buildFullRitualPayload,
  buildRitualBox1Payload,
  buildRitualBox2Payload,
  buildRepoCdCommand,
  buildRitualBox3Payload,
  createDefaultRitualPhaseState,
  createUnknownRitualTruthSnapshot,
  isLocalShellLaunchAvailable,
  resolveRitualRepoPath,
} from './powerShellMergeConsoleModel.js';

test('buildRitualBox1Payload injects operator commit message', () => {
  const payload = buildRitualBox1Payload('add mission console ritual panel');
  assert.match(payload, /git commit -m "add mission console ritual panel"/);
  assert.match(payload, /^git status/m);
  assert.match(payload, /git pull --rebase origin main$/m);
});

test('build ritual payloads preserve exact box 2 and box 3 commands', () => {
  assert.equal(
    buildRitualBox2Payload(),
    [
      'git checkout --theirs apps/stephanos/dist/index.html',
      'git checkout --theirs apps/stephanos/dist/stephanos-build.json',
      'git checkout --theirs apps/stephanos/dist/assets/*',
      'npm run stephanos:build',
      'npm run stephanos:verify',
      'git add apps/stephanos/dist',
      'git rebase --continue',
    ].join('\n'),
  );
  assert.equal(buildRitualBox3Payload(), 'git push origin main\ngit status');
});

test('buildFullRitualPayload composes all three ritual boxes', () => {
  const full = buildFullRitualPayload('wire panel');
  assert.match(full, /# PowerShell Ritual — Box 1: Commit \+ Rebase Start/);
  assert.match(full, /git commit -m "wire panel"/);
  assert.match(full, /# PowerShell Ritual — Box 2: Dist Conflict Resolution \+ Rebuild/);
  assert.match(full, /# PowerShell Ritual — Box 3: Finalize \+ Push/);
});

test('phase state transitions advance from copy actions only', () => {
  const start = createDefaultRitualPhaseState();
  const afterBox1 = applyPhaseCopyTransition(start, 'box1');
  assert.equal(afterBox1.box1, 'copied');
  assert.equal(afterBox1.box2, 'in-progress');

  const afterBox2 = applyPhaseCopyTransition(afterBox1, 'box2');
  assert.equal(afterBox2.box1, 'completed');
  assert.equal(afterBox2.box2, 'copied');
  assert.equal(afterBox2.box3, 'in-progress');
});

test('commit message progress sets box1 in-progress without fake completion', () => {
  const progress = applyCommitMessageProgress(createDefaultRitualPhaseState(), 'test commit');
  assert.equal(progress.box1, 'in-progress');
  assert.equal(progress.box2, 'pending');
  assert.equal(progress.box3, 'pending');
});

test('unknown truth snapshot defaults to unknown labels', () => {
  const snapshot = createUnknownRitualTruthSnapshot();
  assert.equal(snapshot.branchLabel, 'unknown');
  assert.equal(snapshot.conflictRisk, 'unknown');
  assert.equal(snapshot.lastBuildStatus, 'unknown');
  assert.equal(snapshot.lastVerifyStatus, 'unknown');
});


test('resolveRitualRepoPath prefers configured value and falls back truthfully', () => {
  assert.equal(resolveRitualRepoPath({ configuredRepoPath: 'D:\Repos\stephan-os', fallbackRepoPath: 'C:\Default' }), 'D:\Repos\stephan-os');
  assert.equal(resolveRitualRepoPath({ configuredRepoPath: '  ', fallbackRepoPath: 'C:\Default' }), 'C:\Default');
});

test('buildRepoCdCommand quotes repo path for PowerShell copy helper', () => {
  assert.equal(buildRepoCdCommand('C:\Users\Stephan Callear\Documents\GitHub\stephan-os'), 'cd "C:\Users\Stephan Callear\Documents\GitHub\stephan-os"');
});

test('isLocalShellLaunchAvailable only allows local-desktop canonical runtime', () => {
  assert.equal(isLocalShellLaunchAvailable({ finalRouteTruth: { sessionKind: 'local-desktop', routeKind: 'local-desktop' } }), true);
  assert.equal(isLocalShellLaunchAvailable({ finalRouteTruth: { sessionKind: 'hosted-web', routeKind: 'cloud' } }), false);
});
