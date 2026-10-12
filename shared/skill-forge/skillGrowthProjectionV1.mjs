// Pure read-only projection. A candidate, a learning event, and an installed skill
// are different claims. Never promote one to another without an explicit receipt.
export const SKILL_GROWTH_OBSERVATORY_SCHEMA = 'stephanos.skill-growth-observatory.v1';
export const SKILL_TRANSFER_ACTORS = Object.freeze([
  { id: 'openclaw-local', label: 'OpenClaw Local', scope: 'Stephanos source and product only' },
  { id: 'stephanos', label: 'Stephanos', scope: 'Orchestration and mission fabric' },
  { id: 'sovereign-commander', label: 'Sovereign Commander', scope: 'Guarded Battle Bridge verbs' },
  { id: 'openclaw-standalone', label: 'OpenClaw Standalone', scope: 'Whole-PC tasks with separate approval' },
]);
const SKILL_STAGES = Object.freeze(['DISCOVER', 'DESIGN', 'TEACH', 'EXAM', 'PROVE', 'REVIEW', 'SHARE', 'ACTIVE']);
const text = (v, fallback = '') => String(v ?? '').trim() || fallback;
const rows = (v) => Array.isArray(v) ? v : [];
const asObject = (v) => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const evidenceRefs = (v) => [...new Set(rows(v).filter(x => typeof x === 'string' && x.trim()).map(x => x.trim()))];
function recentFirst(a, b) {
  const millis = v => { const d = Date.parse(text(v.timestampUtc || v.observedAtUtc || v.checkedAtUtc)); return Number.isFinite(d) ? d : 0; };
  return millis(b) - millis(a);
}
function stageForLearning(learning) {
  switch (learning?.state) {
    case 'TEACHING_REQUIRED': return 'TEACH';
    case 'EXAM_REQUIRED': return 'EXAM';
    case 'PROOF_REQUIRED': return 'PROVE';
    case 'RETRY_READY': return 'REVIEW';
    default: return 'DISCOVER';
  }
}
function actorRecord(records, id) {
  const available = records.filter(record => record?.participantId === id || record?.agentId === id);
  return available[0] || null;
}
// Contracts only: this function does not install, schedule, run, promote or grant permissions.
export function buildSkillTransferAssessmentV1(input = {}) {
  const lesson = asObject(input.learning);
  const source = text(input.sourceActor);
  const target = text(input.targetActor);
  const known = SKILL_TRANSFER_ACTORS.map(a => a.id);
  const checks = Object.freeze({
    knownSource: known.includes(source),
    knownTarget: known.includes(target) && target !== source,
    examPassed: lesson.exam?.passed === true,
    verificationPassed: lesson.verification?.passed === true,
    retained: lesson.state === 'RETRY_READY' && Boolean(lesson.learningCandidate),
    sourceProofPresent: evidenceRefs(lesson.exam?.proofRefs).length > 0
      && evidenceRefs(lesson.verification?.proofRefs).length > 0,
    targetRuntimeProven: input.targetRuntimeProof?.passed === true
      && evidenceRefs(input.targetRuntimeProof?.proofRefs).length > 0,
    scopeReviewPassed: input.scopeReview?.passed === true
      && evidenceRefs(input.scopeReview?.proofRefs).length > 0,
    operatorApprovalPresent: input.operatorApproval?.approved === true
      && evidenceRefs(input.operatorApproval?.proofRefs).length > 0,
  });
  const blockers = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  return Object.freeze({
    schemaVersion: 'stephanos.skill-transfer-assessment.v1',
    source, target, checks, blockers,
    eligibleForExistingApprovedActivationRoute: blockers.length === 0,
    activated: false, // Even an eligible transfer must enter the existing guarded executor.
    canWrite: false,
    canGrantPermissions: false,
    canExecute: false,
    verdict: blockers.length ? 'NOT_PROVEN_FOR_TARGET' : 'READY_FOR_EXISTING_APPROVAL_BOUNDARY',
  });
}
export function deriveSkillGrowthObservatoryV1({ payload = {}, seedSkills = [], runtimeStatusModel = null, nowUtc = new Date().toISOString() } = {}) {
  const feed = asObject(payload);
  const records = asObject(feed.records);
  const eventRecords = rows(records.eventRecords).slice().sort(recentFirst);
  const statusRecords = rows(records.statusRecords).slice().sort(recentFirst);
  const capabilityRecords = rows(records.capabilityRecords).slice().sort(recentFirst);
  const skillRecords = capabilityRecords.filter(record =>
    record?.skillForge?.skillId && record?.skillForge?.schemaVersion === 'stephanos.skill-provenance.v1');
  const learningEvents = eventRecords
    .filter(record => record?.closedLoopLearning?.schemaVersion === 'stephanos.closed-loop-learning.v1')
    .map(record => {
      const learning = record.closedLoopLearning;
      return Object.freeze({
        id: text(record.eventId || learning.eventId, learning.capabilityId),
        capability: text(learning.capabilityId, 'UNKNOWN'),
        teacher: text(learning.teacherId, 'UNKNOWN'),
        stage: stageForLearning(learning),
        learningState: learning.state,
        verified: learning.state === 'RETRY_READY' && learning.exam?.passed === true
          && learning.verification?.passed === true && Boolean(learning.learningCandidate),
        summary: text(record.summary || record.eventKind, 'Capability learning event'),
        timestampUtc: text(record.timestampUtc || record.observedAtUtc, 'UNKNOWN'),
        proofRefs: evidenceRefs(learning.verification?.proofRefs),
      });
    });
  // Read-only conjuration: typed capability gaps become *reviewable drafts*,
  // not code, installed skills or an automatic privilege escalation.
  const sovereignStatus = statusRecords.find((record) =>
    record?.kind === 'stephanos.shared_workspace.status'
      && record?.statusId === 'sovereign-commander-capability-parity-current'
      && record?.canonicalOwnerGoal === '#2573');
  const sovereignCompiler = asObject(sovereignStatus?.capabilityCompiler);
  const sovereignContractValid = sovereignCompiler.schemaVersion === 'stephanos.sovereign-commander-capability-compiler.v1'
    && sovereignCompiler.skillConjurerSchema === 'stephanos.sovereign-commander-skill-conjurer.v1'
    && sovereignCompiler.skillForgeActivationAllowed === false
    && sovereignCompiler.automaticCapabilityConstructionAllowed === false;
  const sovereignAt = Date.parse(text(sovereignStatus?.timestampUtc));
  const observationAt = Date.parse(nowUtc);
  const sovereignFresh = sovereignContractValid && text(feed.state).toLowerCase() === 'ready'
    && Number.isFinite(sovereignAt) && Number.isFinite(observationAt)
    && sovereignAt <= observationAt + 60000 && observationAt - sovereignAt <= 900000;
  // These are canonically produced BUILDABLE_GAP drafts, never installed
  // capabilities. A stale report may be inspected but never shown as ready.
  const sovereignDrafts = sovereignContractValid
    ? rows(sovereignCompiler.skillForgeCandidates).slice(0, 3).filter((draft) =>
      draft?.schemaVersion === 'stephanos.sovereign-capability-skill-packet.v1'
      && draft?.status === 'DRAFT'
      && draft?.canonicalOwnerGoal === '#2573'
      && draft?.activationAllowed === false
      && draft?.executionAllowed === false
      && draft?.constructionAdmissionAllowed === false
      && draft?.mergeAuthority === false
      && /^sovereign-skill-[a-z0-9-]+$/.test(text(draft.id))
    ).map((draft) => Object.freeze({
      id: draft.id,
      name: text(draft.name).slice(0, 140),
      category: 'Sovereign Commander guarded draft',
      status: 'DRAFT',
      riskLevel: text(draft.riskLevel, 'HIGH'),
      permissionLevel: text(draft.permissionLevel, 'NEEDS_OPERATOR_APPROVAL'),
      plainEnglishSummary: text(draft.plainEnglishSummary).slice(0, 400),
      whySuggested: text(draft.whySuggested).slice(0, 400),
      allowedTouches: ['Canonical #2573 bounded design and independent review only'],
      forbiddenTouches: ['No execution, activation, shell, force-push, merge, credentials or self-approval'],
      rollbackPath: 'Discard unactivated draft; no live runtime mutation has occurred.',
      evidence: [{ type: 'canonical-skill-conjurer', summary: 'Shared Workspace status; runtime capability not proven' }],
      tags: ['sovereign-commander', 'codex-handoff'],
      provenance: sovereignFresh ? 'SOVEREIGN_GUARDED_DRAFT_NOT_INSTALLED'
        : 'SOVEREIGN_STALE_DRAFT_NOT_INSTALLED',
    })) : [];

  const learnedDrafts = [...new Map(learningEvents.map(event => [event.capability, Object.freeze({
    id: 'learned-' + event.capability.replace(/[^a-z0-9-]/g, '-').slice(0, 70),
    name: 'Conjure skill: ' + event.capability,
    category: 'Closed-loop capability draft',
    status: 'DRAFT',
    riskLevel: 'MEDIUM',
    permissionLevel: 'PROPOSE_ONLY',
    plainEnglishSummary: 'Proposed reusable method for ' + event.capability + '.',
    whySuggested: event.summary + ' · Teacher: ' + event.teacher,
    allowedTouches: ['Knowledge proposal and proof review only'],
    forbiddenTouches: [
      'No direct execution, installs, shell access, deployments, merges or new tool grants.',
      'No publishing to another agent without target-specific proof and operator review.',
    ],
    rollbackPath: 'Discard the draft; existing runtime state is unchanged.',
    evidence: event.proofRefs.map(ref => ({ type: 'closed-loop-proof', summary: ref })),
    tags: ['openclaw-related', 'troubleshooting'],
    provenance: 'LEARNING_DRAFT_NOT_INSTALLED',
    learningState: event.learningState,
  })])).values()];
  const skillCandidates = [
    ...rows(seedSkills).map(skill => ({ ...skill, provenance: 'STATIC_SEED_NOT_INSTALLED' })),
    ...learnedDrafts,
    ...sovereignDrafts,
  ];
  const publishedSkills = skillRecords.map(record => ({
    id: record.skillForge.skillId,
    name: text(record.skillForge.name, record.skillForge.skillId),
    source: 'shared-workspace-provenance',
    status: text(record.skillForge.status, 'UNKNOWN'),
    provenanceRefs: evidenceRefs(record.skillForge.proofRefs),
    allowedTargets: rows(record.skillForge.allowedTargets),
    targetRuntimeProofs: rows(record.skillForge.targetRuntimeProofs).map(proof => ({
      actorId: text(proof?.actorId),
      passed: proof?.passed === true,
      installedRevision: text(proof?.installedRevision),
      operatorApprovalRef: text(proof?.operatorApprovalRef),
      proofRefs: evidenceRefs(proof?.proofRefs),
    })),
    timestampUtc: text(record.timestampUtc, 'UNKNOWN'),
  }));
  const stages = SKILL_STAGES.map(stage => ({
    id: stage,
    count: learningEvents.filter(event => event.stage === stage).length
      + publishedSkills.filter(skill => skill.status === stage).length,
  }));
  const observedActors = SKILL_TRANSFER_ACTORS.map(actor => {
    const heartbeat = actorRecord(statusRecords, actor.id);
    const actorProof = publishedSkills.filter(skill => skill.allowedTargets.includes(actor.id)
      && skill.provenanceRefs.length > 0
      && skill.status === 'ACTIVE'
      && skill.targetRuntimeProofs.some(proof => proof.actorId === actor.id
        && proof.passed && proof.installedRevision && proof.operatorApprovalRef
        && proof.proofRefs.length > 0));
    return Object.freeze({
      ...actor,
      runtime: heartbeat ? text(heartbeat.runtimeState || heartbeat.processState, 'UNPROVEN') : 'UNKNOWN',
      evidenceAt: heartbeat ? text(heartbeat.timestampUtc, 'UNKNOWN') : 'UNKNOWN',
      skillCount: actorProof.length,
      skillProof: actorProof.map(skill => skill.id),
      learningCount: learningEvents.filter(event => event.teacher === actor.id).length,
    });
  });
  const lastLearning = learningEvents[0] || null;
  const latestRuntime = runtimeStatusModel?.runtimeContext || {};
  const feedReadable = ['ready', 'stale'].includes(text(feed.state).toLowerCase());
  return Object.freeze({
    schemaVersion: SKILL_GROWTH_OBSERVATORY_SCHEMA,
    source: 'Shared Workspace dashboard-feed · full-history',
    sourceTruth: !feedReadable ? 'UNAVAILABLE' : feed.state === 'stale' ? 'STALE' : 'REPORTED',
    reason: text(feed.reason, 'No verified Shared Workspace response'),
    nextAction: text(feed.exactNextAction, 'Verify the Shared Workspace backend connection.'),
    skillCandidates,
    publishedSkills, learningEvents, stages, observedActors,
    timeline: learningEvents.slice(0, 16),
    summary: Object.freeze({
      proposals: skillCandidates.length,
      sovereignDrafts: sovereignDrafts.length,
      sovereignNativeGaps: sovereignContractValid ? Math.max(0, Number(sovereignCompiler.nativeGapCandidateCount) || 0) : 0,
      sovereignParityGaps: sovereignContractValid ? Math.max(0, Number(sovereignStatus?.capabilityParity?.buildableGapCount) || 0) : 0,
      sovereignStatusTruth: !sovereignContractValid ? 'UNKNOWN' : sovereignFresh ? 'CURRENT' : 'STALE',
      witnessedLearning: learningEvents.length,
      verifiedLessons: learningEvents.filter(event => event.verified).length,
      publishedSkillRecords: publishedSkills.length,
      provenActiveTargets: observedActors.filter(actor => actor.skillCount > 0).length,
      currentSourceRecords: statusRecords.length,
    }),
    latestLearning: lastLearning,
    backendRoute: text(latestRuntime.homeNodeBridge?.backendUrl, 'Not published'),
    policy: Object.freeze({
      autoInstall: false,
      autoGrant: false,
      autoMerge: false,
      autoExecute: false,
      knowledgeSharingMayBeProposed: true,
      eachTargetRequiresSeparateProof: true,
    }),
  });
}
