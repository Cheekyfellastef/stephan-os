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
  BLOCKED_HEAD_PROOF_MISSING: 'BLOCKED_HEAD_PROOF_MISSING',
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
const OBSERVED_COMMIT_SHA = /^[a-f0-9]{40}$/i;
const CANONICAL_REMOTE_PATTERNS = Object.freeze([
  /^https:\/\/github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?$/i,
  /^git@github\.com:Cheekyfellastef\/stephan-os(?:\.git)?$/i,
  /^ssh:\/\/git@github\.com\/Cheekyfellastef\/stephan-os(?:\.git)?\/?$/i,
]);
const REMOTE_DIRT_SAMPLE_LIMIT = 2;
const REMOTE_DIRT_SAMPLE_PATH_MAX = 72;
const REMOTE_DIRT_SUMMARY_MAX = 180;
const SAFE_REMOTE_DIRT_PATH = /^(?:[A-Za-z0-9._@+-]+\/)*[A-Za-z0-9._@+-]+$/;
const TOKEN_SHAPED_PATH = /(?:ghp|github_pat|sk(?:-proj)?|xox[baprs]|npm)[-_][A-Za-z0-9_-]{8,}/i;
const AWS_ACCESS_KEY_SHAPED_PATH = /(?:AKIA|ASIA)[A-Z0-9]{16}/i;
const JWT_SHAPED_PATH = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/;

export const DEFAULT_RUNTIME_ONLY_ALLOWLIST = Object.freeze([
  'logs/',
  'tmp/',
  '.cache/',
  'apps/stephanos/dist/',
  'memory/.dreams/',
  'memory/dreaming/deep/',
  'memory/dreaming/light/',
  'memory/dreaming/rem/',
]);

export const DEFAULT_RUNTIME_ONLY_EXACT_STATUS = Object.freeze([
  Object.freeze({
    path: 'stephanos-server/data/memory/durable-memory.json',
    status: ' M',
  }),
]);

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
  const runtimeOnlyAllowlist = options.runtimeOnlyAllowlist ?? DEFAULT_RUNTIME_ONLY_ALLOWLIST;
  const runtimeOnlyExactStatus = options.runtimeOnlyExactStatus ?? DEFAULT_RUNTIME_ONLY_EXACT_STATUS;
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
    const isExactRuntime = runtimeOnlyExactStatus.some((entry) => entry?.path === path && entry?.status === status);
    const isRuntime = isExactRuntime || runtimeOnlyAllowlist.some((prefix) => path.startsWith(prefix));
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

function hasHighEntropyTokenShapedComponent(candidate) {
  return String(candidate || '').split('/').some((component) => {
    const stem = component.replace(/\.[A-Za-z0-9]{1,12}$/i, '');
    if (stem.length < 24) return false;
    if (/^[A-Fa-f0-9]{32,}$/.test(stem)) return true;
    return /^[A-Za-z0-9_-]{24,}$/.test(stem)
      && /[A-Za-z]/.test(stem)
      && /[0-9]/.test(stem);
  });
}

function safeRemoteDirtPath(value) {
  const candidate = String(value ?? '').trim().replace(/\\/g, '/');
  if (!candidate || candidate.length > REMOTE_DIRT_SAMPLE_PATH_MAX) return '';
  if (candidate.startsWith('/') || candidate.includes(':') || candidate.includes('..') || candidate.includes('//')) return '';
  if (!SAFE_REMOTE_DIRT_PATH.test(candidate)) return '';
  if (
    TOKEN_SHAPED_PATH.test(candidate)
    || AWS_ACCESS_KEY_SHAPED_PATH.test(candidate)
    || JWT_SHAPED_PATH.test(candidate)
    || hasHighEntropyTokenShapedComponent(candidate)
  ) return '';
  return candidate;
}

