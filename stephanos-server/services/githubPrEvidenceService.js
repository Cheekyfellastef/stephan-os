import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { resolveGithubAuth, resolveGithubGhCliAuth } from './githubAuthResolver.js';
import { externalMergeCandidateV1, EXTERNAL_MERGE_OBSERVATION_SCHEMA, validateExternalMergeObservationV1 } from '../../shared/agents/externalMergeObservationV1.mjs';
import { readBrokeredGithubRateLimitHold, recordBrokeredGithubRateLimitHold } from '../../shared/agents/githubObservationBrokerV1.mjs';
import {
  PROTECTED_APPROVAL_MARKER,
  extractJsonObjects,
  projectProtectedApprovalReceiptForWorkspace,
} from '../../shared/agents/operatorMergeApprovalGate.mjs';
import { projectCanonicalResourceIds } from '../../shared/agents/elasticBuildCapacityV1.mjs';
import { evaluateOperatorLaneContainmentV1, OPERATOR_LANE_CONTAINMENT_MARKER,
  validateOperatorLaneContainmentCommandV1 } from '../../shared/agents/operatorLaneContainmentV1.mjs';
import { projectGoalAdmissionRequiredTestsV1, projectPrimaryOwnerCommentReadRequirementV1, goalEstateCoversPrimaryOwnerCommentReadV1 } from '../../shared/agents/goalAdmissionRequiredTestsV1.mjs';
import { projectSeedSourceAssociationV1 } from '../../shared/runtime/seedGrowthWorkV1.mjs';

export const GITHUB_GOAL_ADMISSION_SCHEMA = 'stephanos.github-goal-admission.v1';
export const GITHUB_GOAL_ADMISSION_MARKER = 'stephanos-goal-admission-v1';

const GITHUB_GOAL_ADMISSION_KEYS = new Set([
  'arbitraryShellAllowed', 'deploymentAuthority', 'issueNumber', 'mergeAuthority', 'prerequisites',
  'repository', 'resourceIds', 'requiredTests', 'route', 'runtimeMutationAuthority', 'schemaVersion', 'sourceImplementationAllowed', 'state',
]);
const GITHUB_GOAL_ESTATE_CACHE_TTL_MS = 5 * 60 * 1000;
const GITHUB_GOAL_ESTATE_CACHE_MAX_TTL_MS = 15 * 60 * 1000;
const GITHUB_GOAL_ESTATE_FAILURE_BACKOFF_MS = 30 * 1000;
const GITHUB_GOAL_ESTATE_REQUEST_TIMEOUT_MS = 30 * 1000;
const GOAL_BODY_REPO_PATH = /(?<![A-Za-z0-9_.\/-])((?:apps|shared|stephanos-server|scripts|docs|packages|config|tests?|\.github)\/[A-Za-z0-9._/-]+\.(?:mjs|cjs|js|ts|tsx|jsx|json|html|css|scss|ps1|sh|py|md|yml|yaml))(?=$|[\s`'")\],;:.])/gi;
const githubGoalEstateCache = new Map();
const ownerAdmissionDecisionEvidence = new WeakMap();
const normalizedGoalDecisionEvidence = new WeakMap();

function asText(value, fallback = '') { const text = String(value ?? '').trim(); return text || fallback; }
function asList(value) { return Array.isArray(value) ? value.filter(Boolean).map((entry) => String(entry).trim()).filter(Boolean) : []; }
function parseRepoSlug(repoSlug = '') { const match = asText(repoSlug).match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/); return match ? { owner: match[1], repo: match[2] } : { owner: '', repo: '' }; }
function githubHeaders(auth, userAgent) { return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${auth.token}`, 'User-Agent': userAgent }; }
function plainObject(value) { if (!value || typeof value !== 'object' || Array.isArray(value)) return false; const prototype = Object.getPrototypeOf(value); return prototype === Object.prototype || prototype === null; }

function sourceImplementationAdmission(issueNumber, repository, resourceIds = [], requiredTests) {
  return Object.freeze({
    schemaVersion: GITHUB_GOAL_ADMISSION_SCHEMA,
    issueNumber,
    repository,
    resourceIds: Object.freeze([...resourceIds]),
    ...(requiredTests === undefined ? {} : { requiredTests: Object.freeze([...requiredTests]) }),
    state: 'READY',
    route: 'OPENCLAW_LOCAL',
    prerequisites: Object.freeze([]),
    sourceImplementationAllowed: true,
    mergeAuthority: false,
    deploymentAuthority: false,
    runtimeMutationAuthority: false,
    arbitraryShellAllowed: false,
  });
}

function goalAdmissionResourceIds(value, repository) {
  if (value === undefined) return [];
  const supplied = asList(value);
  const projection = projectCanonicalResourceIds(supplied);
  const repositoryLower = repository.toLowerCase();
  const prefix = `repo:${repositoryLower}:path:`;
  if (!projection.valid || projection.resourceIds.length === 0) return null;
  if (projection.resourceIds.some((resourceId) => !resourceId.startsWith(prefix))) return null;
  const preserved = supplied.map((resourceId) => {
    const match = asText(resourceId).match(/^repo:([^:]+\/[^:]+):path:(.+)$/i);
    if (!match || match[1].toLowerCase() !== repositoryLower) return null;
    return `repo:${repositoryLower}:path:${match[2]}`;
  });
  if (preserved.some((resourceId) => resourceId === null)) return null;
  return preserved.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
}

export function deriveGoalBodyResourceIds(body, repository) {
  const repo = asText(repository).toLowerCase();
  if (!parseRepoSlug(repo).owner) return Object.freeze([]);
  const matches = [...String(body ?? '').matchAll(GOAL_BODY_REPO_PATH)];
  const resourceIds = [...new Set(matches
    .map((match) => asText(match?.[1]).replace(/\\/g, '/').replace(/^\/+/, ''))
    .filter((path) => path && !path.split('/').some((segment) => !segment || segment === '.' || segment === '..'))
    .map((path) => `repo:${repo}:path:${path}`))];
  const projection = projectCanonicalResourceIds(resourceIds);
  return Object.freeze(projection.valid
    ? resourceIds.sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
    : []);
}

function parseGoalAdmissionBody(body, issueNumber, repository) {
  const pattern = new RegExp('```' + GITHUB_GOAL_ADMISSION_MARKER + '\\s*([\\s\\S]*?)```', 'g');
  const matches = [...String(body ?? '').matchAll(pattern)];
  if (matches.length !== 1) return null;
  let payload;
  try { payload = JSON.parse(matches[0][1]); } catch { return null; }
  if (!plainObject(payload) || Object.keys(payload).some((key) => !GITHUB_GOAL_ADMISSION_KEYS.has(key))) return null;
  if (payload.schemaVersion !== GITHUB_GOAL_ADMISSION_SCHEMA) return null;
  if (Number(payload.issueNumber) !== issueNumber) return null;
  if (asText(payload.repository).toLowerCase() !== repository.toLowerCase()) return null;
  if (asText(payload.state).toUpperCase() !== 'READY') return null;
  if (asText(payload.route).toUpperCase() !== 'OPENCLAW_LOCAL') return null;
  if (!Array.isArray(payload.prerequisites) || payload.prerequisites.length !== 0) return null;
  if (payload.sourceImplementationAllowed !== true || payload.mergeAuthority !== false || payload.deploymentAuthority !== false || payload.runtimeMutationAuthority !== false || payload.arbitraryShellAllowed !== false) return null;
  const resourceIds = goalAdmissionResourceIds(payload.resourceIds, repository);
  if (resourceIds === null) return null;
  const tests = projectGoalAdmissionRequiredTestsV1(payload.requiredTests);
  if (!tests.valid) return null;
  return sourceImplementationAdmission(issueNumber, repository, resourceIds, tests.supplied ? tests.commands : undefined);
}

function normalizeGoalDiscovery(issue, repository, retrievedAt) {
  const issueNumber = Number(issue?.number);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1 || issue?.pull_request || asText(issue?.state).toLowerCase() !== 'open') return null;
  const labels = (Array.isArray(issue?.labels) ? issue.labels : []).map((label) => asText(typeof label === 'string' ? label : label?.name).toLowerCase()).filter(Boolean);
  if (!labels.includes('goal')) return null;
  const title = asText(issue?.title); if (!title) return null;
  return Object.freeze({ issueNumber, title, state: 'open', labels: Object.freeze([...new Set(labels)].sort()), htmlUrl: asText(issue?.html_url), createdAt: asText(issue?.created_at), updatedAt: asText(issue?.updated_at), repository, retrievedAt, creatorLogin: asText(issue?.user?.login), authorAssociation: asText(issue?.author_association).toUpperCase(), admissionState: 'DISCOVERED_CANDIDATE', schedulerEligible: false, sourceMutationAuthority: false, mergeAuthority: false, deploymentAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false });
}

function trustedPriorGoalMirrorAdmission(discovery, priorGoalRecords, owner, repository, issueBody = '') {
  if (!discovery || discovery.creatorLogin.toLowerCase() !== asText(owner).toLowerCase()
    || discovery.authorAssociation !== 'OWNER') return null;
  const candidates = (Array.isArray(priorGoalRecords) ? priorGoalRecords : []).filter((record) => (
    record?.schemaVersion === 'shared-agent-workspace-record.v1'
    && record?.kind === 'stephanos.shared_workspace.goal'
    && asText(record?.goalId).toLowerCase() === `goal-${discovery.issueNumber}`
    && Number(record?.issueNumber) === discovery.issueNumber
    && asText(record?.repository).toLowerCase() === repository.toLowerCase()
    && record?.mirrorSchema === 'stephanos.github-goal-mirror.v1'
    && asText(record?.mirrorRepository).toLowerCase() === repository.toLowerCase()
    && Number(record?.mirrorIssueNumber) === discovery.issueNumber
    && record?.source === 'github-goal-estate-mirror'
    && ['ADMISSION_PROVEN', 'OPERATOR_CONTAINED'].includes(asText(record?.githubAdmissionState).toUpperCase())
    && record?.mergeAuthority === false
    && record?.deploymentAuthority === false
    && record?.runtimeMutationAuthority === false
    && record?.arbitraryShellAllowed === false
  ));
  if (candidates.length !== 1) return null;
  const prior = candidates[0];
  const priorObservedAtMs = Date.parse(asText(prior?.mirrorObservedAtUtc));
  const issueUpdatedAtMs = Date.parse(asText(discovery.updatedAt));
  if (!Number.isFinite(priorObservedAtMs) || !Number.isFinite(issueUpdatedAtMs)
    || issueUpdatedAtMs >= priorObservedAtMs) return null;
  const priorResourceIds = Array.isArray(prior?.resourceIds) && prior.resourceIds.length === 0
    ? []
    : goalAdmissionResourceIds(prior?.resourceIds, repository);
  if (priorResourceIds === null) return null;
  const tests = projectGoalAdmissionRequiredTestsV1(prior.requiredTests);
  if (!tests.valid) return null;
  const derivedBodyResourceIds = deriveGoalBodyResourceIds(issueBody, repository);
  const resourceIds = priorResourceIds.length > 0 ? priorResourceIds : derivedBodyResourceIds;
  const operatorLaneContainment = plainObject(prior?.operatorLaneContainment)
    ? prior.operatorLaneContainment
    : { active: false };
  return Object.freeze({
    admission: sourceImplementationAdmission(discovery.issueNumber, repository, resourceIds, tests.supplied ? tests.commands : undefined),
    operatorLaneContainment,
    admissionProofSource: 'PRIOR_MIRROR_ADMISSION_REVALIDATED',
  });
}

