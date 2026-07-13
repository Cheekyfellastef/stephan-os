export const CANONICAL_SYNC_CONTRACT = Object.freeze({
  repositoryIdentity: 'Cheekyfellastef/stephan-os',
  canonicalWindowsCheckout: '%USERPROFILE%\\Documents\\GitHub\\stephan-os',
  branch: 'main',
  remote: 'origin',
  performsShellExecution: false,
  installsScheduledTask: false,
});

export const SYNC_CLASSIFICATIONS = Object.freeze({
  SYNC_NO_CHANGE: 'SYNC_NO_CHANGE',
  SYNC_FAST_FORWARD_READY: 'SYNC_FAST_FORWARD_READY',
  SYNC_FAST_FORWARD_APPLIED: 'SYNC_FAST_FORWARD_APPLIED',
  BLOCKED_DIRTY_SOURCE: 'BLOCKED_DIRTY_SOURCE',
  BLOCKED_NON_MAIN_BRANCH: 'BLOCKED_NON_MAIN_BRANCH',
  BLOCKED_REMOTE_MISMATCH: 'BLOCKED_REMOTE_MISMATCH',
  BLOCKED_DIVERGED_HISTORY: 'BLOCKED_DIVERGED_HISTORY',
  BLOCKED_FETCH_FAILED: 'BLOCKED_FETCH_FAILED',
  BLOCKED_FAST_FORWARD_FAILED: 'BLOCKED_FAST_FORWARD_FAILED',
  BLOCKED_POST_SYNC_REFRESH_REQUIRED: 'BLOCKED_POST_SYNC_REFRESH_REQUIRED',
  BLOCKED_RUNTIME_PROOF_FAILED: 'BLOCKED_RUNTIME_PROOF_FAILED',
  BLOCKED_INSTALL_OR_PERMISSION_REQUIRED: 'BLOCKED_INSTALL_OR_PERMISSION_REQUIRED',
});

export const FIXED_GIT_COMMANDS = Object.freeze({
  fetchOriginMain: Object.freeze({
    id: 'git-fetch-origin-main',
    executable: 'git',
    argv: Object.freeze(['fetch', '--prune', 'origin', 'main']),
    performsGitMutation: false,
    performsShellExecution: false,
  }),
  mergeFfOnlyOriginMain: Object.freeze({
    id: 'git-merge-ff-only-origin-main',
    executable: 'git',
    argv: Object.freeze(['merge', '--ff-only', 'origin/main']),
    performsGitMutation: true,
    performsShellExecution: false,
  }),
});

const UNSAFE_GIT_WORDS = new Set(['checkout', 'reset', 'clean', 'stash', 'rebase', 'push', 'branch', 'switch']);

export const POST_SYNC_REFRESH_REGISTRY = Object.freeze({
  'refresh-shared-workspace': Object.freeze({ id: 'refresh-shared-workspace', requiresSourceChange: false, rawCommand: null }),
  'refresh-ui-runtime': Object.freeze({ id: 'refresh-ui-runtime', requiresSourceChange: true, rawCommand: null }),
  'restart-approved-services': Object.freeze({ id: 'restart-approved-services', requiresSourceChange: true, rawCommand: null }),
  'run-exact-head-proof': Object.freeze({ id: 'run-exact-head-proof', requiresSourceChange: true, rawCommand: null }),
});

export function getFixedGitCommand(id) {
  const command = Object.values(FIXED_GIT_COMMANDS).find((candidate) => candidate.id === id);
  if (!command) throw new Error(`Unsupported Git command identity: ${id}`);
  if (command.argv.some((word) => UNSAFE_GIT_WORDS.has(word))) throw new Error(`Unsafe Git command identity rejected: ${id}`);
  return command;
}

export function rejectArbitraryShellPlan(plan) {
  if (!plan || typeof plan !== 'object') throw new Error('Command plan must be an object');
  if ('command' in plan || 'shell' in plan || 'powershell' in plan || 'script' in plan) {
    throw new Error('Arbitrary shell/PowerShell/workspace command execution is forbidden');
  }
  return getFixedGitCommand(plan.id);
}

export function classifyDirt(statusLines = [], options = {}) {
  const runtimeOnlyAllowlist = options.runtimeOnlyAllowlist ?? ['logs/', 'tmp/', '.cache/', 'apps/stephanos/dist/'];
  const generatedSourceAllowlist = options.generatedSourceAllowlist ?? [];
  const result = {
    trackedSource: [],
    untrackedSource: [],
    runtimeOnly: [],
    generatedSource: [],
    unknown: [],
    blocksSync: false,
  };
  for (const raw of statusLines) {
    if (!raw || !raw.trim()) continue;
    const status = raw.slice(0, 2);
    const path = raw.slice(3).trim();
    const isRuntime = runtimeOnlyAllowlist.some((prefix) => path.startsWith(prefix));
    const isGenerated = generatedSourceAllowlist.some((prefix) => path.startsWith(prefix));
    if (!path) result.unknown.push(raw);
    else if (isRuntime) result.runtimeOnly.push(path);
    else if (isGenerated) result.generatedSource.push(path);
    else if (status === '??') result.untrackedSource.push(path);
    else if (/^[ MADRCU?!]{2}$/.test(status)) result.trackedSource.push(path);
    else result.unknown.push(raw);
  }
  result.blocksSync = result.trackedSource.length > 0 || result.untrackedSource.length > 0 || result.unknown.length > 0;
  return result;
}

