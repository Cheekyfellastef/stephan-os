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

export function deriveMissionContinuity({ operatorIntent = '', missionWorkflow = {} } = {}) {
  const text = asText(operatorIntent).toLowerCase();
  const activeMissionId = asText(
    missionWorkflow?.activeMissionId
      || missionWorkflow?.currentMissionId
      || missionWorkflow?.missionId,
  );
  const continuationCue = hasAny(text, [
    /\bcontinue\b/i,
    /\bkeep going\b/i,
    /\bcarry on\b/i,
    /\bresume\b/i,
    /\bfinish\b/i,
    /\bcomplete\b/i,
    /\bover the line\b/i,
    /\bcurrent\b/i,
    /\bexisting\b/i,
    /\bsame\b/i,
    /\bthis\b/i,
    /\bthat\b/i,
    /\b(pr|goal|issue)\s*#?\d+\b/i,
  ]);

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

export function deriveShadowRoute({ operatorIntent = '', missionClass = 'analysis', targetSubsystems = [] } = {}) {
  const text = `${asText(operatorIntent)} ${asArray(targetSubsystems).join(' ')} ${asText(missionClass)}`.toLowerCase();
  const candidates = [{
    routeId: 'mission-bridge',
    role: 'intent-and-governance',
    reason: 'Canonical front door for intent, proposal, approval and mission packet truth.',
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
    candidates.push({
      routeId: 'sovereign-commander',
      role: 'battle-bridge-hands',
      reason: 'Preferred guarded, sovereign and meter-free Battle Bridge execution/observation path when capability is available.',
    });
  }
  if (codeWork) {
    candidates.push({
      routeId: 'guarded-goal-runner',
      role: 'proof-driven-goal-loop',
      reason: 'Existing bounded goal completion loop should own implementation progression rather than a duplicate controller.',
    });
    candidates.push({
      routeId: 'builder-fabric',
      role: 'implementation-specialists',
      reason: 'Existing builders/controllers can receive bounded implementation work and return execution receipts.',
    });
    candidates.push({
      routeId: 'github-truth',
      role: 'source-and-review-truth',
      reason: 'Repository, PR, exact-head and review state remain source-controlled proof inputs.',
    });
  }
  if (improvementWork) {
    candidates.push({
      routeId: 'flywheel',
      role: 'capability-improvement',
      reason: 'Recurring failures and capability gaps belong in the existing improvement loop.',
    });
  }

  candidates.push({
    routeId: 'shared-workspace-receipts',
    role: 'execution-truth',
    reason: 'Canonical worker receipts are required before claiming dispatch, progress or completion.',
  });

  return {
    mode: 'shadow',
    executionAuthorized: false,
    preferredRouteId: candidates[1]?.routeId || 'mission-bridge',
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
  missionClass = 'analysis',
  executionMode = 'analysis-only',
  blocked = false,
} = {}) {
  const continuity = deriveMissionContinuity({ operatorIntent, missionWorkflow });
  const shadowRoute = deriveShadowRoute({
    operatorIntent,
    missionClass,
    targetSubsystems: intent?.extractedSubsystems,
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