function trustedOwnerGoalLabelAdmission(issue, events, owner, issueNumber, repository) {
  if (asText(issue?.user?.login).toLowerCase() !== asText(owner).toLowerCase()) return null;
  if (asText(issue?.author_association).toUpperCase() !== 'OWNER') return null;
  const goalEvents = (Array.isArray(events) ? events : []).filter((event) => asText(event?.event).toLowerCase() === 'labeled' && asText(event?.label?.name).toLowerCase() === 'goal');
  if (goalEvents.length === 0) return null;
  const latest = goalEvents[goalEvents.length - 1];
  if (asText(latest?.actor?.login).toLowerCase() !== asText(owner).toLowerCase()) return null;
  const admission = sourceImplementationAdmission(issueNumber, repository, deriveGoalBodyResourceIds(issue?.body, repository));
  ownerAdmissionDecisionEvidence.set(admission, Object.freeze({ kind: 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT',
    eventId: latest.id, actorLogin: latest.actor.login, label: 'goal',
    issueBodySha256: createHash('sha256').update(String(issue.body), 'utf8').digest('hex') }));
  return admission;
}

function trustedOwnerAdmission(comments, owner, issueNumber, repository) {
  const candidates = [];
  let explicitTestPlan = false;
  for (const comment of Array.isArray(comments) ? comments : []) {
    if (asText(comment?.user?.login).toLowerCase() !== asText(owner).toLowerCase()) continue;
    if (asText(comment?.author_association).toUpperCase() !== 'OWNER') continue;
    const body = String(comment?.body ?? '');
    const blocks = [...body.matchAll(new RegExp('```' + GITHUB_GOAL_ADMISSION_MARKER + '\\s*([\\s\\S]*?)```', 'g'))];
    const requestsTests = body.includes('```' + GITHUB_GOAL_ADMISSION_MARKER) && (
      /"requiredTests"\s*:/.test(body) || blocks.some(block => {
        try { return Object.hasOwn(JSON.parse(block[1]) || {}, 'requiredTests'); } catch { return false; }
      })
    );
    explicitTestPlan ||= requestsTests;
    const admission = parseGoalAdmissionBody(body, issueNumber, repository);
    if (requestsTests && !admission) return { invalidRequiredTests: true };
    if (admission) {
      ownerAdmissionDecisionEvidence.set(admission, Object.freeze({ kind: 'OWNER_AUTHENTICATED_COMMENT',
        commentId: comment.id, authorLogin: comment.user.login,
        createdAt: comment.created_at, updatedAt: comment.updated_at,
        bodySha256: createHash('sha256').update(body, 'utf8').digest('hex') }));
      candidates.push(admission);
    }
  }
  if (explicitTestPlan && candidates.length !== 1) return { invalidRequiredTests: true };
  return candidates.length === 1 ? candidates[0] : null;
}

