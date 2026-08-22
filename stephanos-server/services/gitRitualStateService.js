import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getLocalShellConfig } from '../config/localShellConfig.js';

const DIST_PREFIX = 'apps/stephanos/dist/';
const CONFLICT_CODES = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']);

function runGit(args, { cwd, spawnSyncImpl = spawnSync } = {}) {
  const result = spawnSyncImpl('git', args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
  });

  if (result.error) {
    return {
      ok: false,
      status: null,
      stdout: '',
      stderr: String(result.error.message || ''),
    };
  }

  return {
    ok: Number(result.status) === 0,
    status: Number(result.status),
    stdout: String(result.stdout || ''),
    stderr: String(result.stderr || ''),
  };
}

function parseStatusPorcelain(statusOutput = '') {
  const lines = String(statusOutput || '').split('\n').map((line) => line.trimEnd()).filter(Boolean);
  const branchHeader = lines.find((line) => line.startsWith('## ')) || '';
  const statusLines = lines.filter((line) => !line.startsWith('## '));

  let currentBranch = 'unknown';
  let trackingBranch = null;
  let aheadCount = null;
  let behindCount = null;

  if (branchHeader) {
    const branchText = branchHeader.slice(3);
    const [branchAndTracking, trackingStateRaw] = branchText.split(/\s+\[/, 2);
    const [branchRaw, trackingRaw] = branchAndTracking.split('...', 2);
    currentBranch = String(branchRaw || 'unknown').trim() || 'unknown';
    trackingBranch = trackingRaw ? String(trackingRaw).trim() : null;

    const trackingState = String(trackingStateRaw || '').replace(/\]$/, '').trim();
    const aheadMatch = trackingState.match(/ahead\s+(\d+)/i);
    const behindMatch = trackingState.match(/behind\s+(\d+)/i);
    aheadCount = aheadMatch ? Number(aheadMatch[1]) : 0;
    behindCount = behindMatch ? Number(behindMatch[1]) : 0;

    if (branchText.includes('[gone]')) {
      aheadCount = null;
      behindCount = null;
    }
  }

  const changedPaths = [];
  const conflictPaths = [];
  let stagedChangesPresent = false;
  let unstagedChangesPresent = false;
  let untrackedChangesPresent = false;

  for (const line of statusLines) {
    const code = line.slice(0, 2);
    const x = code[0];
    const y = code[1];
    const rawPath = line.length > 3 ? line.slice(3).trim() : '';
    const normalizedPath = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop().trim() : rawPath;

    if (normalizedPath) {
      changedPaths.push(normalizedPath);
    }

    if (code === '??') {
      untrackedChangesPresent = true;
      continue;
    }

    if (x && x !== ' ' && x !== '?') {
      stagedChangesPresent = true;
    }

    if (y && y !== ' ') {
      unstagedChangesPresent = true;
    }

    if (CONFLICT_CODES.has(code)) {
      conflictPaths.push(normalizedPath || rawPath || 'unknown-path');
    }
  }

  const uniqueChangedPaths = Array.from(new Set(changedPaths));
  const uniqueConflictPaths = Array.from(new Set(conflictPaths));
  const distPaths = uniqueChangedPaths.filter((candidate) => candidate.startsWith(DIST_PREFIX));
  const distConflictPaths = uniqueConflictPaths.filter((candidate) => candidate.startsWith(DIST_PREFIX));

  return {
    currentBranch,
    trackingBranch,
    aheadCount,
    behindCount,
    workingTreeDirty: uniqueChangedPaths.length > 0,
    stagedChangesPresent,
    unstagedChangesPresent,
    untrackedChangesPresent,
    changedPaths: uniqueChangedPaths,
    distChanged: distPaths.length > 0,
    distPaths,
    conflictsPresent: uniqueConflictPaths.length > 0,
    conflictPaths: uniqueConflictPaths,
    distConflictsPresent: distConflictPaths.length > 0,
    distConflictPaths,
  };
}

