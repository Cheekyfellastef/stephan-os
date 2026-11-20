export const CANONICAL_MISSION_LIFECYCLE = Object.freeze([
  'INTENT',
  'PLANNED',
  'DISPATCHED',
  'BUILDING',
  'VERIFYING',
  'MERGED',
  'LIVE',
  'PROVED',
]);

function asText(value = '') {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function hasAny(text = '', patterns = []) {
  return patterns.some((pattern) => pattern.test(text));
}

function mentionsActiveMission(text = '', activeMissionId = '') {
  const id = asText(activeMissionId).toLowerCase();
  if (!id) return false;
  if (text.includes(id)) return true;
  const numeric = id.match(/(\d+)$/)?.[1] || '';
  if (!numeric) return false;
  return new RegExp(`\\b(?:mission|goal|issue|pr)\\s*#?${numeric}\\b`, 'i').test(text);
}

export function deriveMissionContinuity({ operatorIntent = '', missionWorkflow = {}, missionLineage = {} } = {}) {
  const text = asText(operatorIntent).toLowerCase();
  const activeMissionId = asText(
    missionLineage?.activeMissionId
      || missionWorkflow?.activeMissionId
      || missionWorkflow?.currentMissionId
      || missionWorkflow?.missionId,
  );
  const explicitContinuationCue = hasAny(text, [
    /\bcontinue\b/i,
    /\bkeep going\b/i,
    /\bcarry on\b/i,
    /\bresume\b/i,
    /\bpick (?:it|this|that) back up\b/i,
    /\bover the line\b/i,
    /\bfinish (?:it|this|that|the current|the existing)\b/i,
    /\bcomplete (?:it|this|that|the current|the existing)\b/i,
  ]);
  const continuationCue = explicitContinuationCue || mentionsActiveMission(text, activeMissionId);

  if (activeMissionId && continuationCue) {
    return {
      mode: 'continue-existing',
      confidence: 0.9,
      activeMissionId,
      reason: 'Active mission identity and continuation language are both present.',
    };
  }
  if (activeMissionId) {
    return {
      mode: 'continuation-candidate',
      confidence: 0.65,
      activeMissionId,
      reason: 'An active mission exists, but the operator wording is not an explicit continuation.',
    };
  }
  if (continuationCue) {
    return {
      mode: 'continuation-candidate',
      confidence: 0.55,
      activeMissionId: '',
      reason: 'Continuation language is present, but no active mission identity was supplied to the kernel.',
    };
  }
  return {
    mode: 'new-mission-candidate',
    confidence: 0.8,
    activeMissionId: '',
    reason: 'No active mission identity or continuation cue was supplied.',
  };
}

function sovereignCommanderCapabilityTruth({ finalRouteTruth = {}, finalAgentView = {} } = {}) {
  const explicit = finalRouteTruth?.sovereignCommanderCapability || finalRouteTruth?.sovereignCommander || {};
  const explicitBoolean = [
    finalRouteTruth?.sovereignCommanderAvailable,
    explicit?.available,
    explicit?.ready,
    explicit?.usable,
  ].find((value) => typeof value === 'boolean');
  if (typeof explicitBoolean === 'boolean') {
    return {
      state: explicitBoolean ? 'AVAILABLE' : 'UNAVAILABLE',
      source: 'explicit-route-truth',
    };
  }

  const explicitState = [
    finalRouteTruth?.sovereignCommanderReachableState,
    finalRouteTruth?.sovereignCommanderUsableState,
    explicit?.state,
    explicit?.reachableState,
    explicit?.usableState,
  ].map((value) => asText(value).toLowerCase()).filter(Boolean);
  if (explicitState.some((value) => ['unavailable', 'unreachable', 'blocked', 'offline', 'failed', 'disabled', 'no'].includes(value))) {
    return { state: 'UNAVAILABLE', source: 'explicit-route-truth' };
  }
  if (explicitState.some((value) => ['available', 'reachable', 'ready', 'healthy', 'online', 'open', 'yes'].includes(value))) {
    return { state: 'AVAILABLE', source: 'explicit-route-truth' };
  }

  const visibleAgents = asArray(finalAgentView?.visibleAgents);
  const commander = visibleAgents.find((entry) => asText(entry?.agentId).toLowerCase() === 'sovereign-commander');
  if (commander) {
    if (commander.enabled === false || commander.eligible === false) {
      return { state: 'UNAVAILABLE', source: 'canonical-agent-view' };
    }
    const state = asText(commander.state).toLowerCase();
    const positiveState = ['ready', 'idle', 'acting', 'active', 'watching', 'available'].includes(state);
    if (commander.enabled === true && commander.eligible === true
      && (commander.ready === true || commander.active === true || commander.acting === true || positiveState)) {
      return { state: 'AVAILABLE', source: 'canonical-agent-view' };
    }
  }

  return { state: 'UNKNOWN', source: 'no-capability-proof' };
}

export function deriveShadowRoute({
  operatorIntent = '',
  missionClass = 'analysis',
  targetSubsystems = [],
  finalRouteTruth = {},
  finalAgentView = {},
} = {}) {
  const text = `${asText(operatorIntent)} ${asArray(targetSubsystems).join(' ')} ${asText(missionClass)}`.toLowerCase();
  const candidates = [{
    routeId: 'mission-bridge',
    role: 'intent-and-governance',
    reason: 'Canonical front door for intent, proposal, approval and mission packet truth.',
    executionCandidate: false,
    availability: 'AVAILABLE',
  }];

  const battleBridgeWork = hasAny(text, [
    /battle bridge/i,
    /sovereign commander/i,
    /windows/i,
    /desktop/i,
    /runtime/i,
    /service/i,
    /process/i,
    /telemetry/i,
    /vr/i,
  ]);
  const codeWork = hasAny(text, [
    /build/i,
    /implement/i,
    /fix/i,
    /code/i,
    /repo/i,
    /git/i,
    /test/i,
    /ui/i,
    /integration/i,
    /agent/i,
  ]);
  const improvementWork = hasAny(text, [
    /flywheel/i,
    /improve/i,
    /learn/i,
    /recurring/i,
    /capability gap/i,
  ]);

  if (battleBridgeWork) {
    const commanderTruth = sovereignCommanderCapabilityTruth({ finalRouteTruth, finalAgentView });
    candidates.push({
      routeId: 'sovereign-commander',
      role: 'battle-bridge-hands',
      reason: commanderTruth.state === 'AVAILABLE'
        ? 'Guarded sovereign Battle Bridge capability is currently evidenced.'
        : commanderTruth.state === 'UNAVAILABLE'
          ? 'Sovereign Commander is visible but unavailable; do not prefer it until capability truth recovers.'
          : 'Sovereign Commander capability is unproven; keep it visible without preferring it.',
      executionCandidate: commanderTruth.state === 'AVAILABLE',
      availability: commanderTruth.state,
      availabilitySource: commanderTruth.source,
    });
  }
  if (codeWork) {
    candidates.push({
      routeId: 'guarded-goal-runner',
      role: 'proof-driven-goal-loop',
      reason: 'Existing bounded goal completion loop should own implementation progression rather than a duplicate controller.',
      executionCandidate: true,
      availability: 'AVAILABLE',
    });
    candidates.push({
      routeId: 'builder-fabric',
      role: 'implementation-specialists',
      reason: 'Existing builders/controllers can receive bounded implementation work and return execution receipts.',
      executionCandidate: true,
      availability: 'AVAILABLE',
    });
    candidates.push({
      routeId: 'github-truth',
      role: 'source-and-review-truth',
      reason: 'Repository, PR, exact-head and review state remain source-controlled proof inputs.',
      executionCandidate: false,
      availability: 'AVAILABLE',
    });
  }
  if (improvementWork) {
    candidates.push({
      routeId: 'flywheel',
      role: 'capability-improvement',
      reason: 'Recurring failures and capability gaps belong in the existing improvement loop.',
      executionCandidate: true,
      availability: 'AVAILABLE',
    });
  }

  candidates.push({
    routeId: 'shared-workspace-receipts',
    role: 'execution-truth',
    reason: 'Canonical worker receipts are required before claiming dispatch, progress or completion.',
    executionCandidate: false,
    availability: 'AVAILABLE',
  });

  const preferredExecutionRoute = candidates.find((candidate) => candidate.executionCandidate === true);

  return {
    mode: 'shadow',
    executionAuthorized: false,
    preferredRouteId: preferredExecutionRoute?.routeId || 'mission-bridge',
    preferredRouteBasis: preferredExecutionRoute
      ? 'first-evidenced-execution-candidate'
      : 'no-evidenced-execution-route-fallback-to-mission-bridge',
    candidates,
    externalFallbackPolicy: 'external-or-metered-routes-are-fallback-not-critical-path',
  };
}

export function deriveProofRequirements({ operatorIntent = '', missionClass = 'analysis', buildRelevant = false } = {}) {
  const text = `${asText(operatorIntent)} ${asText(missionClass)}`.toLowerCase();
  const requirements = [
    'operator-intent-preserved',
    'shadow-route-recorded',
    'execution-receipt-required-before-dispatch-or-progress-claim',
    'unknown-state-remains-unknown',
  ];

  if (buildRelevant || missionClass.startsWith('build-')) {
    requirements.push(
      'changed-files-recorded',
      'focused-tests-recorded',
      'build-and-verification-results-recorded',
      'exact-head-source-truth-recorded',
      'approval-boundaries-preserved',
    );
  }
  if (/git|pr|merge|repo|build|fix|implement/i.test(text)) {
    requirements.push('pr-review-and-exact-head-consistency-recorded');
  }
  if (/runtime|battle bridge|service|desktop|windows|telemetry|vr/i.test(text)) {
    requirements.push('runtime-or-battle-bridge-proof-required-before-live-or-proved');
  }

  return unique(requirements);
}

export function buildMissionKernelProjection({
  operatorIntent = '',
  intent = {},
  missionWorkflow = {},
  missionLineage = {},
  finalRouteTruth = {},
  finalAgentView = {},
  missionClass = 'analysis',
  executionMode = 'analysis-only',
  blocked = false,
} = {}) {
  const continuity = deriveMissionContinuity({ operatorIntent, missionWorkflow, missionLineage });
  const shadowRoute = deriveShadowRoute({
    operatorIntent,
    missionClass,
    targetSubsystems: intent?.extractedSubsystems,
    finalRouteTruth,
    finalAgentView,
  });
  const proofRequirements = deriveProofRequirements({
    operatorIntent,
    missionClass,
    buildRelevant: intent?.buildRelevant === true,
  });

  return {
    missionKernelVersion: 'stephanos-do-this-v1',
    canonicalLifecycleState: blocked ? 'INTENT' : 'PLANNED',
    canonicalLifecyclePath: [...CANONICAL_MISSION_LIFECYCLE],
    lifecycleClaimBasis: blocked
      ? 'Intent is not yet safe to plan.'
      : 'Mission packet and shadow route exist; no dispatch is claimed without an execution receipt.',
    missionContinuity: continuity,
    shadowRoute,
    proofRequirements,
    proofDeclaredBeforeExecution: true,
    recoveryPlan: {
      policy: 'replan-before-redispatch',
      triggers: [
        'route-unavailable',
        'worker-stalled-or-heartbeat-stale',
        'exact-head-changed',
        'proof-missing-or-conflicting',
        'capability-gap-detected',
      ],
      fallbackRouteOrder: shadowRoute.candidates.map((candidate) => candidate.routeId),
      scopeWideningAllowed: false,
      operatorJudgementRequiredForScopeWidening: true,
      completionClaimRequiresProof: true,
    },
    modelPolicy: {
      modelNeutral: true,
      selectionOwner: 'stephanos-router',
      qwen35CanaryCompatible: true,
      heavyweightModelMayBeReleasedForGaming: true,
    },
    flywheelUpliftHandoff: {
      enabled: true,
      owner: 'existing-goal-flywheel-and-governed-self-improvement',
      consumerContract: 'stephanos.flywheel-agent-uplift.v1',
      trigger: 'post-execution-receipt-or-calibration-evidence',
      requiredInputs: [
        'participant-identity',
        'mission-id',
        'canonical-execution-receipts',
        'proof-verdict',
        'capability-calibration',
        'operator-intervention-count-when-known',
      ],
      brainAccess: 'stephanos-model-router-when-evidence-requires-diagnosis-or-design',
      goalCreationAllowed: false,
      dispatchAllowed: false,
      promotionAllowed: false,
      authorityWideningAllowed: false,
    },
    shadowRoutingOnly: true,
    executionModeObserved: asText(executionMode),
  };
}