function normalizeGoalIssue(issue, repository, retrievedAt, comments, owner, events = [], priorMirrorAdmission = null) {
  const discovery = normalizeGoalDiscovery(issue, repository, retrievedAt); if (!discovery) return null;
  const ownerLabelAdmission = trustedOwnerGoalLabelAdmission(issue, events, owner, discovery.issueNumber, repository);
  const commentAdmission = trustedOwnerAdmission(comments, owner, discovery.issueNumber, repository);
  if (commentAdmission?.invalidRequiredTests) return null;
  const scopedCommentAdmission = commentAdmission?.resourceIds?.length
    && (comments.length === 1 || commentAdmission.requiredTests) ? commentAdmission : null;
  const priorAdmission = priorMirrorAdmission?.admission || null;
  let admission = scopedCommentAdmission || priorAdmission || ownerLabelAdmission || commentAdmission;
  if (!admission) return null;
  // A test plan without an explicit mutation scope must retain the already
  // admitted scope; declaring read-only checks cannot widen source authority.
  if (commentAdmission?.requiredTests) admission = sourceImplementationAdmission(
    discovery.issueNumber, repository, admission.resourceIds, commentAdmission.requiredTests,
  );
  const operatorLaneContainment = priorMirrorAdmission?.operatorLaneContainment || evaluateOperatorLaneContainmentV1({
    comments,
    repository,
    issueNumber: discovery.issueNumber,
    trustedOperatorLogin: owner,
  });
  const contained = operatorLaneContainment.active === true;
  const admissionProofSource = scopedCommentAdmission || commentAdmission?.requiredTests
    ? 'OWNER_AUTHENTICATED_COMMENT'
    : priorMirrorAdmission?.admissionProofSource
      || ((!ownerLabelAdmission && commentAdmission)
        ? 'OWNER_AUTHENTICATED_COMMENT'
        : 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT');
  const normalized = Object.freeze({
    ...discovery,
    admission,
    admissionState: contained ? 'OPERATOR_CONTAINED' : 'ADMISSION_PROVEN',
    admissionProofSource,
    schedulerEligible: !contained,
    operatorLaneContainment,
  });
  normalizedGoalDecisionEvidence.set(normalized, Object.freeze({
    scope: ownerAdmissionDecisionEvidence.get(scopedCommentAdmission || ownerLabelAdmission || commentAdmission) || null,
    tests: commentAdmission?.requiredTests ? ownerAdmissionDecisionEvidence.get(commentAdmission) || null : null,
  }));
  return normalized;
}

export function resolveGithubRepoConfig(env = process.env) {
  const repoSlug = asText(env.GITHUB_REPOSITORY || env.GITHUB_REPO || env.STEPHANOS_GITHUB_REPOSITORY); const fromSlug = parseRepoSlug(repoSlug);
  const owner = asText(env.GITHUB_REPO_OWNER || env.REPO_OWNER, fromSlug.owner); const repo = asText(env.GITHUB_REPO_NAME || env.REPO_NAME, fromSlug.repo); return owner && repo ? { owner, repo } : null;
}
function normalizeChecksState(conclusions = []) { const lowered = conclusions.map((value) => asText(value).toLowerCase()); if (lowered.some((state) => ['failure','failed','timed_out','cancelled','action_required'].includes(state))) return 'failed'; if (lowered.some((state) => ['queued','in_progress','pending','waiting'].includes(state))) return 'pending'; if (lowered.length > 0 && lowered.every((state) => ['success','skipped','neutral'].includes(state))) return 'passed'; return 'unknown'; }
export async function resolveGithubTokenConfig(options = {}) { return resolveGithubAuth(options); }

// Fixed read-only reconciliation: the retained PR, immutable ancestry, then a
// fresh main ref. This cannot approve a merge or authorize a runtime action.
export async function fetchExternalMergeObservation(mission, options = {}) {
  if (!externalMergeCandidateV1(mission)) return { status: 'skipped', reasonCode: 'MISSION_INELIGIBLE' };
  const test = options.testOnly === true;
  const fetchImpl = test && options.fetchImpl ? options.fetchImpl : fetch;
  const owner = 'Cheekyfellastef', repo = 'stephan-os', key = `${owner}/${repo}`.toLowerCase();
  const useSharedHold = !test || Boolean(options.workspaceRoot);
  const shared = useSharedHold ? readBrokeredGithubRateLimitHold({ repository: key, workspaceRoot: options.workspaceRoot }) : null;
  const until = Math.max(githubPrRateLimitBackoff.get(key) || 0, shared?.untilMs || 0);
  if (until > Date.now()) return githubPrRateLimitHold(owner, repo, mission.pullRequest.number, 'observation', until);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), test ? (options.timeoutMs || 25_000) : 25_000);
  let activeAuth;
  const fail = reasonCode => ({ status: 'error', reasonCode });
  try {
    activeAuth = test && options.auth ? options.auth : await resolveGithubTokenConfig({ env: options.env || process.env });
    if (controller.signal.aborted) return fail('GITHUB_OBSERVATION_DEADLINE');
    if (!activeAuth.configured) return fail('GITHUB_AUTH_UNAVAILABLE');
    const request = async (suffix, allowFallback = false) => {
      if (controller.signal.aborted) throw new Error('GITHUB_OBSERVATION_DEADLINE');
      let response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/${suffix}`, {
        headers: githubHeaders(activeAuth, 'stephanos-completion-guardian'), signal: controller.signal,
        redirect: 'error',
      });
      const hold = await checkPrRateLimitResponse(response, key, owner, repo, mission.pullRequest.number,
        activeAuth.authority, options.workspaceRoot, useSharedHold);
      if (hold) throw Object.assign(new Error(hold.reasonCode), { observationFailure: hold });
      if (allowFallback && [401, 403].includes(response.status) && activeAuth.authority !== 'gh-cli') {
        const fallback = await resolveGithubGhCliAuth(test ? { ghTokenProvider: options.ghTokenProvider || (async () => '') } : {});
        if (fallback.configured) { activeAuth = fallback; return request(suffix); }
      }
      if (!response.ok) throw new Error('GITHUB_OBSERVATION_READ_FAILED');
      return response.json();
    };
    const pr = await request(`pulls/${mission.pullRequest.number}`, true);
    if (pr.number !== mission.pullRequest.number || pr.merged !== true || pr.state !== 'closed'
        || pr.head?.repo?.full_name !== mission.repository || pr.base?.repo?.full_name !== mission.repository
        || pr.head?.sha !== mission.pullRequest.headSha || pr.head?.ref !== mission.git.branch
        || pr.base?.ref !== 'main' || !/^[a-f0-9]{40}$/.test(pr.merge_commit_sha || '')) {
      return fail('GITHUB_MERGE_IDENTITY_UNPROVEN');
    }
    const main = await request('git/ref/heads/main');
    if (main.ref !== 'refs/heads/main' || main.object?.type !== 'commit'
        || !/^[a-f0-9]{40}$/.test(main.object?.sha || '')) return fail('GITHUB_MAIN_IDENTITY_UNPROVEN');
    const comparison = await request(`compare/${pr.merge_commit_sha}...${main.object.sha}`);
    if (!['ahead', 'identical'].includes(comparison.status)
        || comparison.merge_base_commit?.sha !== pr.merge_commit_sha
        || comparison.base_commit?.sha !== pr.merge_commit_sha) return fail('GITHUB_MERGE_ANCESTRY_UNPROVEN');
    const recheck = await request('git/ref/heads/main');
    if (controller.signal.aborted) return fail('GITHUB_OBSERVATION_DEADLINE');
    if (recheck.ref !== main.ref || recheck.object?.type !== 'commit'
        || recheck.object?.sha !== main.object.sha) return fail('GITHUB_MAIN_MOVED');
    const observation = {
      schemaVersion: EXTERNAL_MERGE_OBSERVATION_SCHEMA, source: 'github-api', repository: mission.repository,
      missionId: mission.missionId, expectedRevision: mission.revision, prNumber: pr.number,
      headSha: pr.head.sha, branch: pr.head.ref, baseBranch: pr.base.ref, merged: true, prState: pr.state,
      mergeCommitSha: pr.merge_commit_sha, mergedAtUtc: pr.merged_at, mainHead: main.object.sha,
      ancestorCommit: pr.merge_commit_sha, ancestryMainHead: main.object.sha, mainRecheckHead: recheck.object.sha,
      mergeAncestorOfMain: true, observedAtUtc: new Date().toISOString(),
    };
    return validateExternalMergeObservationV1(mission, observation, new Date().toISOString()).valid
      ? { status: 'fetched', observation } : fail('GITHUB_MERGE_OBSERVATION_INVALID');
  } catch (error) {
    return error.observationFailure || fail(controller.signal.aborted ? 'GITHUB_OBSERVATION_DEADLINE' : 'GITHUB_OBSERVATION_READ_FAILED');
  } finally { clearTimeout(timeout); }
}

// Fresh owner-decision evidence for the existing recovery service. Reuse the
// canonical credential reader; this performs GET only and cannot create a
// decision. A connector-authored comment is not a direct operator decision.
export async function readGithubOwnerApprovalComment(commentId, { env = process.env, fetchImpl = fetch, signal } = {}) {
  if (!Number.isSafeInteger(commentId) || commentId <= 0) throw new Error('SUPERVISED_R7_APPROVAL_ID_INVALID');
  const auth = await resolveGithubTokenConfig({ env });
  const response = await fetchImpl(
    `https://api.github.com/repos/Cheekyfellastef/stephan-os/issues/comments/${commentId}`,
    { redirect: 'error', headers: {
      Accept: 'application/vnd.github+json', 'User-Agent': 'stephanos-operator-approval-read',
      ...(auth.configured ? { Authorization: `Bearer ${auth.token}` } : {}),
    }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
  if (!response.ok) throw new Error('SUPERVISED_R7_APPROVAL_READ_FAILED');
  const bytes = await response.text();
  if (Buffer.byteLength(bytes) > 65536) throw new Error('SUPERVISED_R7_APPROVAL_UNBOUNDED');
  const comment = JSON.parse(bytes);
  if (comment.id !== commentId || comment.user?.id !== 267490109
      || comment.user?.login !== 'Cheekyfellastef' || comment.user?.type !== 'User'
      || comment.author_association !== 'OWNER' || comment.performed_via_github_app != null
      || comment.created_at !== comment.updated_at) throw new Error('SUPERVISED_R7_APPROVAL_NOT_OWNER_IMMUTABLE');
  return comment;
}

export const SEED_SOURCE_CONTRACT_CORRECTION_MARKER_V1 = 'stephanos-seed-source-contract-correction-v1';
export const SEED_SOURCE_CONTRACT_CORRECTION_SCHEMA_V1 = 'stephanos.seed-source-contract-correction.v1';
const SEED_CORRECTION_REPOSITORY = 'Cheekyfellastef/stephan-os';
const SEED_CORRECTION_BINDING_KEYS = Object.freeze(['childIssueNumber', 'missionId', 'seedId', 'pressureKey',
  'targetRung', 'originalIntentCommentId', 'originalIntentIssueNumber', 'originalIntentBodySha256', 'contractPreimageSha256']);
const SEED_CORRECTION_PLAN_KEYS = Object.freeze(['allowedFiles', 'requiredTests', 'requiredEvidence',
  'usefulOutcome', 'domainAcceptanceContract', 'executionRelationship']);
const SEED_CORRECTION_MAX_PAGES = 10;
const SEED_CORRECTION_MAX_COHORT_BYTES = 1024 * 1024;
const SEED_CORRECTION_MAX_OBSERVATION_MS = 30_000;

function seedCorrectionData(value, keys) {
  if (!value || types.isProxy(value) || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  return Reflect.ownKeys(descriptors).length === keys.length
    && Reflect.ownKeys(descriptors).every(key => typeof key === 'string' && keys.includes(key)
      && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable);
}
function seedCorrectionText(value, maximum = 256) {
  return typeof value === 'string' && value.length > 0 && value.length <= maximum
    && value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
}
function seedCorrectionStrings(value, maximum = 16, width = 256) {
  if (!Array.isArray(value) || types.isProxy(value) || value.length < 1 || value.length > maximum
      || Object.getPrototypeOf(value) !== Array.prototype
      || Reflect.ownKeys(value).length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !seedCorrectionText(descriptor.value, width)) return false;
  }
  return new Set(value).size === value.length;
}
function seedCorrectionBinding(value) {
  return seedCorrectionData(value, SEED_CORRECTION_BINDING_KEYS)
    && ['childIssueNumber', 'originalIntentCommentId', 'originalIntentIssueNumber']
      .every(key => Number.isSafeInteger(value[key]) && value[key] > 0)
    && ['originalIntentBodySha256', 'contractPreimageSha256']
      .every(key => typeof value[key] === 'string' && /^[a-f0-9]{64}$/.test(value[key]))
    && typeof value.missionId === 'string' && /^[a-z0-9][a-z0-9._-]{2,127}$/.test(value.missionId)
    && ['seedId', 'pressureKey', 'targetRung'].every(key => seedCorrectionText(value[key], 160));
}
function seedCorrectionPayload(comment) {
  const marker = SEED_SOURCE_CONTRACT_CORRECTION_MARKER_V1;
  const body = comment.body;
  if (typeof body !== 'string' || body.toLowerCase().split(marker).length !== 2) return null;
  const blocks = [...body.matchAll(/```stephanos-seed-source-contract-correction-v1\r?\n([\s\S]*?)\r?\n```/g)];
  if (blocks.length !== 1) return null;
  try { return JSON.parse(blocks[0][1]); } catch { return null; }
}
function seedCorrectionDecision(comment, expected, now, consumedAtUtc) {
  const decision = seedCorrectionPayload(comment);
  if (!decision) return null;
  const keys = ['schemaVersion', 'decision', 'repository', 'binding', 'expiresAtUtc',
    ...(decision?.decision === 'CORRECT' ? ['sourceContract', 'runtimePolicyHead', 'runtimePolicyTree'] : ['correctionCommentId'])];
  if (!seedCorrectionData(decision, keys)
      || decision.schemaVersion !== SEED_SOURCE_CONTRACT_CORRECTION_SCHEMA_V1
      || decision.repository !== SEED_CORRECTION_REPOSITORY
      || !['CORRECT', 'REVOKE'].includes(decision.decision)
      || !seedCorrectionBinding(decision.binding)
      || SEED_CORRECTION_BINDING_KEYS.some(key => decision.binding[key] !== expected[key])) return null;
  const created = Date.parse(comment.created_at), expires = Date.parse(decision.expiresAtUtc);
  const applicableAt = consumedAtUtc === undefined ? now : Date.parse(consumedAtUtc);
  if (typeof decision.expiresAtUtc !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(decision.expiresAtUtc)
      || !Number.isFinite(created) || !Number.isFinite(expires) || !Number.isFinite(applicableAt)
      || created > applicableAt || applicableAt > now || expires <= applicableAt
      || expires <= created || expires - created > 300_000) return null;
  if (decision.decision === 'REVOKE') return Number.isSafeInteger(decision.correctionCommentId)
    && decision.correctionCommentId > 0 ? decision : null;
  const plan = decision.sourceContract;
  if (!/^[a-f0-9]{40}$/.test(decision.runtimePolicyHead) || !/^[a-f0-9]{40}$/.test(decision.runtimePolicyTree)
      || !seedCorrectionData(plan, SEED_CORRECTION_PLAN_KEYS)
      || !seedCorrectionStrings(plan.allowedFiles, 4)
      || !seedCorrectionStrings(plan.requiredTests)
      || !projectGoalAdmissionRequiredTestsV1(plan.requiredTests).valid
      || !seedCorrectionStrings(plan.requiredEvidence, 16, 1600)
      || !seedCorrectionText(plan.usefulOutcome, 1600)
      || !seedCorrectionText(plan.domainAcceptanceContract, 256)
      || plan.executionRelationship !== 'SELF') return null;
  return decision;
}
async function readSeedCorrectionPageText(response, remaining, signal) {
  const reader = response.body?.getReader?.();
  if (!reader) throw new Error('SEED_CORRECTION_COHORT_STREAM_REQUIRED');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      if (signal.aborted) throw new Error('SEED_CORRECTION_OBSERVATION_DEADLINE');
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > remaining) throw new Error('SEED_CORRECTION_COHORT_UNBOUNDED');
      chunks.push(Buffer.from(next.value));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size));
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
}