function remoteMatches(remoteUrl) {
  return /(^|[:/])Cheekyfellastef\/stephan-os(\.git)?$/i.test(String(remoteUrl ?? '').replace(/\/$/, ''));
}

export function evaluateSyncPolicy(facts) {
  const dirt = classifyDirt(facts.statusLines ?? [], facts);
  const blocked = (classification, exactNextAction) => ({
    classification,
    dirt,
    operatorNeeded: true,
    exactNextAction,
    performsGitMutation: false,
    performsShellExecution: false,
  });
  if (facts.currentBranch !== CANONICAL_SYNC_CONTRACT.branch) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_NON_MAIN_BRANCH, 'Return canonical checkout to main before sync.');
  if (!remoteMatches(facts.originUrl)) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_REMOTE_MISMATCH, 'Fix origin to Cheekyfellastef/stephan-os before sync.');
  if (dirt.blocksSync) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE, 'Resolve or preserve source dirt outside unattended sync.');
  if (facts.fetchOk === false) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_FETCH_FAILED, 'Investigate fetch failure without mutating local source.');
  if (facts.localHead === facts.remoteHead) return { classification: SYNC_CLASSIFICATIONS.SYNC_NO_CHANGE, dirt, operatorNeeded: false, exactNextAction: 'No source update required.', performsGitMutation: false, performsShellExecution: false };
  if (facts.mergeBase !== facts.localHead) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_DIVERGED_HISTORY, 'Operator must resolve non-fast-forward history.');
  if (facts.mergeAttempted && facts.mergeOk === false) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_FAST_FORWARD_FAILED, 'Inspect failed git merge --ff-only origin/main.');
  if (facts.applied) {
    if (facts.localHeadAfter !== facts.remoteHead || facts.localHeadBefore !== facts.localHead) throw new Error('Applied receipt requires exact before/remote/after correlation');
    if (!facts.exactHeadProofOk) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_RUNTIME_PROOF_FAILED, 'Run exact-head proof before reporting completion.');
    if (facts.postSyncRefreshRequired && !facts.postSyncRefreshOk) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_POST_SYNC_REFRESH_REQUIRED, 'Run allowlisted post-sync refresh plan.');
    return { classification: SYNC_CLASSIFICATIONS.SYNC_FAST_FORWARD_APPLIED, dirt, operatorNeeded: false, exactNextAction: 'Publish receipt with exact-head proof refs.', performsGitMutation: true, performsShellExecution: false };
  }
  return { classification: SYNC_CLASSIFICATIONS.SYNC_FAST_FORWARD_READY, dirt, operatorNeeded: false, exactNextAction: 'Run fixed git merge --ff-only origin/main after approval gate.', performsGitMutation: true, performsShellExecution: false };
}

function boundedRecord(kind, evaluation, heads = {}, proofRefs = []) {
  return Object.freeze({
    kind,
    workspaceLocation: 'shared-agent-workspace-external-to-repo',
    localHeadBefore: heads.localHeadBefore ?? heads.localHead ?? null,
    remoteHeadObserved: heads.remoteHeadObserved ?? heads.remoteHead ?? null,
    localHeadAfter: heads.localHeadAfter ?? null,
    classification: evaluation.classification,
    dirtClassification: evaluation.dirt,
    operatorNeeded: evaluation.operatorNeeded,
    exactNextAction: evaluation.exactNextAction,
    performsGitMutation: evaluation.performsGitMutation,
    performsShellExecution: false,
    proofRefs,
  });
}

export const buildSharedWorkspaceHeartbeat = (evaluation, heads, proofRefs) => boundedRecord('battle-bridge-github-sync-heartbeat', evaluation, heads, proofRefs);
export const buildSharedWorkspacePlan = (evaluation, heads, proofRefs) => boundedRecord('battle-bridge-github-sync-plan', evaluation, heads, proofRefs);
export const buildSharedWorkspaceBlocker = (evaluation, heads, proofRefs) => boundedRecord('battle-bridge-github-sync-blocker', evaluation, heads, proofRefs);
export const buildSharedWorkspaceReceipt = (evaluation, heads, proofRefs) => boundedRecord('battle-bridge-github-sync-receipt', evaluation, heads, proofRefs);
