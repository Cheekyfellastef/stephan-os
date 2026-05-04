const TASK_TYPES = new Set([
  'visual-ui',
  'runtime-route',
  'backend-api',
  'data/model',
  'documentation',
  'agent/tooling',
]);

function asText(value = '', fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function uniqueTextList(value) {
  return Array.from(new Set(asArray(value).map((entry) => asText(entry)).filter(Boolean)));
}

const VISUAL_UI_REQUIRED_CHECKS = Object.freeze([
  'intended entry point opens',
  'target surface is visible',
  'primary interaction works',
  'critical browser console errors absent',
  'visible result matches operator intent',
  'fallback state is not mistaken for success',
]);

export function createProofOfDoneChecklist(taskType = 'documentation') {
  const normalizedTaskType = TASK_TYPES.has(taskType) ? taskType : 'documentation';
  const requiredChecks = normalizedTaskType === 'visual-ui' ? [...VISUAL_UI_REQUIRED_CHECKS] : [];
  return {
    taskType: normalizedTaskType,
    requiredChecks,
    checksPassed: [],
    checksPending: requiredChecks,
    checksFailed: [],
    buildVerified: false,
    runtimeVerified: false,
    operatorVisibleProofPending: requiredChecks.length > 0,
    manualVerificationRequired: normalizedTaskType === 'visual-ui',
    proofStatus: requiredChecks.length > 0 ? 'operator_proof_pending' : 'checklist_required',
  };
}

export function adjudicateProofOfDone(input = {}) {
  const taskType = TASK_TYPES.has(input.taskType) ? input.taskType : 'documentation';
  const defaultChecklist = createProofOfDoneChecklist(taskType);
  const requiredChecks = uniqueTextList(input.requiredChecks).length > 0
    ? uniqueTextList(input.requiredChecks)
    : defaultChecklist.requiredChecks;
  const checksPassed = uniqueTextList(input.checksPassed);
  const checksFailed = uniqueTextList(input.checksFailed);
  const checksPending = requiredChecks.filter((check) => !checksPassed.includes(check) && !checksFailed.includes(check));
  const buildVerified = input.buildVerified === true;
  const runtimeVerified = input.runtimeVerified === true;
  const hasFailures = checksFailed.length > 0;
  const operatorVisibleProofPending = requiredChecks.length > 0 && checksPending.length > 0 && !hasFailures;
  const manualVerificationRequired = taskType === 'visual-ui' && (operatorVisibleProofPending || !runtimeVerified);
  const proofStatus = hasFailures
    ? 'blocked'
    : operatorVisibleProofPending
      ? 'operator_proof_pending'
      : runtimeVerified
        ? 'runtime_verified'
        : buildVerified
          ? 'build_verified'
          : 'checklist_required';

  return {
    taskType,
    requiredChecks,
    checksPassed,
    checksPending,
    checksFailed,
    buildVerified,
    runtimeVerified,
    operatorVisibleProofPending,
    manualVerificationRequired,
    proofStatus,
  };
}

export const WORLD_WORKSPACE_PROOF_OF_DONE = Object.freeze({
  taskType: 'visual-ui',
  requiredChecks: [
    'World Tile visible on landing page',
    'World Workspace opens from tile',
    '3D globe visible',
    'rotate/zoom works',
    'layer toggles work',
    'asset click opens truth/detail card',
    'no Failed to resolve module specifier "three" browser error',
    'demo/illustrative truth language visible',
  ],
});