// Observation only. This fixed reader cannot admit, correct, re-enter or
// dispatch a mission. The future private store producer must independently
// prove canonical child/intent/preimage, physical source, custody and budget.
// A current complete cohort plus immutable reads is required; a copied DTO or
// one fixed comment GET can never establish current correction authority.
async function observeSeedSourceContractCorrectionEvidence(expected, { env = process.env, fetchImpl = fetch,
  nowMs = Date.now, workspaceRoot } = {}, consumption) {
  const held = reasonCode => Object.freeze({ status: 'held', reasonCode,
    mutationAuthority: false, dispatchAllowed: false, correctionAllowed: false });
  if (!seedCorrectionBinding(expected)) return held('SEED_CORRECTION_BINDING_INVALID');
  const now = typeof nowMs === 'function' ? nowMs() : nowMs;
  if (!Number.isFinite(now)) return held('SEED_CORRECTION_TIME_INVALID');
  const useSharedHold = fetchImpl === fetch || Boolean(workspaceRoot);
  if (useSharedHold && readBrokeredGithubRateLimitHold({ repository: SEED_CORRECTION_REPOSITORY, workspaceRoot, env, nowMs: now }))
    return held('SEED_CORRECTION_RATE_LIMIT_BACKOFF');
  const started = Date.now(), controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEED_CORRECTION_MAX_OBSERVATION_MS);
  timer.unref?.();
  try {
    const auth = await resolveGithubTokenConfig({ env });
    if (!auth.configured) return held('SEED_CORRECTION_AUTH_UNAVAILABLE');
    const issueUrl = `https://api.github.com/repos/${SEED_CORRECTION_REPOSITORY}/issues/${expected.childIssueNumber}`;
    const seen = new Set(), relevant = [];
    let totalBytes = 0, complete = false;
    for (let page = 1; page <= SEED_CORRECTION_MAX_PAGES; page++) {
      if (controller.signal.aborted) return held('SEED_CORRECTION_OBSERVATION_DEADLINE');
      const response = await fetchImpl(`${issueUrl}/comments?per_page=100&page=${page}`, {
        method: 'GET', redirect: 'error', cache: 'no-store',
        headers: githubHeaders(auth, 'stephanos-seed-correction-observe'), signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429 || (response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0')) {
          if (useSharedHold) recordBrokeredGithubRateLimitHold({
            repository: SEED_CORRECTION_REPOSITORY, workspaceRoot, env, nowMs: now,
          });
          return held('SEED_CORRECTION_RATE_LIMIT_BACKOFF');
        }
        return held('SEED_CORRECTION_COHORT_READ_FAILED');
      }
      const bytes = await readSeedCorrectionPageText(response, SEED_CORRECTION_MAX_COHORT_BYTES - totalBytes, controller.signal);
      totalBytes += Buffer.byteLength(bytes);
      if (totalBytes > SEED_CORRECTION_MAX_COHORT_BYTES) return held('SEED_CORRECTION_COHORT_UNBOUNDED');
      const comments = JSON.parse(bytes);
      if (!Array.isArray(comments) || comments.length > 100) return held('SEED_CORRECTION_COHORT_INVALID');
      for (const comment of comments) {
        if (!comment || !Number.isSafeInteger(comment.id) || comment.id <= 0 || seen.has(comment.id)
            || comment.issue_url !== issueUrl) return held('SEED_CORRECTION_COHORT_INVALID');
        seen.add(comment.id);
        const marked = typeof comment.body === 'string'
          && comment.body.toLowerCase().includes(SEED_SOURCE_CONTRACT_CORRECTION_MARKER_V1);
        const ownerClaimed = comment.user?.id === 267490109 || comment.user?.login === 'Cheekyfellastef';
        if (!marked || !ownerClaimed) continue;
        if (comment.user?.id !== 267490109 || comment.user?.login !== 'Cheekyfellastef'
            || comment.user?.type !== 'User' || comment.author_association !== 'OWNER'
            || comment.performed_via_github_app != null || comment.created_at !== comment.updated_at)
          return held('SEED_CORRECTION_OWNER_DECISION_INVALID');
        const decision = seedCorrectionDecision(comment, expected, now,
          consumption?.decisionCommentId === comment.id ? consumption.appliedAtUtc : undefined);
        // Never ignore a malformed relevant REVOKE or fall back to an old plan.
        if (!decision) return held('SEED_CORRECTION_OWNER_DECISION_INVALID');
        relevant.push({ comment, decision });
      }
      if (comments.length < 100) { complete = true; break; }
    }
    if (!complete) return held('SEED_CORRECTION_COHORT_INCOMPLETE');
    if (relevant.some(row => row.decision.decision === 'REVOKE')) return held('SEED_CORRECTION_REVOKED');
    if (relevant.length !== 1) return held(relevant.length ? 'SEED_CORRECTION_DECISION_AMBIGUOUS' : 'SEED_CORRECTION_PLAN_MISSING');
    const selected = relevant[0];
    if (consumption && (selected.comment.id !== consumption.decisionCommentId
        || createHash('sha256').update(selected.comment.body).digest('hex') !== consumption.decisionBodySha256)) {
      return held('SEED_CORRECTION_CONSUMED_DECISION_CHANGED');
    }
    const current = await readGithubOwnerApprovalComment(selected.comment.id, { env, fetchImpl, signal: controller.signal });
    if (current.issue_url !== issueUrl || current.created_at !== selected.comment.created_at
        || current.body !== selected.comment.body) return held('SEED_CORRECTION_DECISION_CHANGED');
    const intent = await readGithubOwnerApprovalComment(expected.originalIntentCommentId, { env, fetchImpl, signal: controller.signal });
    if (intent.issue_url !== `https://api.github.com/repos/${SEED_CORRECTION_REPOSITORY}/issues/${expected.originalIntentIssueNumber}`
        || createHash('sha256').update(intent.body, 'utf8').digest('hex') !== expected.originalIntentBodySha256)
      return held('SEED_CORRECTION_ORIGINAL_INTENT_CHANGED');
    if (controller.signal.aborted || Date.now() - started >= SEED_CORRECTION_MAX_OBSERVATION_MS)
      return held('SEED_CORRECTION_OBSERVATION_DEADLINE');
    return Object.freeze({ status: 'observed', reasonCode: 'SEED_CORRECTION_PRIVATE_PRODUCER_REQUIRED',
      observedAtUtc: new Date(now).toISOString(), completeCohort: true,
      decisionCommentId: selected.comment.id, originalIntentCommentId: intent.id,
      decisionCreatedAtUtc: current.created_at, originalIntentBody: intent.body,
      decisionBodySha256: createHash('sha256').update(current.body, 'utf8').digest('hex'),
      decision: Object.freeze(selected.decision), mutationAuthority: false, dispatchAllowed: false, correctionAllowed: false });
  } catch (error) {
    return held(controller.signal.aborted ? 'SEED_CORRECTION_OBSERVATION_DEADLINE'
      : ['SEED_CORRECTION_COHORT_UNBOUNDED', 'SEED_CORRECTION_COHORT_STREAM_REQUIRED'].includes(error.message)
        ? error.message : 'SEED_CORRECTION_OBSERVATION_FAILED');
  } finally { clearTimeout(timer); }
}

export async function readSeedSourceContractCorrectionEvidenceV1(expected, options = {}) {
  return observeSeedSourceContractCorrectionEvidence(expected, options);
}

// Consumption data alone is not authority: the private goal reader must first
// resolve the actual durable mint/audit. This only observes the current owner
// cohort and verifies the exact decision was applicable when that mint occurred.
export async function readConsumedSeedSourceContractCorrectionEvidenceV1(expected, consumption, options = {}) {
  if (!seedCorrectionData(consumption, ['decisionCommentId', 'decisionBodySha256', 'appliedAtUtc'])
      || !Number.isSafeInteger(consumption.decisionCommentId) || consumption.decisionCommentId < 1
      || typeof consumption.decisionBodySha256 !== 'string' || !/^[a-f0-9]{64}$/.test(consumption.decisionBodySha256)
      || typeof consumption.appliedAtUtc !== 'string' || !Number.isFinite(Date.parse(consumption.appliedAtUtc))) {
    return Object.freeze({ status: 'held', reasonCode: 'SEED_CORRECTION_CONSUMPTION_INVALID',
      mutationAuthority: false, dispatchAllowed: false, correctionAllowed: false });
  }
  const result = await observeSeedSourceContractCorrectionEvidence(expected, options, consumption);
  const now = typeof options.nowMs === 'function' ? options.nowMs() : options.nowMs ?? Date.now();
  if (result.status === 'observed' && Date.parse(result.decision.expiresAtUtc) <= now) {
    // A local JSON hash/journal cannot authenticate past wall time or native
    // custody. An existing protected consumption authority is required before
    // an expired decision may support an already-owned continuation.
    return Object.freeze({ status: 'held', reasonCode: 'SEED_CORRECTION_PROTECTED_CONSUMPTION_PROOF_REQUIRED',
      mutationAuthority: false, dispatchAllowed: false, correctionAllowed: false });
  }
  return result;
}

// A comment ID selects actual immutable owner data, never caller-approved paths.
export async function readUnadmittedSeedSourceCorrectionDecisionV1(expected, commentId, options = {}) {
  const held = reasonCode => Object.freeze({ status: 'held', reasonCode,
    mutationAuthority: false, dispatchAllowed: false, correctionAllowed: false });
  const keys = ['childIssueNumber', 'missionId', 'seedId', 'pressureKey', 'targetRung', 'contractPreimageSha256'];
  if (!seedCorrectionData(expected, keys) || !Number.isSafeInteger(commentId) || commentId < 1) return held('SEED_CORRECTION_SELECTOR_INVALID');
  try {
    const comment = await readGithubOwnerApprovalComment(commentId, options);
    const payload = seedCorrectionPayload(comment), original = payload?.binding;
    if (comment.issue_url !== `https://api.github.com/repos/${SEED_CORRECTION_REPOSITORY}/issues/${expected.childIssueNumber}`
        || !original || payload.decision !== 'CORRECT') return held('SEED_CORRECTION_SELECTOR_INVALID');
    const binding = { ...expected, originalIntentCommentId: original.originalIntentCommentId,
      originalIntentIssueNumber: original.originalIntentIssueNumber, originalIntentBodySha256: original.originalIntentBodySha256 };
    const result = await readSeedSourceContractCorrectionEvidenceV1(binding, options);
    if (result.status === 'observed' && result.decisionCommentId !== commentId) return held('SEED_CORRECTION_SELECTOR_CHANGED');
    return result;
  } catch { return held('SEED_CORRECTION_SELECTOR_READ_FAILED'); }
}