function readGitPath(repoPath, marker, runGitImpl = runGit) {
  const gitPathResult = runGitImpl(['rev-parse', '--git-path', marker], { cwd: repoPath });
  if (!gitPathResult.ok) {
    return null;
  }
  const resolvedPath = String(gitPathResult.stdout || '').trim();
  if (!resolvedPath) {
    return null;
  }
  const absolutePath = path.isAbsolute(resolvedPath) ? resolvedPath : path.resolve(repoPath, resolvedPath);
  return fs.existsSync(absolutePath);
}

export function deriveRitualApplicability(gitTruth = {}) {
  const rebaseInProgress = gitTruth.rebaseInProgress === true;
  const mergeInProgress = gitTruth.mergeInProgress === true;
  const cherryPickInProgress = gitTruth.cherryPickInProgress === true;
  const conflictsPresent = gitTruth.conflictsPresent === true;
  const distConflictsPresent = gitTruth.distConflictsPresent === true;
  const workingTreeDirty = gitTruth.workingTreeDirty === true;
  const behindCount = Number.isFinite(Number(gitTruth.behindCount)) ? Number(gitTruth.behindCount) : null;
  const aheadCount = Number.isFinite(Number(gitTruth.aheadCount)) ? Number(gitTruth.aheadCount) : null;

  const unresolvedFlow = rebaseInProgress || mergeInProgress || cherryPickInProgress;

  const box1Applicable = !unresolvedFlow;
  const box2Applicable = rebaseInProgress && conflictsPresent && distConflictsPresent;
  const box3Applicable = !unresolvedFlow && !conflictsPresent;

  let nextRecommendedAction = 'No ritual step applicable';
  if (box2Applicable) {
    nextRecommendedAction = 'Resolve dist conflict with Box 2';
  } else if (rebaseInProgress && conflictsPresent && !distConflictsPresent) {
    nextRecommendedAction = 'Manual intervention required';
  } else if (box1Applicable && (workingTreeDirty || (behindCount !== null && behindCount > 0))) {
    nextRecommendedAction = 'Run Box 1';
  } else if (box3Applicable && (aheadCount !== null && aheadCount > 0)) {
    nextRecommendedAction = 'Finalize with Box 3';
  }

  let riskLevel = 'low';
  if (conflictsPresent || rebaseInProgress || mergeInProgress || cherryPickInProgress) {
    riskLevel = 'high';
  } else if (workingTreeDirty || (behindCount !== null && behindCount > 0)) {
    riskLevel = 'medium';
  }

  const activeFlowState = rebaseInProgress && conflictsPresent
    ? 'Rebase in progress with conflicts'
    : rebaseInProgress
      ? 'Rebase in progress'
      : mergeInProgress
        ? 'Merge in progress'
        : cherryPickInProgress
          ? 'Cherry-pick in progress'
          : conflictsPresent
            ? 'Conflicts detected'
            : 'No active flow blockers';

  const boxBlockedReasons = {
    box1: box1Applicable ? '' : 'Box 1 is blocked while rebase/merge/cherry-pick flow is active.',
    box2: box2Applicable
      ? ''
      : !rebaseInProgress
        ? 'No rebase in progress.'
        : !conflictsPresent
          ? 'No conflicts detected.'
          : !distConflictsPresent
            ? 'Box 2 is only used when dist conflicts appear during rebase.'
            : 'Box 2 is not applicable for current flow state.',
    box3: box3Applicable
      ? ''
      : conflictsPresent
        ? 'Push is blocked while conflicts remain unresolved.'
        : 'Finalize + push is blocked while active flow state remains unresolved.',
  };

  return {
    pullRebaseApplicable: !unresolvedFlow,
    box1Applicable,
    box2Applicable,
    box3Applicable,
    nextRecommendedAction,
    riskLevel,
    activeFlowState,
    boxBlockedReasons,
  };
}

