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

export function createUnknownRitualTruthSnapshot() {
  return {
    branchLabel: 'unknown',
    aheadBehindLabel: 'unknown',
    rebaseIndicator: 'unknown',
    workingStateLabel: 'unknown',
    stagedSummary: 'unknown',
    distChangesDetected: 'unknown',
    conflictRisk: 'unknown',
    lastBuildStatus: 'unknown',
    lastVerifyStatus: 'unknown',
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

export { BOX_2_COMMANDS, BOX_3_COMMANDS, RITUAL_PHASE_IDS, PHASE_STATUS_VALUES };