export async function readUnadmittedSeedGithubGoalV1(issueNumber, { env = process.env, fetchImpl = fetch,
  workspaceRoot, nowMs = Date.now } = {}) {
  const held = reasonCode => Object.freeze({ status: 'held', reasonCode, mutationAuthority: false, dispatchAllowed: false });
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return held('SEED_GOAL_ISSUE_INVALID');
  const now = typeof nowMs === 'function' ? nowMs() : nowMs;
  if (!Number.isFinite(now)) return held('SEED_GOAL_TIME_INVALID');
  if ((fetchImpl === fetch || workspaceRoot) && readBrokeredGithubRateLimitHold({ repository: SEED_CORRECTION_REPOSITORY,
    workspaceRoot, env, nowMs: now })) return held('SEED_GOAL_RATE_LIMIT_BACKOFF');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30000);
  timer.unref?.();
  try {
    const auth = await resolveGithubTokenConfig({ env });
    if (!auth.configured) return held('SEED_GOAL_AUTH_UNAVAILABLE');
    let used = 0;
    const root = `https://api.github.com/repos/${SEED_CORRECTION_REPOSITORY}`;
    const get = async (endpoint, absentAllowed = false) => {
      const response = await fetchImpl(root + endpoint, { method: 'GET', redirect: 'error', cache: 'no-store',
        headers: githubHeaders(auth, 'stephanos-unadmitted-seed-goal'), signal: controller.signal });
      if (absentAllowed && response.status === 404) { await response.body?.cancel(); return null; }
      if (!response.ok) {
        if ((fetchImpl === fetch || workspaceRoot) && (response.status === 429
            || (response.status === 403 && response.headers?.get?.('x-ratelimit-remaining') === '0'))) {
          recordBrokeredGithubRateLimitHold({ repository: SEED_CORRECTION_REPOSITORY, workspaceRoot, env, nowMs: now });
        }
        throw new Error('SEED_GOAL_REMOTE_READ_FAILED');
      }
      if (endpoint.startsWith('/pulls?') && response.headers?.get?.('link')) {
        throw new Error('SEED_GOAL_PRIOR_PR_OBSERVATION_INCOMPLETE');
      }
      const bytes = await readSeedCorrectionPageText(response, 1024 * 1024 - used, controller.signal);
      used += Buffer.byteLength(bytes);
      return JSON.parse(bytes);
    };
    const issue = await get(`/issues/${issueNumber}`), issueUrl = `${root}/issues/${issueNumber}`;
    if (!issue || issue.number !== issueNumber || issue.url !== issueUrl || issue.state !== 'open' || issue.pull_request
        || typeof issue.body !== 'string' || !Number.isFinite(Date.parse(issue.updated_at))
        || Date.parse(issue.updated_at) > now) return held('SEED_GOAL_REMOTE_IDENTITY_INVALID');
    const branch = `openclaw/elastic-goal-${issueNumber}`;
    // An issues-only token can hide contents endpoints behind 404. Positively
    // observe the canonical main ref with this same credential before treating
    // a target-branch 404 as absence.
    const main = await get('/git/ref/heads/main');
    if (main?.ref !== 'refs/heads/main' || main.object?.type !== 'commit'
        || !/^[a-f0-9]{40}$/.test(main.object?.sha || '')) return held('SEED_GOAL_CONTENTS_OBSERVATION_UNPROVEN');
    if (await get(`/git/ref/heads/${branch}`, true) !== null) return held('SEED_GOAL_PRIOR_REMOTE_BRANCH_PRESENT');
    const prs = await get(`/pulls?state=all&head=${encodeURIComponent('Cheekyfellastef:' + branch)}&per_page=100&page=1`);
    if (!Array.isArray(prs)) return held('SEED_GOAL_PRIOR_PR_OBSERVATION_INVALID');
    if (prs.length) return held('SEED_GOAL_PRIOR_PR_PRESENT');
    return Object.freeze({ status: 'observed', issueBody: issue.body, issueUpdatedAtUtc: issue.updated_at,
      issueNumber, branch, remoteBranchAbsent: true, priorPrAbsent: true, observedAtUtc: new Date(now).toISOString(),
      mainHead: main.object.sha, frameFingerprint: createHash('sha256').update(JSON.stringify({ issue, branch, mainHead: main.object.sha })).digest('hex'),
      mutationAuthority: false, dispatchAllowed: false });
  } catch { return held(controller.signal.aborted ? 'SEED_GOAL_OBSERVATION_DEADLINE' : 'SEED_GOAL_REMOTE_READ_FAILED'); }
  finally { clearTimeout(timer); }
}

