import { CLOSED_LOOP_CAPABILITY_EXAM_V1 } from './closedLoopLearningV1.mjs';

export const SOVEREIGN_COMMANDER_CAPABILITY_COMPILER_SCHEMA =
  'stephanos.sovereign-commander-capability-compiler.v1';

export const SOVEREIGN_COMMANDER_PRIMITIVE = Object.freeze({
  OBSERVE_DATA: 'OBSERVE_DATA',
  MUTATE_BOUNDED: 'MUTATE_BOUNDED',
  OBSERVE_RUNTIME: 'OBSERVE_RUNTIME',
  EXECUTE_GUARDED_PROCESS: 'EXECUTE_GUARDED_PROCESS',
  RECOVER_GUARDED: 'RECOVER_GUARDED',
  VERIFY_AND_REPORT: 'VERIFY_AND_REPORT',
  COMPOSE_SOURCE_CONSTRUCTION: 'COMPOSE_SOURCE_CONSTRUCTION',
  COMPOSE_RECIPE: 'COMPOSE_RECIPE',
});

export const SOVEREIGN_COMMANDER_FLYWHEEL_EXAM = CLOSED_LOOP_CAPABILITY_EXAM_V1;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function capabilityId(value) {
  return text(value, 'unknown-capability')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || 'unknown-capability';
}

function primitiveFor(id) {
  if (id === 'source-construction') return SOVEREIGN_COMMANDER_PRIMITIVE.COMPOSE_SOURCE_CONSTRUCTION;
  if (/^(?:read-file|list-directory|start-search|search-files|search-project|get-more-search-results|get-file-info|get-config)$/.test(id)) {
    return SOVEREIGN_COMMANDER_PRIMITIVE.OBSERVE_DATA;
  }
  if (/^(?:write-file|edit-file|edit-block|move-file|create-directory)$/.test(id)) {
    return SOVEREIGN_COMMANDER_PRIMITIVE.MUTATE_BOUNDED;
  }
  if (/^(?:list-processes|get-usage-stats|get-recent-tool-calls|who-am-i|ping)$/.test(id)) {
    return SOVEREIGN_COMMANDER_PRIMITIVE.OBSERVE_RUNTIME;
  }
  if (/^(?:start-process|read-process-output|interact-with-process|list-sessions)$/.test(id)) {
    return SOVEREIGN_COMMANDER_PRIMITIVE.EXECUTE_GUARDED_PROCESS;
  }
  if (/^(?:kill-process|force-terminate|shutdown|repair|restart)/.test(id)) {
    return SOVEREIGN_COMMANDER_PRIMITIVE.RECOVER_GUARDED;
  }
  if (/(?:verify|proof|report|status|acceptance)/.test(id)) {
    return SOVEREIGN_COMMANDER_PRIMITIVE.VERIFY_AND_REPORT;
  }
  return SOVEREIGN_COMMANDER_PRIMITIVE.COMPOSE_RECIPE;
}

function buildStrategy(primitive) {
  if (primitive === SOVEREIGN_COMMANDER_PRIMITIVE.EXECUTE_GUARDED_PROCESS) {
    return 'Prefer a source-controlled process profile or parameter-bounded recipe; never expose arbitrary shell text.';
  }
  if (primitive === SOVEREIGN_COMMANDER_PRIMITIVE.MUTATE_BOUNDED) {
    return 'Compose bounded file/config mutation with exact targets, self-test and proof receipt.';
  }
  if (primitive === SOVEREIGN_COMMANDER_PRIMITIVE.OBSERVE_DATA || primitive === SOVEREIGN_COMMANDER_PRIMITIVE.OBSERVE_RUNTIME) {
    return 'Reuse read-only observation primitives and add a named recipe only when orchestration is reusable.';
  }
  if (primitive === SOVEREIGN_COMMANDER_PRIMITIVE.RECOVER_GUARDED) {
    return 'Add a narrowly scoped recovery recipe with explicit target identity and post-action verification.';
  }
  if (primitive === SOVEREIGN_COMMANDER_PRIMITIVE.VERIFY_AND_REPORT) {
    return 'Compose existing observation plus deterministic verification and Shared Workspace proof publication.';
  }
  if (primitive === SOVEREIGN_COMMANDER_PRIMITIVE.COMPOSE_SOURCE_CONSTRUCTION) {
    return 'Route source construction through the canonical bounded build lane and existing merge/lease authority.';
  }
  return 'Attempt composition from existing guarded primitives first; add one new primitive only if composition is impossible.';
}

function safetyBoundary() {
  return Object.freeze({
    mergeAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
    pcRestartAuthority: false,
    destructiveGitAllowed: false,
    duplicateGoalCreationAllowed: false,
    meterDependencyAccepted: false,
  });
}

