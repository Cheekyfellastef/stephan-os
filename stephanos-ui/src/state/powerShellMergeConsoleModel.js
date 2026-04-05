const RITUAL_PHASE_IDS = Object.freeze(['box1', 'box2', 'box3']);
const PHASE_STATUS_VALUES = Object.freeze(['pending', 'in-progress', 'copied', 'completed']);

const BOX_2_COMMANDS = Object.freeze([
  'git checkout --theirs apps/stephanos/dist/index.html',
  'git checkout --theirs apps/stephanos/dist/stephanos-build.json',
  'git checkout --theirs apps/stephanos/dist/assets/*',
  'npm run stephanos:build',
  'npm run stephanos:verify',
  'git add apps/stephanos/dist',
  'git rebase --continue',
]);

const BOX_3_COMMANDS = Object.freeze([
  'git push origin main',
  'git status',
]);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizePhaseStatus(value) {
  return PHASE_STATUS_VALUES.includes(value) ? value : 'pending';
}

function normalizeMaybeBoolean(value) {
  if (value === true) return true;
  if (value === false) return false;
  return null;
}

function normalizeBuildResult(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === 'success' || normalized === 'failed' || normalized === 'unknown') {
    return normalized;
  }
  return 'unknown';
}

function yesNoUnknown(value) {
  if (value === true) return 'yes';
  if (value === false) return 'no';
  return 'unknown';
}

export function createUnknownRitualTruthSnapshot() {
  return {
    repoPath: 'unknown',
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
    pullRebaseApplicable: null,
    box1Applicable: null,
    box2Applicable: null,
    box3Applicable: null,
    nextRecommendedAction: 'unknown',
    riskLevel: 'unknown',
    activeFlowState: 'unknown',
    boxBlockedReasons: {
      box1: 'Ritual state unavailable.',
      box2: 'Ritual state unavailable.',
      box3: 'Ritual state unavailable.',
    },
    buildLastResult: 'unknown',
    verifyLastResult: 'unknown',
    buildStatusSource: 'unknown',
    verifyStatusSource: 'unknown',
    buildStatusReason: 'unknown',
    verifyStatusReason: 'unknown',
    hostedLimitation: '',
    errorMessage: '',
    truthLoaded: false,
    truthSource: 'unknown',
  };
}

export function createDefaultRitualPhaseState() {
  return {
    box1: 'pending',
    box2: 'pending',
    box3: 'pending',
  };
}

export function normalizeRitualPhaseState(value = {}) {
  return {
    box1: normalizePhaseStatus(value.box1),
    box2: normalizePhaseStatus(value.box2),
    box3: normalizePhaseStatus(value.box3),
  };
}

export function buildRitualBox1Payload(commitMessage, { fallbackCommitMessage = 'YOUR_COMMIT_MESSAGE' } = {}) {
  const normalizedCommitMessage = normalizeText(commitMessage);
  const finalMessage = normalizedCommitMessage || fallbackCommitMessage;
  return [
    'git status',
    'git add .',
    `git commit -m "${finalMessage}"`,
    'git pull --rebase origin main',
  ].join('\n');
}

export function buildRitualBox2Payload() {
  return BOX_2_COMMANDS.join('\n');
}

export function buildRitualBox3Payload() {
  return BOX_3_COMMANDS.join('\n');
}

export function buildFullRitualPayload(commitMessage) {
  return [
    '# PowerShell Ritual — Box 1: Commit + Rebase Start',
    buildRitualBox1Payload(commitMessage),
    '',
    '# PowerShell Ritual — Box 2: Dist Conflict Resolution + Rebuild',
    buildRitualBox2Payload(),
    '',
    '# PowerShell Ritual — Box 3: Finalize + Push',
    buildRitualBox3Payload(),
  ].join('\n');
}

export function applyPhaseCopyTransition(phaseState, copiedPhaseId) {
  const normalized = normalizeRitualPhaseState(phaseState);
  const phaseIndex = RITUAL_PHASE_IDS.indexOf(copiedPhaseId);
  if (phaseIndex < 0) {
    return normalized;
  }

  const next = { ...normalized };
  RITUAL_PHASE_IDS.forEach((phaseId, index) => {
    if (index < phaseIndex && next[phaseId] === 'copied') {
      next[phaseId] = 'completed';
    }
  });

  next[copiedPhaseId] = 'copied';

  const nextPending = RITUAL_PHASE_IDS.find((phaseId, index) => index > phaseIndex && next[phaseId] === 'pending');
  if (nextPending) {
    next[nextPending] = 'in-progress';
  }

  return next;
}