export function buildRemoteDirtBlockerSummary(dirt = {}) {
  const trackedSource = Array.isArray(dirt.trackedSource) ? dirt.trackedSource : [];
  const untrackedSource = Array.isArray(dirt.untrackedSource) ? dirt.untrackedSource : [];
  const unknownCount = Array.isArray(dirt.unknown) ? dirt.unknown.length : 0;
  const runtimeOnlyCount = Array.isArray(dirt.runtimeOnly) ? dirt.runtimeOnly.length : 0;
  const generatedSourceCount = Array.isArray(dirt.generatedSource) ? dirt.generatedSource.length : 0;
  const samples = [];
  let hiddenBlockingCount = 0;
  for (const [kind, values] of [['tracked', trackedSource], ['untracked', untrackedSource]]) {
    for (const value of values) {
      const safePath = safeRemoteDirtPath(value);
      if (!safePath || samples.length >= REMOTE_DIRT_SAMPLE_LIMIT) hiddenBlockingCount += 1;
      else samples.push(`${kind}:${safePath}`);
    }
  }
  const base = 'Resolve or preserve source dirt outside unattended sync.';
  const compactHiddenBlockingCount = hiddenBlockingCount + samples.length;
  const compact = `${base} tracked=${trackedSource.length}; untracked=${untrackedSource.length}; hidden=${compactHiddenBlockingCount}; unknown=${unknownCount}; runtime=${runtimeOnlyCount}; generated=${generatedSourceCount}; samplesRedacted=true`;
  if (samples.length === 0 && hiddenBlockingCount > 0) {
    return compact.length <= REMOTE_DIRT_SUMMARY_MAX ? compact : `${base} diagnosticSamplesRedacted=true`;
  }
  const details = [];
  if (samples.length) details.push(`blockingSamples=[${samples.join('|')}]`);
  if (hiddenBlockingCount) details.push(`hiddenBlockingCount=${hiddenBlockingCount}`);
  if (unknownCount) details.push(`unknownCount=${unknownCount}`);
  if (runtimeOnlyCount) details.push(`runtimeOnlyCount=${runtimeOnlyCount}`);
  if (generatedSourceCount) details.push(`generatedSourceCount=${generatedSourceCount}`);
  const detailed = details.length ? `${base} ${details.join('; ')}` : base;
  if (detailed.length <= REMOTE_DIRT_SUMMARY_MAX) return detailed;
  return compact.length <= REMOTE_DIRT_SUMMARY_MAX ? compact : `${base} diagnosticSamplesRedacted=true`;
}

function remoteMatches(remoteUrl) {
  const candidate = String(remoteUrl ?? '').trim();
  return CANONICAL_REMOTE_PATTERNS.some((pattern) => pattern.test(candidate));
}

function isObservedCommitSha(value) {
  return OBSERVED_COMMIT_SHA.test(String(value ?? '').trim());
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
  if (!remoteMatches(facts.originUrl)) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_REMOTE_MISMATCH, 'Fix origin to the canonical GitHub repository before sync.');
  if (dirt.blocksSync) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE, buildRemoteDirtBlockerSummary(dirt));
  if (facts.fetchOk === false) return blocked(SYNC_CLASSIFICATIONS.BLOCKED_FETCH_FAILED, 'Investigate fetch failure without mutating local source.');
  if (!isObservedCommitSha(facts.localHead) || !isObservedCommitSha(facts.remoteHead)) {
    return blocked(SYNC_CLASSIFICATIONS.BLOCKED_HEAD_PROOF_MISSING, 'Collect concrete local and origin/main commit SHAs before classifying sync state.');
  }
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
  const dirt = evaluation.dirt || {};
  return Object.freeze({
    kind,
    workspaceLocation: 'shared-agent-workspace-external-to-repo',
    localHeadBefore: heads.localHeadBefore ?? heads.localHead ?? null,
    remoteHeadObserved: heads.remoteHeadObserved ?? heads.remoteHead ?? null,
    localHeadAfter: heads.localHeadAfter ?? null,
    classification: evaluation.classification,
    dirtClassification: Object.freeze({
      trackedSourceCount: Array.isArray(dirt.trackedSource) ? dirt.trackedSource.length : 0,
      untrackedSourceCount: Array.isArray(dirt.untrackedSource) ? dirt.untrackedSource.length : 0,
      runtimeOnlyCount: Array.isArray(dirt.runtimeOnly) ? dirt.runtimeOnly.length : 0,
      generatedSourceCount: Array.isArray(dirt.generatedSource) ? dirt.generatedSource.length : 0,
      unknownCount: Array.isArray(dirt.unknown) ? dirt.unknown.length : 0,
      blocksSync: dirt.blocksSync === true,
      pathValuesPublished: false,
      sanitizedBlockingSamplesPublished: evaluation.classification === SYNC_CLASSIFICATIONS.BLOCKED_DIRTY_SOURCE
        && String(evaluation.exactNextAction || '').includes('blockingSamples=['),
    }),
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