function learningCandidate(capability, timestampUtc) {
  const id = capabilityId(capability?.capabilityId);
  const equivalent = text(capability?.sovereignEquivalent, `sovereign-${id}`);
  return Object.freeze({
    lessonId: `sovereign-capability-${id}`.slice(0, 80),
    recordKey: `sovereign-capability-${id}`.slice(0, 80),
    recordClass: 'REUSABLE_METHOD',
    problemClass: 'sovereign-commander-capability-parity',
    componentAndOwnerRefs: Object.freeze([
      '#2573',
      'shared/agents/sovereignCommanderCapabilityParityV1.mjs',
      'shared/agents/sovereignCommanderCapabilityCompilerV1.mjs',
    ]),
    observedAtUtc: timestampUtc,
    repairOrMethod: `Retain ${equivalent} as the guarded Sovereign implementation for Remote Commander capability ${id}; prefer Sovereign Commander and keep Remote Commander break-glass only.`,
    prerequisites: Object.freeze([
      'Parity must be proven before promotion.',
      'Existing approval, merge, shell and destructive-action boundaries must remain unchanged.',
    ]),
    forbiddenShortcuts: Object.freeze([
      'Do not promote an unproven capability gap into durable learning.',
      'Do not gain parity by exposing arbitrary unbounded shell execution.',
    ]),
    failureModes: Object.freeze([
      'Recipe exists without deterministic self-test.',
      'Unit proof passes but Battle Bridge runtime proof is absent.',
      'Capability silently widens operator or merge authority.',
    ]),
    counterexamples: Object.freeze([
      'A Remote Commander call succeeding once is discovery evidence, not Sovereign parity proof.',
    ]),
    testAndProofRefs: Object.freeze(['goal:#2573']),
    runtimeEvidenceRefs: Object.freeze([]),
    confidenceBasis: 'Promoted only after the parity ledger records a BUILDABLE_GAP to PARITY_PRESENT transition.',
    freshness: 'CURRENT',
    applicableDomains: Object.freeze(['sovereign-commander', 'capability-parity']),
    privacyAndSensitivity: 'INTERNAL_BOUNDED',
    status: 'CURRENT',
  });
}

export function compileSovereignCommanderCapabilityPlanV1(ledger = {}) {
  const capabilities = Array.isArray(ledger?.capabilities) ? ledger.capabilities : [];
  const timestampUtc = text(ledger?.timestampUtc, new Date().toISOString());
  const buildable = capabilities.filter((item) => text(item?.state) === 'BUILDABLE_GAP');
  const plans = buildable.map((capability) => {
    const id = capabilityId(capability.capabilityId);
    const primitive = primitiveFor(id);
    const requiresKernelChange = primitive === SOVEREIGN_COMMANDER_PRIMITIVE.COMPOSE_RECIPE;
    return Object.freeze({
      capabilityId: id,
      sovereignEquivalent: text(capability.sovereignEquivalent, `sovereign-${id}`),
      primitive,
      recipeId: `recipe-${id}`.slice(0, 120),
      compilerAction: requiresKernelChange ? 'PROVE_MISSING_PRIMITIVE_THEN_ADD_MINIMUM' : 'COMPOSE_GUARDED_RECIPE',
      requiresKernelChange,
      strategy: buildStrategy(primitive),
      canonicalOwnerGoal: '#2573',
      flywheelEligible: true,
      ...safetyBoundary(),
    });
  });

  const learningCandidates = capabilities
    .filter((item) => item?.newlyProvenParity === true)
    .map((item) => learningCandidate(item, timestampUtc));

  const primitiveGapIds = [...new Set(
    plans.filter((plan) => plan.requiresKernelChange).map((plan) => plan.primitive),
  )].sort();

  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_CAPABILITY_COMPILER_SCHEMA,
    timestampUtc,
    canonicalOwnerGoal: '#2573',
    doctrine: 'PRIMITIVES_FIRST_RECIPES_SECOND_PROOF_BEFORE_LEARNING',
    buildableCapabilityCount: plans.length,
    recipeCandidateCount: plans.length,
    primitiveGapCount: primitiveGapIds.length,
    primitiveGapIds: Object.freeze(primitiveGapIds),
    plans: Object.freeze(plans),
    flywheelExam: SOVEREIGN_COMMANDER_FLYWHEEL_EXAM,
    flywheelImprovementTargetCount: plans.length,
    flywheelImprovementTargets: Object.freeze(plans.map((plan) => Object.freeze({
      capabilityId: plan.capabilityId,
      primitive: plan.primitive,
      strategy: plan.strategy,
      proofRequired: true,
      authorityWideningAllowed: false,
    }))),
    newlyProvenParityCount: learningCandidates.length,
    learningCandidates: Object.freeze(learningCandidates),
    remoteCommanderRole: 'DISCOVERY_AND_BREAK_GLASS',
    sovereignCommanderRole: 'DEFAULT_DURABLE_METER_FREE_PATH',
    ...safetyBoundary(),
    finalVerdict: plans.length > 0
      ? 'SOVEREIGN_COMMANDER_CAPABILITY_COMPILER_WORK_AVAILABLE'
      : 'SOVEREIGN_COMMANDER_CAPABILITY_COMPILER_GREEN',
  });
}
