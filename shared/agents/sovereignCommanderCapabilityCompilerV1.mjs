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

// One canonical compiler, not an additional Skill Forge executor, scheduler or
// command plane. These packets are bounded build proposals, never permissions.
export const SOVEREIGN_COMMANDER_SKILL_CONJURER_SCHEMA =
  'stephanos.sovereign-commander-skill-conjurer.v1';
export const SOVEREIGN_COMMANDER_SKILL_PACKET_SCHEMA =
  'stephanos.sovereign-capability-skill-packet.v1';
export const SOVEREIGN_COMMANDER_SKILL_STATUS_CANDIDATE_LIMIT = 3;


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

const FORBIDDEN_CAPABILITY_PATTERN =
  /(?:^|[-_])(?:arbitrary[-_]?shell|run[-_]?shell|credential[-_]?export|secret[-_]?export|force[-_]?push|destructive[-_]?git|pc[-_]?restart)(?:$|[-_])/i;

function capabilityRisk(primitive) {
  if (primitive === SOVEREIGN_COMMANDER_PRIMITIVE.OBSERVE_DATA
    || primitive === SOVEREIGN_COMMANDER_PRIMITIVE.OBSERVE_RUNTIME
    || primitive === SOVEREIGN_COMMANDER_PRIMITIVE.VERIFY_AND_REPORT) {
    return Object.freeze({ level: 'LOW_MEDIUM', permission: 'PROPOSE_ONLY' });
  }
  return Object.freeze({ level: 'HIGH', permission: 'NEEDS_OPERATOR_APPROVAL' });
}

