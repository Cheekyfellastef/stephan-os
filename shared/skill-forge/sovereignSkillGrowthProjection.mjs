export const SOVEREIGN_SKILL_GROWTH_VIEW_SCHEMA = 'stephanos.sovereign-skill-growth-view.v1';
const CANONICAL_STATUS = 'sovereign-commander-capability-parity-current';
const COMPILER_SCHEMA = 'stephanos.sovereign-commander-capability-compiler.v1';
const CONJURER_SCHEMA = 'stephanos.sovereign-commander-skill-conjurer.v1';
const MAX_AGE_MS = 15 * 60 * 1000;

function text(value) { return typeof value === 'string' ? value.trim() : ''; }
function empty(state, reason) {
  return Object.freeze({
    schemaVersion: SOVEREIGN_SKILL_GROWTH_VIEW_SCHEMA,
    state, reason, sourceStatusId: CANONICAL_STATUS, capturedAtUtc: '',
    nativeGapCount: 0, remoteGapCount: 0, totalDraftCount: 0,
    visibleDraftCount: 0, draftsTruncated: false, drafts: Object.freeze([]),
    sourceHealth: 'UNKNOWN', constructionActive: false, activationAllowed: false,
    readOnly: true, unknownMeansGreen: false,
  });
}

export function projectSovereignSkillGrowth(feed = {}, { nowUtc = new Date().toISOString() } = {}) {
  if (!feed || typeof feed !== 'object' || !feed.records
    || !Array.isArray(feed.records.statusRecords)) return empty('UNAVAILABLE', 'WORKSPACE_FEED_UNAVAILABLE');
  const status = feed.records.statusRecords.find((record) =>
    record?.statusId === CANONICAL_STATUS
    && record?.kind === 'stephanos.shared_workspace.status'
    && record?.canonicalOwnerGoal === '#2573');
  if (!status) return empty('UNKNOWN', 'SOVEREIGN_SKILL_STATUS_NOT_PUBLISHED');
  const compiler = status.capabilityCompiler;
  if (compiler?.schemaVersion !== COMPILER_SCHEMA || compiler?.skillConjurerSchema !== CONJURER_SCHEMA
    || compiler?.skillForgeActivationAllowed !== false
    || compiler?.automaticCapabilityConstructionAllowed !== false) {
    return empty('INVALID', 'SOVEREIGN_SKILL_COMPILER_CONTRACT_INVALID');
  }
  const captured = Date.parse(text(status.timestampUtc));
  const now = Date.parse(nowUtc);
  const current = Number.isFinite(captured) && Number.isFinite(now)
    && captured <= now + 60_000 && now - captured <= MAX_AGE_MS;
  const safeDrafts = (Array.isArray(compiler.skillForgeCandidates) ? compiler.skillForgeCandidates : [])
    .slice(0, 3)
    .filter((item) => item?.schemaVersion === 'stephanos.sovereign-capability-skill-packet.v1'
      && item?.status === 'DRAFT'
      && item?.canonicalOwnerGoal === '#2573'
      && item?.constructionAdmissionAllowed === false
      && item?.activationAllowed === false
      && item?.executionAllowed === false
      && item?.mergeAuthority === false
      && /^sovereign-skill-[a-z0-9-]+$/.test(text(item.id)))
    .map((item) => Object.freeze({
      id: item.id,
      name: text(item.name).slice(0, 140),
      summary: text(item.plainEnglishSummary).slice(0, 400),
      reason: text(item.whySuggested).slice(0, 400),
      riskLevel: text(item.riskLevel).slice(0, 20),
      permissionLevel: text(item.permissionLevel).slice(0, 50),
      status: 'DRAFT',
      origin: text(item.whySuggested).includes('learning event') ? 'SOVEREIGN_SELF_DISCOVERY' : 'REMOTE_PARITY',
      proposedSteps: Array.isArray(item.recipeSteps) ? item.recipeSteps.length : 0,
      canonicalOwnerGoal: '#2573',
    }));
  const sourceHealth = text(status.nativeGapIntake?.sourceHealth) || 'UNKNOWN';
  const totalDrafts = Number(compiler.skillForgeCandidateTotalCount);
  const nativeGapCount = Number(compiler.nativeGapCandidateCount);
  const remoteGapCount = Number(status.capabilityParity?.buildableGapCount);
  const statusState = feed.state === 'ready' && current
    ? 'CURRENT'
    : !current ? 'STALE' : 'DEGRADED';
  return Object.freeze({
    schemaVersion: SOVEREIGN_SKILL_GROWTH_VIEW_SCHEMA,
    state: statusState,
    reason: statusState === 'CURRENT' ? 'VERIFIED_SHARED_WORKSPACE_STATUS'
      : 'SOURCE_STALE_OR_FEED_DEGRADED',
    sourceStatusId: CANONICAL_STATUS,
    capturedAtUtc: new Date(Number.isFinite(captured) ? captured : 0).toISOString(),
    nativeGapCount: Number.isSafeInteger(nativeGapCount) && nativeGapCount >= 0 ? nativeGapCount : 0,
    remoteGapCount: Number.isSafeInteger(remoteGapCount) && remoteGapCount >= 0 ? remoteGapCount : 0,
    totalDraftCount: Number.isSafeInteger(totalDrafts) && totalDrafts >= 0 ? totalDrafts : 0,
    visibleDraftCount: safeDrafts.length,
    draftsTruncated: compiler.skillForgeCandidatesTruncated === true,
    drafts: Object.freeze(safeDrafts),
    sourceHealth,
    constructionActive: false,
    activationAllowed: false,
    readOnly: true,
    unknownMeansGreen: false,
  });
}
