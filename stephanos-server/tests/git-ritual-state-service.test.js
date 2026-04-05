import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveRitualApplicability, inspectLocalGitRitualState } from '../services/gitRitualStateService.js';

function createRunGitStub(responses) {
  return (args) => {
    const key = args.join(' ');
    const response = responses[key];
    if (!response) {
      return { ok: false, status: 1, stdout: '', stderr: `missing stub for ${key}` };
    }
    return response;
  };
}

test('deriveRitualApplicability only enables box 2 in rebase dist conflict state', () => {
  const state = deriveRitualApplicability({
    rebaseInProgress: true,
    conflictsPresent: true,
    distConflictsPresent: true,
    mergeInProgress: false,
    cherryPickInProgress: false,
    workingTreeDirty: true,
    aheadCount: 0,
    behindCount: 0,
  });

  assert.equal(state.box1Applicable, false);
  assert.equal(state.box2Applicable, true);
  assert.equal(state.box3Applicable, false);
  assert.equal(state.nextRecommendedAction, 'Resolve dist conflict with Box 2');
  assert.equal(state.riskLevel, 'high');
});

test('deriveRitualApplicability blocks box 2 when no rebase is active', () => {
  const state = deriveRitualApplicability({
    rebaseInProgress: false,
    conflictsPresent: true,
    distConflictsPresent: true,
    mergeInProgress: false,
    cherryPickInProgress: false,
    workingTreeDirty: false,
    aheadCount: 2,
    behindCount: 0,
  });

  assert.equal(state.box2Applicable, false);
  assert.equal(state.boxBlockedReasons.box2, 'No rebase in progress.');
  assert.equal(state.box3Applicable, false);
});

test('inspectLocalGitRitualState reports dirty tree and dist conflict applicability truth', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-git-state-'));
  const gitDir = path.join(tempRoot, '.git');
  fs.mkdirSync(gitDir, { recursive: true });
  fs.writeFileSync(path.join(gitDir, 'rebase-merge'), 'active');

  const runGitImpl = createRunGitStub({
    'rev-parse --is-inside-work-tree': { ok: true, status: 0, stdout: 'true\n', stderr: '' },
    'status --porcelain=v1 --branch': {
      ok: true,
      status: 0,
      stdout: [
        '## main...origin/main [ahead 1, behind 2]',
        'UU apps/stephanos/dist/index.html',
        ' M stephanos-ui/src/components/PowerShellMergeConsolePanel.jsx',
      ].join('\n'),
      stderr: '',
    },
    'rev-parse --git-path rebase-merge': { ok: true, status: 0, stdout: `${path.join(gitDir, 'rebase-merge')}\n`, stderr: '' },
    'rev-parse --git-path rebase-apply': { ok: true, status: 0, stdout: `${path.join(gitDir, 'rebase-apply')}\n`, stderr: '' },
    'rev-parse --git-path MERGE_HEAD': { ok: true, status: 0, stdout: `${path.join(gitDir, 'MERGE_HEAD')}\n`, stderr: '' },
    'rev-parse --git-path CHERRY_PICK_HEAD': { ok: true, status: 0, stdout: `${path.join(gitDir, 'CHERRY_PICK_HEAD')}\n`, stderr: '' },
  });

  const result = inspectLocalGitRitualState({
    env: { STEPHANOS_REPO_ROOT: tempRoot },
    runGitImpl,
  });

  assert.equal(result.ok, true);
  assert.equal(result.currentBranch, 'main');
  assert.equal(result.aheadCount, 1);
  assert.equal(result.behindCount, 2);
  assert.equal(result.rebaseInProgress, true);
  assert.equal(result.conflictsPresent, true);
  assert.equal(result.distConflictsPresent, true);
  assert.equal(result.box2Applicable, true);
  assert.equal(result.box3Applicable, false);
  assert.equal(result.nextRecommendedAction, 'Resolve dist conflict with Box 2');
});

test('inspectLocalGitRitualState returns unknown state when repo is unavailable', () => {
  const runGitImpl = createRunGitStub({
    'rev-parse --is-inside-work-tree': { ok: false, status: 128, stdout: '', stderr: 'fatal: not a git repository' },
  });

  const result = inspectLocalGitRitualState({
    env: { STEPHANOS_REPO_ROOT: '/tmp/not-a-repo' },
    runGitImpl,
  });

  assert.equal(result.ok, false);
  assert.equal(result.reason, 'not-a-git-work-tree');
  assert.equal(result.buildLastResult, 'unknown');
  assert.equal(result.box1Applicable, false);
});