function createUnknownState(repoPath, reason = 'unknown') {
  const applicability = deriveRitualApplicability({});
  return {
    ok: false,
    reason,
    repoPath,
    currentBranch: 'unknown',
    aheadCount: null,
    behindCount: null,
    trackingBranch: null,
    workingTreeDirty: null,
    stagedChangesPresent: null,
    unstagedChangesPresent: null,
    untrackedChangesPresent: null,
    changedPaths: [],
    distChanged: null,
    distPaths: [],
    rebaseInProgress: null,
    mergeInProgress: null,
    cherryPickInProgress: null,
    conflictsPresent: null,
    conflictPaths: [],
    distConflictsPresent: null,
    pullRebaseApplicable: applicability.pullRebaseApplicable,
    box1Applicable: false,
    box2Applicable: false,
    box3Applicable: false,
    nextRecommendedAction: 'Manual intervention required',
    riskLevel: 'unknown',
    activeFlowState: 'Unknown (ritual state unavailable)',
    boxBlockedReasons: {
      box1: 'Local Git ritual truth is unavailable.',
      box2: 'Local Git ritual truth is unavailable.',
      box3: 'Local Git ritual truth is unavailable.',
    },
    buildLastResult: 'unknown',
    verifyLastResult: 'unknown',
    buildStatusSource: 'unknown',
    verifyStatusSource: 'unknown',
    buildStatusReason: 'No canonical persisted build result is available in this runtime.',
    verifyStatusReason: 'No canonical persisted verify result is available in this runtime.',
  };
}

export function inspectLocalGitRitualState({ env = process.env, runGitImpl = runGit } = {}) {
  const localShellConfig = getLocalShellConfig(env);
  const repoPath = localShellConfig.repoPath;

  const inWorkTree = runGitImpl(['rev-parse', '--is-inside-work-tree'], { cwd: repoPath });
  if (!inWorkTree.ok || String(inWorkTree.stdout || '').trim() !== 'true') {
    return createUnknownState(repoPath, 'not-a-git-work-tree');
  }

  const statusResult = runGitImpl(['status', '--porcelain=v1', '--branch'], { cwd: repoPath });
  if (!statusResult.ok) {
    return createUnknownState(repoPath, 'git-status-unavailable');
  }

  const parsed = parseStatusPorcelain(statusResult.stdout);

  const rebaseMergeExists = readGitPath(repoPath, 'rebase-merge', runGitImpl) === true;
  const rebaseApplyExists = readGitPath(repoPath, 'rebase-apply', runGitImpl) === true;
  const mergeHeadExists = readGitPath(repoPath, 'MERGE_HEAD', runGitImpl) === true;
  const cherryPickHeadExists = readGitPath(repoPath, 'CHERRY_PICK_HEAD', runGitImpl) === true;

  const rebaseInProgress = rebaseMergeExists || rebaseApplyExists;
  const mergeInProgress = mergeHeadExists;
  const cherryPickInProgress = cherryPickHeadExists;

  const derived = deriveRitualApplicability({
    ...parsed,
    rebaseInProgress,
    mergeInProgress,
    cherryPickInProgress,
  });

  return {
    ok: true,
    reason: '',
    repoPath,
    currentBranch: parsed.currentBranch,
    aheadCount: parsed.aheadCount,
    behindCount: parsed.behindCount,
    trackingBranch: parsed.trackingBranch,
    workingTreeDirty: parsed.workingTreeDirty,
    stagedChangesPresent: parsed.stagedChangesPresent,
    unstagedChangesPresent: parsed.unstagedChangesPresent,
    untrackedChangesPresent: parsed.untrackedChangesPresent,
    changedPaths: parsed.changedPaths,
    distChanged: parsed.distChanged,
    distPaths: parsed.distPaths,
    rebaseInProgress,
    mergeInProgress,
    cherryPickInProgress,
    conflictsPresent: parsed.conflictsPresent,
    conflictPaths: parsed.conflictPaths,
    distConflictsPresent: parsed.distConflictsPresent,
    ...derived,
    buildLastResult: 'unknown',
    verifyLastResult: 'unknown',
    buildStatusSource: 'unknown',
    verifyStatusSource: 'unknown',
    buildStatusReason: 'No canonical persisted build result is available in this runtime.',
    verifyStatusReason: 'No canonical persisted verify result is available in this runtime.',
  };
}

export { DIST_PREFIX };