function skillPacketFromPlan(plan, capability, timestampUtc) {
  const id = plan.capabilityId;
  const blocked = FORBIDDEN_CAPABILITY_PATTERN.test(id);
  const risk = capabilityRisk(plan.primitive);
  const observedCount = Number(capability?.observationCount);
  const observationCount = Number.isSafeInteger(observedCount) && observedCount > 0
    ? Math.min(observedCount, 1_000_000) : 0;
  const permissionLevel = blocked ? 'EXTERNAL_ACTION_BLOCKED' : risk.permission;
  const riskLevel = blocked ? 'BLOCKED' : risk.level;
  const recipeSteps = Object.freeze([
    Object.freeze({
      step: 'REUSE_CANONICAL_PRIMITIVES',
      outcome: 'Identify existing allowlisted Sovereign actions and the smallest necessary composition.',
      proof: 'Canonical primitive IDs and no new general-purpose execution authority.',
    }),
    Object.freeze({
      step: 'PREPARE_BOUNDED_SOURCE_CHANGE',
      outcome: 'Prepare a source-controlled fixed action or recipe only in the existing build lane.',
      proof: 'Exact base/head, one canonical goal, no duplicate lane, and focused source diff.',
    }),
    Object.freeze({
      step: 'PROVE_SAFE_BEHAVIOUR',
      outcome: 'Run deterministic tests, negative permission tests and private/public transport checks.',
      proof: 'Fail closed for arbitrary shell, unapproved mutation, path expansion and missing receipts.',
    }),
    Object.freeze({
      step: 'REVIEW_AND_AUTHORISE',
      outcome: 'Request independent exact-head review and the existing operator approval gates.',
      proof: 'Authenticated review, protection checks and separate operator authorisation.',
    }),
    Object.freeze({
      step: 'VERIFY_RUNTIME_PARITY',
      outcome: 'After approved merge and sync, prove the bounded action on Battle Bridge.',
      proof: 'Correlated terminal DONE receipt, exact source head, proof hash and parity retest.',
    }),
  ]);
  return Object.freeze({
    schemaVersion: SOVEREIGN_COMMANDER_SKILL_PACKET_SCHEMA,
    id: `sovereign-skill-${id}`.slice(0, 150),
    name: `Sovereign capability: ${id}`,
    category: 'Sovereign Commander / Capability Parity',
    status: 'DRAFT',
    permissionLevel,
    riskLevel,
    plainEnglishSummary: `Build a guarded Sovereign Commander equivalent for ${id}, without depending on Remote Desktop Commander.`,
    technicalSummary: plan.strategy,
    whySuggested: capability?.origin === 'sovereign-native-event'
      ? `An existing validated Sovereign Commander learning event reported ${id} as an unmet ability. This is discovery evidence, not implementation proof.`
      : `An existing parity observation classified ${id} as BUILDABLE_GAP.`,
    evidence: Object.freeze([Object.freeze({
      type: capability?.origin === 'sovereign-native-event'
        ? 'canonical-sovereign-learning-event'
        : 'canonical-parity-ledger',
      summary: `#2573 tracked ${observationCount} observation(s); gap is not proof of an executable implementation.`,
    })]),
    benefits: Object.freeze(['Reuse a guarded local ability across Stephanos and chat transports.']),
    allowedTouches: Object.freeze([
      'Existing #2573 source-construction and review fabric for a named bounded recipe.',
      'Existing source-controlled tests and sanitised proof receipts.',
    ]),
    forbiddenTouches: Object.freeze([
      'No arbitrary shell, broad process or file authority, credentials, force-push, or PC restart.',
      'No self-approval, direct live mutation, duplicate controller, scheduler, lease or merge lane.',
      'No source execution or Skill Forge activation from this proposal.',
    ]),
    rollbackPath: 'Discard this draft; any future authorised implementation must retain its own rollback and restore proof.',
    suggestedNextAction: blocked
      ? 'Boundary hold: do not implement this forbidden authority by another name.'
      : 'Use the existing #2573 guarded source-construction lane to design and test; request independent review and operator activation separately.',
    tags: Object.freeze(['sovereign-commander', 'capability-parity', 'codex-handoff']),
    capabilityId: id,
    primitive: plan.primitive,
    recipeId: plan.recipeId,
    canonicalOwnerGoal: '#2573',
    capturedAtUtc: timestampUtc,
    observationCount,
    recipeSteps,
    blockedByPolicy: blocked,
    constructionAdmissionAllowed: false,
    activationAllowed: false,
    executionAllowed: false,
    approvalInherited: false,
    evidenceIsRuntimeProof: false,
    ...safetyBoundary(),
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

export function compileSovereignCommanderCapabilityPlanV1(ledger = {}, { nativeGaps = [] } = {}) {
  const capabilities = Array.isArray(ledger?.capabilities) ? ledger.capabilities : [];
  const timestampUtc = text(ledger?.timestampUtc, new Date().toISOString());
  const remoteBuildable = capabilities.filter((item) => text(item?.state) === 'BUILDABLE_GAP');
  const remoteIds = new Set(remoteBuildable.map((item) => capabilityId(item.capabilityId)));
  // Only our validated native event adapter may inject native capability
  // proposals; they cannot change the Remote parity ledger or become proof.
  const nativeBuildable = (Array.isArray(nativeGaps) ? nativeGaps.slice(0, 2) : [])
    .filter((item) => item?.origin === 'sovereign-native-event'
      && item?.state === 'BUILDABLE_GAP'
      && item?.sourceIsRuntimeParityProof === false
      && /^[a-z][a-z0-9-]{2,79}$/.test(String(item.capabilityId || ''))
      && !remoteIds.has(item.capabilityId))
    .map((item) => Object.freeze({
      capabilityId: item.capabilityId,
      state: 'BUILDABLE_GAP',
      origin: 'sovereign-native-event',
      observationCount: Number.isSafeInteger(item.observationCount)
        ? Math.max(1, Math.min(1_000_000, item.observationCount)) : 1,
    }));
  const buildable = [...remoteBuildable, ...nativeBuildable];
  const plans = buildable.map((capability) => {
    const id = capabilityId(capability.capabilityId);
    const primitive = primitiveFor(id);
    const requiresKernelChange = primitive === SOVEREIGN_COMMANDER_PRIMITIVE.COMPOSE_RECIPE;
    const observationOrigin = capability.origin === 'sovereign-native-event'
      ? 'sovereign-native-event' : 'remote-commander-parity';
    return Object.freeze({
      capabilityId: id,
      observationOrigin,
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

  const capabilityById = new Map(buildable.map((capability) => [
    capabilityId(capability?.capabilityId), capability,
  ]));
  // Shared Workspace status records are capped at 16 KiB. Never let a surge
  // of parity gaps turn the canonical reconcile operation into a failed write.
  // Retain all gap identities in the existing plans; publish only bounded drafts.
  const skillForgeCandidates = Object.freeze(
    plans.slice(0, SOVEREIGN_COMMANDER_SKILL_STATUS_CANDIDATE_LIMIT).map((plan) =>
      skillPacketFromPlan(plan, capabilityById.get(plan.capabilityId), timestampUtc),
    ),
  );
  const blockedSkillCount = skillForgeCandidates.filter((skill) => skill.blockedByPolicy).length;

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
    nativeGapCandidateCount: nativeBuildable.length,
    nativeGapIntakeSource: 'validated-shared-workspace-closed-loop-events',
    primitiveGapCount: primitiveGapIds.length,
    primitiveGapIds: Object.freeze(primitiveGapIds),
    plans: Object.freeze(plans),
    skillConjurerSchema: SOVEREIGN_COMMANDER_SKILL_CONJURER_SCHEMA,
    skillForgeCandidateCount: skillForgeCandidates.length,
    skillForgeCandidateTotalCount: plans.length,
    skillForgeCandidateLimit: SOVEREIGN_COMMANDER_SKILL_STATUS_CANDIDATE_LIMIT,
    skillForgeCandidatesTruncated: plans.length > skillForgeCandidates.length,
    blockedSkillCount,
    skillForgeCandidates,
    skillForgeActivationAllowed: false,
    automaticCapabilityConstructionAllowed: false,
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