// Current plan observation for the private canonical source-plan producer.
// This is not historical non-seed genesis and grants no authority by itself.
export async function readCurrentOwnerAdmittedGoalPlanV1(issueNumber, { env = process.env,
  fetchImpl = fetch, nowMs = Date.now, workspaceRoot } = {}) {
  const held = reasonCode => Object.freeze({ status: 'held', reasonCode,
    sourceMutationAllowed: false, dispatchAllowed: false });
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return held('CURRENT_SOURCE_PLAN_ISSUE_INVALID');
  const now = typeof nowMs === 'function' ? nowMs() : nowMs;
  if (!Number.isFinite(now)) return held('CURRENT_SOURCE_PLAN_TIME_INVALID');
  const sharedHold = fetchImpl === fetch || Boolean(workspaceRoot);
  if (sharedHold && readBrokeredGithubRateLimitHold({ repository: SEED_CORRECTION_REPOSITORY,
    workspaceRoot, env, nowMs: now })) return held('CURRENT_SOURCE_PLAN_RATE_LIMIT_BACKOFF');
  const controller = new AbortController(), started = Date.now();
  const timer = setTimeout(() => controller.abort(), SEED_CORRECTION_MAX_OBSERVATION_MS);
  timer.unref?.();
  try {
    const auth = await resolveGithubTokenConfig({ env });
    if (!auth.configured) return held('CURRENT_SOURCE_PLAN_AUTH_UNAVAILABLE');
    const issueUrl = `https://api.github.com/repos/${SEED_CORRECTION_REPOSITORY}/issues/${issueNumber}`;
    let size = 0;
    const read = async url => {
      const response = await fetchImpl(url, { method: 'GET', redirect: 'error', cache: 'no-store',
        headers: githubHeaders(auth, 'stephanos-current-source-plan'), signal: controller.signal });
      if (!response.ok) {
        if (sharedHold && (response.status === 429 || (response.status === 403
            && response.headers?.get?.('x-ratelimit-remaining') === '0'))) {
          recordBrokeredGithubRateLimitHold({ repository: SEED_CORRECTION_REPOSITORY, workspaceRoot, env, nowMs: now });
        }
        throw new Error('CURRENT_SOURCE_PLAN_READ_FAILED');
      }
      const bytes = await readSeedCorrectionPageText(response,
        SEED_CORRECTION_MAX_COHORT_BYTES - size, controller.signal);
      size += Buffer.byteLength(bytes);
      return JSON.parse(bytes);
    };
    const issue = await read(issueUrl);
    if (!issue || issue.number !== issueNumber || issue.pull_request || issue.state !== 'open'
        || issue.url !== issueUrl || typeof issue.body !== 'string'
        || !Number.isFinite(Date.parse(issue.updated_at)) || Date.parse(issue.updated_at) > now) {
      return held('CURRENT_SOURCE_PLAN_ISSUE_INVALID');
    }
    const collect = async suffix => {
      const rows = [], seen = new Set();
      for (let page = 1; page <= SEED_CORRECTION_MAX_PAGES; page++) {
        const values = await read(`${issueUrl}/${suffix}?per_page=100&page=${page}`);
        if (!Array.isArray(values) || values.length > 100) throw new Error('CURRENT_SOURCE_PLAN_COHORT_INVALID');
        for (const row of values) {
          if (!row || !Number.isSafeInteger(row.id) || row.id < 1 || seen.has(row.id)) {
            throw new Error('CURRENT_SOURCE_PLAN_COHORT_INVALID');
          }
          if (suffix === 'comments' && row.issue_url !== issueUrl) throw new Error('CURRENT_SOURCE_PLAN_COHORT_INVALID');
          seen.add(row.id); rows.push(row);
        }
        if (values.length < 100) return rows;
      }
      throw new Error('CURRENT_SOURCE_PLAN_COHORT_INCOMPLETE');
    };
    const comments = await collect('comments');
    const events = await collect('events');
    for (const comment of comments) {
      if (comment.user?.login !== 'Cheekyfellastef' || comment.author_association !== 'OWNER') continue;
      if (typeof comment.body !== 'string') return held('CURRENT_SOURCE_PLAN_OWNER_EVIDENCE_INVALID');
      if (comment.body.includes(GITHUB_GOAL_ADMISSION_MARKER)
          && !parseGoalAdmissionBody(comment.body, issueNumber, SEED_CORRECTION_REPOSITORY)) {
        return held('CURRENT_SOURCE_PLAN_OWNER_EVIDENCE_INVALID');
      }
    }
    const current = await read(issueUrl);
    if (current?.number !== issueNumber || current.url !== issueUrl || current.state !== issue.state
        || current.updated_at !== issue.updated_at || current.body !== issue.body
        || JSON.stringify(current.labels) !== JSON.stringify(issue.labels)) return held('CURRENT_SOURCE_PLAN_ISSUE_CHANGED');
    const observedAtUtc = new Date(now).toISOString();
    const normalized = normalizeGoalIssue(issue, SEED_CORRECTION_REPOSITORY,
      observedAtUtc, comments, 'Cheekyfellastef', events, null);
    if (!normalized || normalized.admissionState !== 'ADMISSION_PROVEN'
        || normalized.operatorLaneContainment?.active === true
        || !['OWNER_AUTHENTICATED_COMMENT', 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT'].includes(normalized.admissionProofSource)) {
      return held('CURRENT_SOURCE_PLAN_OWNER_ADMISSION_UNPROVEN');
    }
    if (controller.signal.aborted || Date.now() - started >= SEED_CORRECTION_MAX_OBSERVATION_MS) {
      return held('CURRENT_SOURCE_PLAN_OBSERVATION_DEADLINE');
    }
    const ownerEvidence = comments.filter(comment => comment.user?.login === 'Cheekyfellastef'
      && comment.author_association === 'OWNER').map(comment => ({ id: comment.id,
      createdAt: comment.created_at, updatedAt: comment.updated_at,
      bodySha256: createHash('sha256').update(String(comment.body), 'utf8').digest('hex') }));
    const selectedAuthority = normalizedGoalDecisionEvidence.get(normalized);
    if (!selectedAuthority?.scope || !Number.isSafeInteger(selectedAuthority.scope.commentId
        || selectedAuthority.scope.eventId)) return held('CURRENT_SOURCE_PLAN_SELECTED_AUTHORITY_UNPROVEN');
    for (const selected of [selectedAuthority.scope, selectedAuthority.tests].filter(Boolean)) {
      if (selected.kind === 'OWNER_AUTHENTICATED_COMMENT') {
        const created = Date.parse(selected.createdAt), updated = Date.parse(selected.updatedAt);
        if (!Number.isFinite(created) || !Number.isFinite(updated) || created > updated || updated > now) {
          return held('CURRENT_SOURCE_PLAN_SELECTED_AUTHORITY_TIME_INVALID');
        }
      } else {
        const event = events.find(row => row.id === selected.eventId), created = Date.parse(event?.created_at);
        if (!Number.isFinite(created) || created > now) return held('CURRENT_SOURCE_PLAN_SELECTED_AUTHORITY_TIME_INVALID');
      }
    }
    const containment = normalized.operatorLaneContainment;
    const ownerCorpus = [issue.body, ...comments.filter(comment => comment.user?.login === 'Cheekyfellastef'
      && comment.author_association === 'OWNER').map(comment => comment.body)].join('\n');
    const seedAssociation = /\bseedGrowthWork\b/.test(ownerCorpus)
      ? Object.freeze({ associated: true, classification: 'UNKNOWN', reason: 'CURRENT_OWNER_SEED_METADATA_MENTIONED' })
      : projectSeedSourceAssociationV1({ issueBody: ownerCorpus });
    const authorityFingerprint = createHash('sha256').update(JSON.stringify({ repository: SEED_CORRECTION_REPOSITORY,
      issueNumber, admission: normalized.admission, selectedAuthority,
      containment: { action: containment?.action, commandId: containment?.commandId,
        sourceCommentId: containment?.sourceCommentId, frozenHead: containment?.frozenHead,
        resourceIds: containment?.resourceIds } }), 'utf8').digest('hex');
    return Object.freeze({ status: 'observed', reasonCode: 'CURRENT_SOURCE_PLAN_PRIVATE_PRODUCER_REQUIRED',
      sourceMutationAllowed: false, dispatchAllowed: false, observedAtUtc,
      issue: normalized, issueBody: issue.body, issueUpdatedAt: issue.updated_at,
      ownerEvidence: Object.freeze(ownerEvidence), selectedAuthority, authorityFingerprint,
      seedAssociation,
      frameFingerprint: createHash('sha256').update(JSON.stringify({ issueNumber,
        body: issue.body, updatedAt: issue.updated_at, admission: normalized.admission,
        ownerEvidence, events }), 'utf8').digest('hex'),
      complete: true });
  } catch (error) {
    return held(controller.signal.aborted ? 'CURRENT_SOURCE_PLAN_OBSERVATION_DEADLINE'
      : ['CURRENT_SOURCE_PLAN_COHORT_INCOMPLETE', 'CURRENT_SOURCE_PLAN_COHORT_INVALID'].includes(error.message)
        ? error.message : 'CURRENT_SOURCE_PLAN_OBSERVATION_FAILED');
  } finally { clearTimeout(timer); }
}


const CANONICAL_MUTABLE_GOAL_REPOSITORY = 'Cheekyfellastef/stephan-os';

async function githubIssueRequestWithFallback({
  owner,
  repo,
  issueNumber,
  method = 'GET',
  body,
  auth,
  ghTokenProvider,
  fetchImpl = fetch,
  userAgent,
} = {}) {
  let activeAuth = auth || { configured: false, authority: 'unknown', token: '' };
  const url = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`;
  const request = async (candidateAuth) => fetchImpl(url, {
    method,
    headers: {
      ...githubHeaders(candidateAuth, userAgent),
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!activeAuth?.configured || !asText(activeAuth?.token)) {
    return { ok: false, status: 0, auth: activeAuth, payload: null };
  }
  let response;
  try {
    response = await request(activeAuth);
  } catch {
    return { ok: false, status: 0, auth: activeAuth, payload: null };
  }
  if ([401, 403].includes(response.status) && activeAuth.authority !== 'gh-cli') {
    const ghAuth = await resolveGithubGhCliAuth({ ghTokenProvider });
    if (ghAuth.configured) {
      activeAuth = ghAuth;
      try {
        response = await request(activeAuth);
      } catch {
        return { ok: false, status: 0, auth: activeAuth, payload: null };
      }
    }
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {}
  return { ok: response.ok, status: response.status, auth: activeAuth, payload };
}

function normalizeMutableGoalIssue(payload, repository) {
  const issueNumber = Number(payload?.number);
  if (!Number.isSafeInteger(issueNumber) || issueNumber < 1) return null;
  return Object.freeze({
    number: issueNumber,
    state: asText(payload?.state).toLowerCase(),
    state_reason: asText(payload?.state_reason).toLowerCase(),
    title: asText(payload?.title),
    body: asText(payload?.body).slice(0, 64 * 1024),
    labels: Object.freeze((Array.isArray(payload?.labels) ? payload.labels : []).map((label) => Object.freeze({
      name: asText(typeof label === 'string' ? label : label?.name),
    }))),
    pull_request: payload?.pull_request ? Object.freeze({ present: true }) : null,
    repository,
  });
}

export async function readGithubGoalIssue({
  owner,
  repo,
  issueNumber,
  auth,
  ghTokenProvider,
  fetchImpl = fetch,
} = {}) {
  const repository = `${asText(owner)}/${asText(repo)}`;
  if (repository !== CANONICAL_MUTABLE_GOAL_REPOSITORY || !Number.isSafeInteger(Number(issueNumber)) || Number(issueNumber) < 1) {
    return Object.freeze({ ok: false, reason: 'CANONICAL_GOAL_ISSUE_IDENTITY_REQUIRED' });
  }
  const response = await githubIssueRequestWithFallback({
    owner,
    repo,
    issueNumber: Number(issueNumber),
    auth,
    ghTokenProvider,
    fetchImpl,
    userAgent: 'stephanos-goal-closure-read',
  });
  if (!response.ok) return Object.freeze({ ok: false, reason: `GITHUB_GOAL_ISSUE_READ_FAILED_${response.status}` });
  const issue = normalizeMutableGoalIssue(response.payload, repository);
  return issue ?? Object.freeze({ ok: false, reason: 'GITHUB_GOAL_ISSUE_READ_INVALID' });
}

export async function closeGithubGoalIssue({
  owner,
  repo,
  issueNumber,
  auth,
  ghTokenProvider,
  fetchImpl = fetch,
} = {}) {
  const repository = `${asText(owner)}/${asText(repo)}`;
  if (repository !== CANONICAL_MUTABLE_GOAL_REPOSITORY || !Number.isSafeInteger(Number(issueNumber)) || Number(issueNumber) < 1) {
    return Object.freeze({ ok: false, reason: 'CANONICAL_GOAL_ISSUE_IDENTITY_REQUIRED' });
  }
  const response = await githubIssueRequestWithFallback({
    owner,
    repo,
    issueNumber: Number(issueNumber),
    method: 'PATCH',
    body: { state: 'closed', state_reason: 'completed' },
    auth,
    ghTokenProvider,
    fetchImpl,
    userAgent: 'stephanos-goal-closure-write',
  });
  if (!response.ok) return Object.freeze({ ok: false, reason: `GITHUB_GOAL_ISSUE_CLOSE_FAILED_${response.status}` });
  const issue = normalizeMutableGoalIssue(response.payload, repository);
  if (
    !issue
    || issue.state !== 'closed'
    || issue.state_reason !== 'completed'
    || issue.number !== Number(issueNumber)
  ) {
    return Object.freeze({ ok: false, reason: 'GITHUB_GOAL_ISSUE_CLOSE_UNCONFIRMED' });
  }
  githubGoalEstateCache.delete(repository.toLowerCase());
  return issue;
}

export async function fetchGithubGoalIssues({ owner, repo, token, auth, ghTokenProvider, fetchImpl = fetch, maxPages = 10, maxCommentPages = 10, maxEventPages = 10, priorGoalRecords = [], requiredPrimaryOwnerCommentIssueNumbers, cacheEnabled, cacheTtlMs = GITHUB_GOAL_ESTATE_CACHE_TTL_MS, failureBackoffMs = GITHUB_GOAL_ESTATE_FAILURE_BACKOFF_MS, requestTimeoutMs = GITHUB_GOAL_ESTATE_REQUEST_TIMEOUT_MS, nowMs = Date.now, workspaceRoot } = {}) {
  const repository = `${asText(owner)}/${asText(repo)}`;
  if (!parseRepoSlug(repository).owner) return Object.freeze({ status: 'error', source: 'github-api', repository, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), recommendedNextAction: 'GitHub goal-estate repository identity is invalid.' });

  const primaryRequirement = projectPrimaryOwnerCommentReadRequirementV1(requiredPrimaryOwnerCommentIssueNumbers);
  if (!primaryRequirement.valid) return Object.freeze({ status: 'error', source: 'github-api', repository, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), reasonCode: 'PRIMARY_OWNER_READ_REQUIREMENT_INVALID' });
  const rawNowMs = Number(typeof nowMs === 'function' ? nowMs() : nowMs); const observedNowMs = Number.isFinite(rawNowMs) ? rawNowMs : Date.now();
  // All production goal discovery uses the same durable rate-limit HOLD as
  // dashboard telemetry, PR evidence and the gh observation broker. Injected
  // fetch tests use only an explicitly provided test workspace.
  const useSharedHold = fetchImpl === fetch || Boolean(workspaceRoot);
  const repoHold = useSharedHold
    ? readBrokeredGithubRateLimitHold({ repository, workspaceRoot, nowMs: observedNowMs })
    : null;
  if (repoHold) return Object.freeze({
    status: 'error', source: 'github-api', repository,
    issues: Object.freeze([]), discoveredIssues: Object.freeze([]),
    reasonCode: 'GITHUB_GOAL_ESTATE_RATE_LIMIT_BACKOFF',
    retryAfterUtc: repoHold.retryAfterUtc, rateLimitHold: repoHold,
    recommendedNextAction: 'GitHub quota is held. Do not refresh or admit goal evidence until the shared retry deadline.',
  });
  const boundedCacheTtlMs = Math.min(Math.max(Number(cacheTtlMs) || GITHUB_GOAL_ESTATE_CACHE_TTL_MS, 15_000), GITHUB_GOAL_ESTATE_CACHE_MAX_TTL_MS);
  const boundedFailureBackoffMs = Math.min(Math.max(Number(failureBackoffMs) || GITHUB_GOAL_ESTATE_FAILURE_BACKOFF_MS, 5_000), 5 * 60 * 1000);
  const boundedRequestTimeoutMs = Math.min(Math.max(Number(requestTimeoutMs) || GITHUB_GOAL_ESTATE_REQUEST_TIMEOUT_MS, 1_000), 30_000);
  const shouldUseCache = cacheEnabled === undefined ? fetchImpl === fetch : cacheEnabled === true; const cacheKey = repository.toLowerCase();
  if (shouldUseCache) {
    const cached = githubGoalEstateCache.get(cacheKey); const cacheAgeMs = cached ? observedNowMs - cached.cachedAtMs : Number.POSITIVE_INFINITY;
    const ttl = cached?.failure ? boundedFailureBackoffMs : boundedCacheTtlMs;
    if (cached && cacheAgeMs >= 0 && cacheAgeMs < ttl
        && (cached.failure || goalEstateCoversPrimaryOwnerCommentReadV1(cached.result, primaryRequirement, new Date(observedNowMs).toISOString()))) return cached.result;
  }
  const cacheFailure = (result) => { if (shouldUseCache) githubGoalEstateCache.set(cacheKey, { cachedAtMs: observedNowMs, result, failure: true }); return result; };

  let activeAuth = auth || { token, authority: 'unknown', configured: Boolean(token) };
  if (!activeAuth?.configured || !asText(activeAuth?.token)) return cacheFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: asText(activeAuth?.authority, 'unknown'), issues: Object.freeze([]), discoveredIssues: Object.freeze([]), recommendedNextAction: 'GitHub read authority is unavailable.' }));

  const observationController = new AbortController();
  const observationTimer = setTimeout(() => observationController.abort(), boundedRequestTimeoutMs);
  observationTimer.unref?.();
  const finishFailure = (result) => { clearTimeout(observationTimer); return cacheFailure(result); };

  const throwIfQuotaLimited = async (response) => {
    if (![403, 429].includes(response?.status)) return;
    const remaining = String(response.headers?.get?.('x-ratelimit-remaining') ?? '');
    let message = '';
    try { message = String((await response.json())?.message ?? ''); } catch {}
    if (response.status !== 429 && remaining !== '0'
        && !/(?:api|secondary) rate limit exceeded|rate limit exceeded|exceeded (?:a |the )?secondary rate limit|too many requests/i.test(message)) return;
    const now = Date.now();
    const retrySeconds = Number(response.headers?.get?.('retry-after'));
    const resetSeconds = Number(response.headers?.get?.('x-ratelimit-reset'));
    const requestedMs = Number.isFinite(retrySeconds) && retrySeconds > 0
      ? retrySeconds * 1000
      : Number.isFinite(resetSeconds) && resetSeconds > 0
        ? resetSeconds * 1000 - now + 5_000
        : 120_000;
    const delayMs = Math.min(65 * 60_000, Math.max(30_000, requestedMs));
    const recorded = useSharedHold ? recordBrokeredGithubRateLimitHold({
      repository, workspaceRoot, nowMs: now, retryAfterMs: delayMs,
    }) : null;
    const error = new Error('GITHUB_GOAL_ESTATE_RATE_LIMIT_BACKOFF');
    error.code = 'GITHUB_GOAL_ESTATE_RATE_LIMIT_BACKOFF';
    error.retryAfterUtc = recorded?.retryAfterUtc || new Date(now + delayMs).toISOString();
    throw error;
  };

  const requestWithFallback = async (url, userAgent) => {
    if (observationController.signal.aborted) return { ok: false, status: 408 };
    const request = (candidateAuth) => fetchImpl(url, { headers: githubHeaders(candidateAuth, userAgent), signal: observationController.signal });
    let response;
    try { response = await request(activeAuth); } catch (error) { return { ok: false, status: error?.name === 'AbortError' ? 408 : 0 }; }
    // Stop the entire paginated goal scan at its first actual quota error.
    // A permission-only 403 retains its existing authenticated fallback.
    await throwIfQuotaLimited(response);
    if ([401, 403].includes(response.status) && activeAuth.authority !== 'gh-cli' && !observationController.signal.aborted) {
      const ghAuth = await resolveGithubGhCliAuth({ ghTokenProvider });
      if (ghAuth.configured) { activeAuth = ghAuth; try { response = await request(activeAuth); } catch (error) { return { ok: false, status: error?.name === 'AbortError' ? 408 : 0 }; } }
    }
    await throwIfQuotaLimited(response);
    return response;
  };

  const pageLimit = Math.min(Math.max(Number(maxPages) || 1, 1), 10); const commentPageLimit = Math.min(Math.max(Number(maxCommentPages) || 1, 1), 10); const eventPageLimit = Math.min(Math.max(Number(maxEventPages) || 1, 1), 10); const retrievedAt = new Date(observedNowMs).toISOString(); const issues = []; const discoveredIssues = []; let admissionReadFailureCount = 0;
  const goalDeadlineError = () => Object.assign(new Error('Goal estate deadline exceeded'), { code: 'GITHUB_GOAL_ESTATE_DEADLINE' });
  const inspectGoal = async (issue) => {
    const discovery = normalizeGoalDiscovery(issue, repository, retrievedAt); if (!discovery) return; discoveredIssues.push(discovery);
    const priorMirrorAdmission = primaryRequirement.issueNumbers.includes(discovery.issueNumber) ? null : trustedPriorGoalMirrorAdmission(
      discovery,
      priorGoalRecords,
      owner,
      repository,
      issue?.body,
    );
    if (priorMirrorAdmission) {
      const revalidated = normalizeGoalIssue(
        issue,
        repository,
        retrievedAt,
        [],
        owner,
        [],
        priorMirrorAdmission,
      );
      if (revalidated) issues.push(revalidated);
      return;
    }
    const ownerAuthored = asText(issue?.user?.login).toLowerCase() === asText(owner).toLowerCase() && asText(issue?.author_association).toUpperCase() === 'OWNER';
    let admissionEvents = [];
    if (ownerAuthored) {
      const events = []; let eventsReadable = true; let eventsComplete = false;
      for (let eventPage = 1; eventPage <= eventPageLimit; eventPage += 1) {
        const eventsResponse = await requestWithFallback(`https://api.github.com/repos/${owner}/${repo}/issues/${discovery.issueNumber}/events?per_page=100&page=${eventPage}`, 'stephanos-readonly-goal-label-authority');
        if (!eventsResponse.ok) { eventsReadable = false; break; }
        let eventsPage;
        try { eventsPage = await eventsResponse.json(); } catch { eventsReadable = false; break; }
        if (!Array.isArray(eventsPage)) { eventsReadable = false; break; }
        events.push(...eventsPage); if (eventsPage.length < 100) { eventsComplete = true; break; }
      }
      if (eventsReadable && eventsComplete) {
        admissionEvents = events;
        const directlyAdmitted = normalizeGoalIssue(issue, repository, retrievedAt, [], owner, events);
        const hasComments = Number(issue?.comments) > 0;
        if (directlyAdmitted?.admissionProofSource === 'OWNER_AUTHENTICATED_GOAL_LABEL_EVENT' && !hasComments) {
          issues.push(directlyAdmitted);
          return;
        }
      } else {
        admissionReadFailureCount += 1;
        if (observationController.signal.aborted) throw goalDeadlineError();
      }
    }
    const comments = []; let commentsReadable = true; let commentsComplete = false;
    for (let commentPage = 1; commentPage <= commentPageLimit; commentPage += 1) {
      const commentsResponse = await requestWithFallback(`https://api.github.com/repos/${owner}/${repo}/issues/${discovery.issueNumber}/comments?per_page=100&page=${commentPage}`, 'stephanos-readonly-goal-admission');
      if (!commentsResponse.ok) { commentsReadable = false; break; }
      let commentsPage;
      try { commentsPage = await commentsResponse.json(); } catch { commentsReadable = false; break; }
      if (!Array.isArray(commentsPage)) { commentsReadable = false; break; }
      comments.push(...commentsPage); if (commentsPage.length < 100) { commentsComplete = true; break; }
    }
    if (!commentsReadable || !commentsComplete) { admissionReadFailureCount += 1; if (observationController.signal.aborted) throw goalDeadlineError(); return; }
    const normalized = normalizeGoalIssue(issue, repository, retrievedAt, comments, owner, admissionEvents); if (normalized) issues.push(normalized);
  };
  try {
  for (let page = 1; page <= pageLimit; page += 1) {
    const response = await requestWithFallback(`https://api.github.com/repos/${owner}/${repo}/issues?state=open&labels=goal&per_page=100&page=${page}`, 'stephanos-readonly-goal-estate');
    if (!response.ok) return finishFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), retrievedAt, recommendedNextAction: `GitHub goal-estate request failed (${response.status}).` }));
    let payload;
    try { payload = await response.json(); } catch (error) { return finishFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), retrievedAt, recommendedNextAction: `GitHub goal-estate response failed (${error?.name === 'AbortError' ? 408 : 0}).` })); }
    if (!Array.isArray(payload)) return finishFailure(Object.freeze({ status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze([]), discoveredIssues: Object.freeze([]), retrievedAt, recommendedNextAction: 'GitHub goal-estate response was not an issue list.' }));
    let nextGoal = 0;
    let admissionFailure = null;
    // Bound independent authority reads; retain one global deadline and drain
    // every started read before a quota/deadline failure can leave this scan.
    await Promise.all(Array.from({ length: Math.min(4, payload.length) }, async () => {
      while (nextGoal < payload.length && !admissionFailure && !observationController.signal.aborted) {
        const issue = payload[nextGoal++];
        try {
          await inspectGoal(issue);
        } catch (error) {
          admissionFailure ||= error;
          observationController.abort();
        }
      }
    }));
    if (admissionFailure) throw admissionFailure;
    if (observationController.signal.aborted) throw goalDeadlineError();
    if (payload.length < 100) break;
  }
  } catch (error) {
    clearTimeout(observationTimer);
    if (error?.code === 'GITHUB_GOAL_ESTATE_DEADLINE') return finishFailure(Object.freeze({
      status: 'error', source: 'github-api', repository, authAuthority: activeAuth.authority,
      issues: Object.freeze([]), discoveredIssues: Object.freeze(discoveredIssues), retrievedAt,
      recommendedNextAction: 'GitHub goal-estate observation exceeded its bounded deadline (408).',
    }));
    if (error?.code !== 'GITHUB_GOAL_ESTATE_RATE_LIMIT_BACKOFF') throw error;
    return finishFailure(Object.freeze({
      status: 'error', source: 'github-api', repository,
      authAuthority: activeAuth.authority, issues: Object.freeze([]),
      discoveredIssues: Object.freeze([]), retrievedAt,
      reasonCode: error.code, retryAfterUtc: error.retryAfterUtc,
      recommendedNextAction: 'GitHub goal-estate quota exhausted: hold the complete scan until retry; do not infer missing admission evidence.',
    }));
  }
  const deduped = [...new Map(issues.map((issue) => [issue.issueNumber, issue])).values()].sort((a,b) => a.issueNumber-b.issueNumber);
  const dedupedDiscoveries = [...new Map(discoveredIssues.map((issue) => [issue.issueNumber, issue])).values()].sort((a,b) => a.issueNumber-b.issueNumber);
  const result = Object.freeze({ ...(primaryRequirement.requested ? { primaryOwnerCommentRequestIssueNumbers: primaryRequirement.issueNumbers } : {}), status: 'fetched', source: 'github-api', repository, authAuthority: activeAuth.authority, issues: Object.freeze(deduped), discoveredIssues: Object.freeze(dedupedDiscoveries), retrievedAt, readOnly: true, admissionContractRequired: true, ownerAuthoredGoalsAutoAdmitted: false, admissionProofSources: Object.freeze(['OWNER_AUTHENTICATED_GOAL_LABEL_EVENT', 'OWNER_AUTHENTICATED_COMMENT', 'PRIOR_MIRROR_ADMISSION_REVALIDATED']), admissionReadFailureCount, admissionSchemaVersion: GITHUB_GOAL_ADMISSION_SCHEMA, mergeAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false });
  clearTimeout(observationTimer);
  if (shouldUseCache) githubGoalEstateCache.set(cacheKey, { cachedAtMs: observedNowMs, result, failure: false }); return result;
}

