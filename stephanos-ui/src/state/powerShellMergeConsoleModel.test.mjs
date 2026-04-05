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
  formatRitualTruthDisplay,
  getRitualButtonState,
  isLocalShellLaunchAvailable,
  normalizeGitRitualTruthSnapshot,
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
  assert.equal(snapshot.currentBranch, 'unknown');
  assert.equal(snapshot.riskLevel, 'unknown');
  assert.equal(snapshot.buildLastResult, 'unknown');
  assert.equal(snapshot.verifyLastResult, 'unknown');
});

test('resolveRitualRepoPath prefers configured value and falls back truthfully', () => {
  assert.equal(resolveRitualRepoPath({ configuredRepoPath: 'D:\\Repos\\stephan-os', fallbackRepoPath: 'C:\\Default' }), 'D:\\Repos\\stephan-os');
  assert.equal(resolveRitualRepoPath({ configuredRepoPath: '  ', fallbackRepoPath: 'C:\\Default' }), 'C:\\Default');
});

test('buildRepoCdCommand quotes repo path for PowerShell copy helper', () => {
  assert.equal(buildRepoCdCommand('C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os'), 'cd "C:\\Users\\Stephan Callear\\Documents\\GitHub\\stephan-os"');
});

test('isLocalShellLaunchAvailable only allows local-desktop canonical runtime', () => {
  assert.equal(isLocalShellLaunchAvailable({ finalRouteTruth: { sessionKind: 'local-desktop', routeKind: 'local-desktop' } }), true);
  assert.equal(isLocalShellLaunchAvailable({ finalRouteTruth: { sessionKind: 'hosted-web', routeKind: 'cloud' } }), false);
});

test('normalizeGitRitualTruthSnapshot preserves applicability truth and hosted limitation messaging', () => {
  const snapshot = normalizeGitRitualTruthSnapshot({
    ok: true,
    currentBranch: 'main',
    aheadCount: 1,
    behindCount: 0,
    box1Applicable: true,
    box2Applicable: false,
    box3Applicable: true,
    nextRecommendedAction: 'Finalize with Box 3',
    riskLevel: 'low',
  }, { hosted: false });

  assert.equal(snapshot.truthLoaded, true);
  assert.equal(snapshot.currentBranch, 'main');
  assert.equal(snapshot.nextRecommendedAction, 'Finalize with Box 3');
  assert.equal(snapshot.hostedLimitation, '');
});

test('getRitualButtonState blocks non-applicable boxes and preserves manual override in unknown mode', () => {
  const snapshot = normalizeGitRitualTruthSnapshot({
    ok: true,
    box1Applicable: true,
    box2Applicable: false,
    box3Applicable: false,
    boxBlockedReasons: {
      box2: 'No rebase in progress.',
      box3: 'Push is blocked while conflicts remain unresolved.',
    },
  });

  const truthAware = getRitualButtonState(snapshot, { manualOverride: false });
  assert.equal(truthAware.box1.enabled, true);
  assert.equal(truthAware.box2.enabled, false);
  assert.equal(truthAware.box2.reason, 'No rebase in progress.');

  const unknownManual = getRitualButtonState(createUnknownRitualTruthSnapshot(), { manualOverride: true });
  assert.equal(unknownManual.box1.enabled, true);
  assert.match(unknownManual.box1.reason, /Manual override enabled/);
});

test('formatRitualTruthDisplay renders yes/no/unknown labels for operator cards', () => {
  const display = formatRitualTruthDisplay(normalizeGitRitualTruthSnapshot({
    ok: true,
    aheadCount: 0,
    behindCount: 2,
    workingTreeDirty: true,
    stagedChangesPresent: false,
    unstagedChangesPresent: true,
    untrackedChangesPresent: false,
    distChanged: true,
    rebaseInProgress: true,
    mergeInProgress: false,
    cherryPickInProgress: false,
    conflictsPresent: true,
    distConflictsPresent: true,
  }));

  assert.equal(display.syncState, 'ahead 0 / behind 2');
  assert.equal(display.workingTree, 'dirty');
  assert.equal(display.rebase, 'active');
  assert.equal(display.conflicts, 'yes');
});