export function applyCommitMessageProgress(phaseState, commitMessage) {
  const normalized = normalizeRitualPhaseState(phaseState);
  if (normalizeText(commitMessage).length === 0) {
    return normalized;
  }
  if (normalized.box1 === 'pending') {
    return {
      ...normalized,
      box1: 'in-progress',
    };
  }
  return normalized;
}

export function resolveRitualRepoPath({ configuredRepoPath = '', fallbackRepoPath = '' } = {}) {
  const configured = normalizeText(configuredRepoPath);
  if (configured) {
    return configured;
  }
  return normalizeText(fallbackRepoPath);
}

export function buildRepoCdCommand(repoPath = '') {
  const safePath = String(repoPath || '').replace(/"/g, '\"');
  return `cd "${safePath}"`;
}

export function isLocalShellLaunchAvailable(runtimeStatusModel = {}) {
  const truth = runtimeStatusModel?.finalRouteTruth || {};
  const sessionKind = String(truth.sessionKind || '').toLowerCase();
  const routeKind = String(truth.routeKind || '').toLowerCase();
  return sessionKind === 'local-desktop' && routeKind === 'local-desktop';
}

export function normalizeGitRitualTruthSnapshot(payload = {}, { hosted = false, errorMessage = '' } = {}) {
  const fallback = createUnknownRitualTruthSnapshot();
  const source = payload && typeof payload === 'object' ? payload : {};
  const boxBlockedReasons = source.boxBlockedReasons && typeof source.boxBlockedReasons === 'object'
    ? {
      box1: normalizeText(source.boxBlockedReasons.box1) || fallback.boxBlockedReasons.box1,
      box2: normalizeText(source.boxBlockedReasons.box2) || fallback.boxBlockedReasons.box2,
      box3: normalizeText(source.boxBlockedReasons.box3) || fallback.boxBlockedReasons.box3,
    }
    : fallback.boxBlockedReasons;

  return {
    ...fallback,
    repoPath: normalizeText(source.repoPath) || fallback.repoPath,
    currentBranch: normalizeText(source.currentBranch) || fallback.currentBranch,
    aheadCount: Number.isFinite(Number(source.aheadCount)) ? Number(source.aheadCount) : null,
    behindCount: Number.isFinite(Number(source.behindCount)) ? Number(source.behindCount) : null,
    trackingBranch: normalizeText(source.trackingBranch) || null,
    workingTreeDirty: normalizeMaybeBoolean(source.workingTreeDirty),
    stagedChangesPresent: normalizeMaybeBoolean(source.stagedChangesPresent),
    unstagedChangesPresent: normalizeMaybeBoolean(source.unstagedChangesPresent),
    untrackedChangesPresent: normalizeMaybeBoolean(source.untrackedChangesPresent),
    changedPaths: Array.isArray(source.changedPaths) ? source.changedPaths.map((value) => normalizeText(value)).filter(Boolean) : [],
    distChanged: normalizeMaybeBoolean(source.distChanged),
    distPaths: Array.isArray(source.distPaths) ? source.distPaths.map((value) => normalizeText(value)).filter(Boolean) : [],
    rebaseInProgress: normalizeMaybeBoolean(source.rebaseInProgress),
    mergeInProgress: normalizeMaybeBoolean(source.mergeInProgress),
    cherryPickInProgress: normalizeMaybeBoolean(source.cherryPickInProgress),
    conflictsPresent: normalizeMaybeBoolean(source.conflictsPresent),
    conflictPaths: Array.isArray(source.conflictPaths) ? source.conflictPaths.map((value) => normalizeText(value)).filter(Boolean) : [],
    distConflictsPresent: normalizeMaybeBoolean(source.distConflictsPresent),
    pullRebaseApplicable: normalizeMaybeBoolean(source.pullRebaseApplicable),
    box1Applicable: normalizeMaybeBoolean(source.box1Applicable),
    box2Applicable: normalizeMaybeBoolean(source.box2Applicable),
    box3Applicable: normalizeMaybeBoolean(source.box3Applicable),
    nextRecommendedAction: normalizeText(source.nextRecommendedAction) || fallback.nextRecommendedAction,
    riskLevel: normalizeText(source.riskLevel).toLowerCase() || fallback.riskLevel,
    activeFlowState: normalizeText(source.activeFlowState) || fallback.activeFlowState,
    boxBlockedReasons,
    buildLastResult: normalizeBuildResult(source.buildLastResult),
    verifyLastResult: normalizeBuildResult(source.verifyLastResult),
    buildStatusSource: normalizeText(source.buildStatusSource).toLowerCase() || fallback.buildStatusSource,
    verifyStatusSource: normalizeText(source.verifyStatusSource).toLowerCase() || fallback.verifyStatusSource,
    buildStatusReason: normalizeText(source.buildStatusReason) || fallback.buildStatusReason,
    verifyStatusReason: normalizeText(source.verifyStatusReason) || fallback.verifyStatusReason,
    hostedLimitation: hosted ? 'Local Git ritual state is only available from the local desktop runtime.' : '',
    errorMessage: normalizeText(errorMessage),
    truthLoaded: source.ok === true,
    truthSource: source.ok === true ? 'local-git' : 'unknown',
  };
}

export function getRitualButtonState(truthSnapshot = createUnknownRitualTruthSnapshot(), { manualOverride = false } = {}) {
  const unknownMode = !truthSnapshot.truthLoaded;

  function deriveBoxState(boxKey, labelWhenBlocked) {
    const applicable = truthSnapshot[`${boxKey}Applicable`];
    const blockedReason = normalizeText(truthSnapshot.boxBlockedReasons?.[boxKey]);
    if (applicable === true) {
      return { enabled: true, reason: '' };
    }
    if (unknownMode) {
      return {
        enabled: manualOverride,
        reason: manualOverride ? 'Truth unavailable. Manual override enabled.' : 'Ritual state unknown. Open Manual Override / Raw Mode.',
      };
    }
    return {
      enabled: false,
      reason: blockedReason || labelWhenBlocked,
    };
  }

  return {
    box1: deriveBoxState('box1', 'Box 1 is not applicable in current flow state.'),
    box2: deriveBoxState('box2', 'Box 2 is not applicable in current flow state.'),
    box3: deriveBoxState('box3', 'Box 3 is not applicable in current flow state.'),
    copyFullRitual: {
      enabled: manualOverride || truthSnapshot.truthLoaded,
      reason: truthSnapshot.truthLoaded ? '' : 'Ritual state unknown. Use manual override for raw copy.',
    },
  };
}

export function formatRitualTruthDisplay(truthSnapshot = createUnknownRitualTruthSnapshot()) {
  return {
    syncState: truthSnapshot.aheadCount === null || truthSnapshot.behindCount === null
      ? 'unknown'
      : `ahead ${truthSnapshot.aheadCount} / behind ${truthSnapshot.behindCount}`,
    workingTree: yesNoUnknown(truthSnapshot.workingTreeDirty) === 'yes' ? 'dirty' : yesNoUnknown(truthSnapshot.workingTreeDirty) === 'no' ? 'clean' : 'unknown',
    staged: yesNoUnknown(truthSnapshot.stagedChangesPresent),
    unstaged: yesNoUnknown(truthSnapshot.unstagedChangesPresent),
    untracked: yesNoUnknown(truthSnapshot.untrackedChangesPresent),
    distChanged: yesNoUnknown(truthSnapshot.distChanged),
    rebase: truthSnapshot.rebaseInProgress === true ? 'active' : yesNoUnknown(truthSnapshot.rebaseInProgress),
    merge: truthSnapshot.mergeInProgress === true ? 'active' : yesNoUnknown(truthSnapshot.mergeInProgress),
    cherryPick: truthSnapshot.cherryPickInProgress === true ? 'active' : yesNoUnknown(truthSnapshot.cherryPickInProgress),
    conflicts: yesNoUnknown(truthSnapshot.conflictsPresent),
    distConflicts: yesNoUnknown(truthSnapshot.distConflictsPresent),
  };
}

export { BOX_2_COMMANDS, BOX_3_COMMANDS, RITUAL_PHASE_IDS, PHASE_STATUS_VALUES };