// A failing authenticated read must not make every supervised controller tick
// spend another API request. Backoff is an outage hold, never cached PR truth.
const GITHUB_PR_RATE_LIMIT_MIN_BACKOFF_MS = 30_000;
const GITHUB_PR_RATE_LIMIT_DEFAULT_BACKOFF_MS = 120_000;
const GITHUB_PR_RATE_LIMIT_MAX_BACKOFF_MS = 65 * 60_000;
const githubPrRateLimitBackoff = new Map();

function githubPrRateLimitHold(owner, repo, prNumber, authority, untilMs) {
  return {
    status: 'error',
    source: 'github-api',
    owner,
    repo,
    prNumber,
    authAuthority: authority,
    reasonCode: 'GITHUB_PR_RATE_LIMIT_BACKOFF',
    retryAfterUtc: new Date(untilMs).toISOString(),
    recommendedNextAction: 'GitHub PR evidence is rate-limited. Retain the exact-head HOLD and retry after the bounded backoff.',
  };
}

async function checkPrRateLimitResponse(response, key, owner, repo, prNumber, authority, workspaceRoot, useSharedHold) {
  if (![403, 429].includes(response?.status)) return null;
  const remaining = String(response.headers?.get?.('x-ratelimit-remaining') ?? '');
  let message = '';
  try { message = String((await response.json())?.message ?? ''); } catch {}
  const limited = response.status === 429
    || remaining === '0'
    || /(?:api|secondary) rate limit exceeded|rate limit exceeded|exceeded (?:a |the )?secondary rate limit|too many requests/i.test(message);
  if (!limited) return null;
  const nowMs = Date.now();
  const resetSeconds = Number(response.headers?.get?.('x-ratelimit-reset'));
  const retrySeconds = Number(response.headers?.get?.('retry-after'));
  const requestedMs = Number.isFinite(retrySeconds) && retrySeconds > 0
    ? retrySeconds * 1000
    : Number.isFinite(resetSeconds) && resetSeconds > 0
      ? resetSeconds * 1000 - nowMs + 5000
      : GITHUB_PR_RATE_LIMIT_DEFAULT_BACKOFF_MS;
  const delayMs = Math.min(GITHUB_PR_RATE_LIMIT_MAX_BACKOFF_MS,
    Math.max(GITHUB_PR_RATE_LIMIT_MIN_BACKOFF_MS, requestedMs));
  const shared = useSharedHold ? recordBrokeredGithubRateLimitHold({
    repository: key, retryAfterMs: delayMs, workspaceRoot, nowMs,
  }) : null;
  const untilMs = Math.max(githubPrRateLimitBackoff.get(key) || 0, shared?.untilMs || 0, nowMs + delayMs);
  githubPrRateLimitBackoff.set(key, untilMs);
  return githubPrRateLimitHold(owner, repo, prNumber, authority, untilMs);
}

export async function fetchGithubPrEvidence({ owner, repo, prNumber, token, auth, ghTokenProvider, fetchImpl = fetch, workspaceRoot }) {
  let activeAuth = auth || { token, authority: 'unknown', configured: Boolean(token) };
  const key = `${String(owner).toLowerCase()}/${String(repo).toLowerCase()}`;
  // Injected fetch tests must not touch an operator's Shared Workspace unless
  // they provide their own test workspaceRoot. Production readers always share it.
  const useSharedHold = fetchImpl === fetch || Boolean(workspaceRoot);
  const sharedHold = useSharedHold ? readBrokeredGithubRateLimitHold({ repository: key, workspaceRoot }) : null;
  const holdUntilMs = Math.max(githubPrRateLimitBackoff.get(key) || 0, sharedHold?.untilMs || 0);
  if (holdUntilMs > Date.now()) {
    return githubPrRateLimitHold(owner, repo, prNumber, activeAuth.authority, holdUntilMs);
  }
  if (holdUntilMs) githubPrRateLimitBackoff.delete(key);
  const request = async (candidateAuth) => fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, { headers: githubHeaders(candidateAuth, 'stephanos-readonly-pr-evidence') });
  let prRes = await request(activeAuth);
  let rateLimit = await checkPrRateLimitResponse(prRes, key, owner, repo, prNumber, activeAuth.authority, workspaceRoot, useSharedHold);
  if (rateLimit) return rateLimit;
  if ([401, 403].includes(prRes.status) && activeAuth.authority !== 'gh-cli') {
    const ghAuth = await resolveGithubGhCliAuth({ ghTokenProvider });
    if (ghAuth.configured) {
      activeAuth = ghAuth;
      prRes = await request(activeAuth);
      rateLimit = await checkPrRateLimitResponse(prRes, key, owner, repo, prNumber, activeAuth.authority, workspaceRoot, useSharedHold);
      if (rateLimit) return rateLimit;
    }
  }
  if (!prRes.ok) return { status: 'error', source: 'github-api', owner, repo, prNumber, authAuthority: activeAuth.authority, recommendedNextAction: `GitHub API request failed (${prRes.status}).` };
  const pr = await prRes.json(); const headers = githubHeaders(activeAuth, 'stephanos-readonly-pr-evidence');
  const filesRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`, { headers });
  const filesHold = await checkPrRateLimitResponse(filesRes, key, owner, repo, prNumber, activeAuth.authority, workspaceRoot, useSharedHold);
  if (filesHold) return filesHold;
  const files = filesRes.ok ? await filesRes.json() : [];
  const checksRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits/${pr.head?.sha}/check-runs`, { headers });
  const checksHold = await checkPrRateLimitResponse(checksRes, key, owner, repo, prNumber, activeAuth.authority, workspaceRoot, useSharedHold);
  if (checksHold) return checksHold;
  const checksPayload = checksRes.ok ? await checksRes.json() : { check_runs: [] };
  const commentsRes = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`, { headers });
  const commentsHold = await checkPrRateLimitResponse(commentsRes, key, owner, repo, prNumber, activeAuth.authority, workspaceRoot, useSharedHold);
  if (commentsHold) return commentsHold;
  const commentsPayload = commentsRes.ok ? await commentsRes.json() : [];
  const retrievedAt = new Date().toISOString(); const trustedOperatorApprovalReceipts = [];
  for (const comment of Array.isArray(commentsPayload) ? commentsPayload : []) { if (asText(comment?.user?.login).toLowerCase() !== 'github-actions[bot]') continue; if (!asText(comment?.body).includes(PROTECTED_APPROVAL_MARKER)) continue; for (const candidate of extractJsonObjects(comment.body)) { const projection = projectProtectedApprovalReceiptForWorkspace(candidate, { nowUtc: retrievedAt }); if (projection.valid) trustedOperatorApprovalReceipts.push(projection.receipt); } }
  const checkRuns = asList(checksPayload?.check_runs?.map((run) => run?.conclusion || run?.status));
  const failingChecks = asList(checksPayload?.check_runs?.filter((run) => ['failure','failed','timed_out','cancelled','action_required'].includes(asText(run?.conclusion || run?.status).toLowerCase())).map((run) => run?.name));
  const checksStatus = normalizeChecksState(checkRuns); const changedFiles = asList(files.map((file) => file?.filename)); const baseRepository = `${owner}/${repo}`; const headRepository = asText(pr.head?.repo?.full_name); const missingProof = []; if (checksStatus !== 'passed') missingProof.push('checks');
  const mergeReadiness = pr.merged ? 'already-merged' : checksStatus === 'failed' ? 'needs-amendment' : checksStatus === 'passed' ? 'merge-candidate' : 'needs-proof';
  return { status: 'fetched', source: 'github-api', authAuthority: activeAuth.authority, owner, repo, repository: headRepository, baseRepository, headRepository, headRepositoryMatchesBase: headRepository.toLowerCase() === baseRepository.toLowerCase(), prNumber: Number(pr.number || prNumber), prUrl: asText(pr.html_url), prTitle: asText(pr.title), prState: asText(pr.state, 'unknown'), merged: pr.merged === true, headSha: asText(pr.head?.sha), headBranch: asText(pr.head?.ref), baseBranch: asText(pr.base?.ref), baseSha: asText(pr.base?.sha), mergedAt: asText(pr.merged_at), closedAt: asText(pr.closed_at), mergeCommitSha: asText(pr.merge_commit_sha), changedFiles, changedFileCount: changedFiles.length, checksStatus, failingChecks, buildStatus: checksStatus === 'passed' ? 'passed' : 'unknown', verifyStatus: checksStatus === 'passed' ? 'passed' : 'unknown', browserProofStatus: 'unknown', codexTaskPresent: 'unknown', codexTaskRefs: [], retrievedAt, evidenceWarnings: [], missingProof, trustedOperatorApprovalReceipts, mergeReadiness, recommendedNextAction: mergeReadiness === 'merge-candidate' ? 'Operator approval required before merge.' : 'Collect remaining PR proof before merge decision.' };
}
