import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import {
  createSharedWorkspaceGoalRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';

export const FLYWHEEL_CANONICAL_GOAL_ADMISSION_SCHEMA_V1 =
  'stephanos.flywheel-canonical-goal-admission.v1';
export const FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1 = 'Cheekyfellastef/stephan-os';

export const FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1 = Object.freeze({
  schemaVersion: 'stephanos.flywheel-canonical-goal-admission-policy.v1',
  enabled: true,
  repository: FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1,
  parentIssue: 2670,
  acceptanceOwnerIssues: Object.freeze([1721, 1903, 2670, 2697]),
  authorizationIssue: 2697,
  authorityClass: 'NEW_GOAL_SCOPE_AUTHORIZED',
  scope: 'bounded-capability-gap-child-goal-issue-only',
  maxIssuesPerCycle: 4,
  sourceMutationAllowed: false,
  runtimeMutationAllowed: false,
  dispatchAllowed: false,
  mergeAllowed: false,
  deploymentAllowed: false,
  spendAllowed: false,
  credentialAccessAllowed: false,
  arbitraryShellAllowed: false,
});

const SAFE_ID = /^[a-z0-9][a-z0-9._:-]{0,119}$/i;
const SAFE_REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const SAFE_ISSUE_NUMBER = /^[1-9]\d*$/;

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function safeId(value, fallback = '') {
  const normalized = text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return SAFE_ID.test(normalized) ? normalized : fallback;
}

function issueNumber(value) {
  const normalized = typeof value === 'number' ? String(value) : text(value).replace(/^#/, '');
  if (!SAFE_ISSUE_NUMBER.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  if (Array.isArray(value)) return Object.freeze(value.map(freeze));
  for (const [key, child] of Object.entries(value)) value[key] = freeze(child);
  return Object.freeze(value);
}

export function validateFlywheelCanonicalGoalAdmissionPolicyV1(policy = {}) {
  const blockers = [];
  if (policy?.schemaVersion !== FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1.schemaVersion) blockers.push('policy-schema-invalid');
  if (policy?.enabled !== true) blockers.push('policy-disabled');
  if (text(policy?.repository).toLowerCase() !== FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1.toLowerCase()) blockers.push('policy-repository-not-canonical');
  if (issueNumber(policy?.parentIssue) !== 2670) blockers.push('policy-parent-mismatch');
  if (issueNumber(policy?.authorizationIssue) !== 2697) blockers.push('policy-authorization-mismatch');
  if (text(policy?.authorityClass) !== 'NEW_GOAL_SCOPE_AUTHORIZED') blockers.push('policy-authority-class-invalid');
  if (text(policy?.scope) !== 'bounded-capability-gap-child-goal-issue-only') blockers.push('policy-scope-invalid');
  if (policy?.sourceMutationAllowed === true) blockers.push('policy-source-mutation-forbidden');
  if (policy?.runtimeMutationAllowed === true) blockers.push('policy-runtime-mutation-forbidden');
  if (policy?.dispatchAllowed === true) blockers.push('policy-dispatch-forbidden');
  if (policy?.mergeAllowed === true) blockers.push('policy-merge-forbidden');
  if (policy?.deploymentAllowed === true) blockers.push('policy-deployment-forbidden');
  if (policy?.spendAllowed === true) blockers.push('policy-spend-forbidden');
  if (policy?.credentialAccessAllowed === true) blockers.push('policy-credential-access-forbidden');
  if (policy?.arbitraryShellAllowed === true) blockers.push('policy-arbitrary-shell-forbidden');
  return freeze({
    valid: blockers.length === 0,
    blockers,
    finalVerdict: blockers.length
      ? 'FLYWHEEL_CANONICAL_GOAL_POLICY_BLOCKED'
      : 'FLYWHEEL_CANONICAL_GOAL_POLICY_AUTHORIZED',
  });
}

export function flywheelCanonicalGoalMarkerV1(capabilityId) {
  const normalized = safeId(capabilityId, 'learned-capability-gap');
  return `stephanos-flywheel-gap:${normalized}`;
}

export function buildFlywheelCanonicalGoalIssueV1(input = {}) {
  const eventId = safeId(input.eventId, 'learning-gap-event');
  const capabilityId = safeId(input.capabilityId, 'learned-capability-gap');
  const marker = flywheelCanonicalGoalMarkerV1(capabilityId);
  const title = `Goal: Close learned capability gap - ${capabilityId}`.slice(0, 240);
  const evidenceRefs = Array.isArray(input.evidenceRefs)
    ? [...new Set(input.evidenceRefs.map((value) => text(value)).filter(Boolean))].slice(0, 20)
    : [];
  const body = [
    `<!-- ${marker} -->`,
    '',
    'Parent mission: #2670 Stephanos Whole-System Capability Closure.',
    'Acceptance owners: #1721, #1903 and #2697.',
    '',
    '## Detected capability gap',
    '',
    `Capability: \`${capabilityId}\``,
    `Learning event: \`${eventId}\``,
    '',
    'The persistent Flywheel observed an actionable capability failure with no canonical owner supplied by the learning record. This issue is the one bounded canonical child goal for that gap signature.',
    '',
    '## Required outcome',
    '',
    '- Re-run existing-goal ownership checks before implementation and attach/close as duplicate if a better canonical owner is proven.',
    '- Build the smallest reusable repair through the existing #1556 scheduler, Mission Worker, builders, review and proof machinery.',
    '- Replay the original capability failure plus transfer variants before closure.',
    '- Return reusable knowledge/method/proof to canonical Shared Workspace state.',
    '',
    '## Authority boundary',
    '',
    'This issue was admitted under the source-controlled #2697 NEW_GOAL_SCOPE_AUTHORIZED policy.',
    'Issue admission grants no source mutation, runtime mutation, dispatch, merge, deployment, spend, credential, arbitrary-shell or approval-bypass authority.',
    'All implementation actions remain subject to the existing scheduler, leases, proof and protected merge contracts.',
    '',
    ...(evidenceRefs.length ? ['## Evidence refs', '', ...evidenceRefs.map((ref) => `- \`${ref}\``), ''] : []),
    '## Completion marker',
    '',
    `\`\`\`text\nFLYWHEEL_GAP_REPAIRED:${capabilityId}\nORIGINAL_AND_TRANSFER_REPLAY_GREEN\nCANONICAL_STATE_UPDATED\n\`\`\``,
  ].join('\n');
  return freeze({
    schemaVersion: FLYWHEEL_CANONICAL_GOAL_ADMISSION_SCHEMA_V1,
    repository: FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1,
    eventId,
    capabilityId,
    marker,
    title,
    body,
    evidenceRefs,
  });
}

function captureGithub(spawnSyncFn, ghCommand, args, cwd = process.cwd()) {
  const result = spawnSyncFn(ghCommand, args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return freeze({
    ok: !result?.error && result?.status === 0,
    status: result?.status ?? null,
    stdout: String(result?.stdout ?? ''),
    stderr: String(result?.stderr ?? result?.error?.message ?? '').slice(0, 1000),
    errorCode: result?.error?.code || '',
  });
}

function parseJson(value) {
  try {
    return JSON.parse(String(value || ''));
  } catch {
    return null;
  }
}

export function createFixedFlywheelGitHubIssueAdapterV1(options = {}) {
  const spawnSyncFn = typeof options.spawnSyncFn === 'function' ? options.spawnSyncFn : spawnSync;
  const ghCommand = text(options.ghCommand, process.env.STEPHANOS_GH_COMMAND || 'gh');
  const cwd = options.cwd || process.cwd();
  const repository = FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1;

  return freeze({
    repository,
    arbitraryShellAllowed: false,
    sourceMutationAllowed: false,
    mergeAllowed: false,
    async findByMarker(marker) {
      const safeMarker = text(marker);
      if (!safeMarker || safeMarker.length > 160) {
        return freeze({ ok: false, reason: 'FLYWHEEL_CANONICAL_GOAL_MARKER_INVALID' });
      }
      const query = `repo:${repository} is:issue in:body "${safeMarker}"`;
      const result = captureGithub(
        spawnSyncFn,
        ghCommand,
        ['api', 'search/issues', '--method', 'GET', '-f', `q=${query}`, '-f', 'per_page=20'],
        cwd,
      );
      if (!result.ok) {
        return freeze({
          ok: false,
          reason: result.errorCode === 'ENOENT'
            ? 'FLYWHEEL_CANONICAL_GOAL_GH_CLI_MISSING'
            : 'FLYWHEEL_CANONICAL_GOAL_SEARCH_FAILED',
          status: result.status,
          error: result.stderr,
        });
      }
      const payload = parseJson(result.stdout);
      if (!payload || !Array.isArray(payload.items)) {
        return freeze({ ok: false, reason: 'FLYWHEEL_CANONICAL_GOAL_SEARCH_JSON_INVALID' });
      }
      const found = payload.items.find((item) => text(item?.body).includes(safeMarker));
      if (!found) return freeze({ ok: true, reason: 'FLYWHEEL_CANONICAL_GOAL_NOT_FOUND', issue: null });
      const number = issueNumber(found.number);
      if (!number) return freeze({ ok: false, reason: 'FLYWHEEL_CANONICAL_GOAL_SEARCH_ID_INVALID' });
      return freeze({
        ok: true,
        reason: 'FLYWHEEL_CANONICAL_GOAL_FOUND',
        issue: {
          number,
          title: text(found.title),
          url: text(found.html_url),
          state: text(found.state).toLowerCase(),
        },
      });
    },
    async createIssue(issue = {}) {
      const title = text(issue.title);
      const body = text(issue.body);
      if (!title || title.length > 240 || !body || Buffer.byteLength(body, 'utf8') > 32 * 1024) {
        return freeze({ ok: false, reason: 'FLYWHEEL_CANONICAL_GOAL_ISSUE_SHAPE_INVALID' });
      }
      const result = captureGithub(
        spawnSyncFn,
        ghCommand,
        ['api', `repos/${repository}/issues`, '--method', 'POST', '-f', `title=${title}`, '-f', `body=${body}`],
        cwd,
      );
      if (!result.ok) {
        return freeze({
          ok: false,
          reason: result.errorCode === 'ENOENT'
            ? 'FLYWHEEL_CANONICAL_GOAL_GH_CLI_MISSING'
            : 'FLYWHEEL_CANONICAL_GOAL_CREATE_FAILED',
          status: result.status,
          error: result.stderr,
        });
      }
      const payload = parseJson(result.stdout);
      const number = issueNumber(payload?.number);
      if (!number) return freeze({ ok: false, reason: 'FLYWHEEL_CANONICAL_GOAL_CREATE_JSON_INVALID' });
      return freeze({
        ok: true,
        reason: 'FLYWHEEL_CANONICAL_GOAL_CREATED',
        issue: {
          number,
          title: text(payload.title, title),
          url: text(payload.html_url),
          state: text(payload.state, 'open').toLowerCase(),
        },
      });
    },
  });
}

function schedulerGoalRecord(issue, issueShape, nowUtc) {
  const number = issueNumber(issue?.number);
  if (!number) return null;
  const timestampUtc = text(nowUtc);
  return freeze({
    ...createSharedWorkspaceGoalRecord({
      goalId: `goal-${number}`,
      participantId: 'durable-flywheel-controller',
      timestampUtc,
      title: text(issue.title, issueShape.title),
      status: 'READY',
    }),
    issueNumber: number,
    repository: FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1,
    route: 'CHATGPT_GITHUB',
    prerequisites: Object.freeze([]),
    priority: 50,
    criticalPathWeight: 1,
    reversibility: 'REVERSIBLE',
    approvalRequired: false,
    operatorPriority: false,
    proofState: 'PROPOSAL_ADMITTED',
    evidenceAt: timestampUtc,
    resultProofRefs: Object.freeze([]),
    admissionSource: 'flywheel-canonical-goal-admission-v1',
    correlationId: issueShape.eventId,
  });
}

async function admitSchedulerGoal({
  root,
  repoRoot,
  issue,
  issueShape,
  nowUtc,
  nowMs,
  readFileFn = readFile,
  writeAtomicJsonFn = writeAtomicJson,
} = {}) {
  const record = schedulerGoalRecord(issue, issueShape, nowUtc);
  if (!record) return freeze({ ok: false, reason: 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_INVALID' });
  const validation = validateSharedWorkspaceRecord(record, { nowMs });
  if (!validation.valid) {
    return freeze({
      ok: false,
      reason: 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_WORKSPACE_INVALID',
      validation,
    });
  }

  const segments = ['goals', `${record.goalId}.json`];
  const resolved = resolveSharedWorkspacePath({ root, repoRoot, segments });
  if (!resolved.ok) return freeze({ ok: false, reason: resolved.reason });

  try {
    const existing = JSON.parse(await readFileFn(resolved.path, 'utf8'));
    if (issueNumber(existing?.issueNumber) === record.issueNumber
      && text(existing?.repository).toLowerCase() === FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1.toLowerCase()) {
      return freeze({
        ok: true,
        reason: 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_ALREADY_ADMITTED',
        record: existing,
      });
    }
    return freeze({ ok: false, reason: 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_CONFLICT' });
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return freeze({ ok: false, reason: 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_READ_FAILED' });
    }
  }

  const write = await writeAtomicJsonFn(root, segments, record, { repoRoot, nowMs });
  if (write?.ok !== true) {
    return freeze({
      ok: false,
      reason: text(write?.reason, 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_WRITE_FAILED'),
    });
  }
  return freeze({
    ok: true,
    reason: 'FLYWHEEL_CANONICAL_SCHEDULER_GOAL_ADMITTED',
    record,
  });
}

export async function admitFlywheelCanonicalGoalV1(input = {}) {
  const policy = input.policy || FLYWHEEL_CANONICAL_GOAL_ADMISSION_POLICY_V1;
  const policyValidation = validateFlywheelCanonicalGoalAdmissionPolicyV1(policy);
  if (!policyValidation.valid) {
    return freeze({
      ok: false,
      authorized: false,
      reason: policyValidation.blockers[0] || 'FLYWHEEL_CANONICAL_GOAL_POLICY_BLOCKED',
      policyValidation,
    });
  }

  if (input.canonicalGoalAdmissionAuthorized !== true) {
    return freeze({
      ok: false,
      authorized: false,
      reason: 'FLYWHEEL_CANONICAL_GOAL_PRODUCTION_AUTHORITY_REQUIRED',
    });
  }

  const issueShape = buildFlywheelCanonicalGoalIssueV1(input);
  const root = input.root || input.workspaceRoot;
  const repoRoot = input.repoRoot || process.cwd();
  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : Date.now();
  const nowUtc = text(input.nowUtc, new Date(nowMs).toISOString());
  const adapter = input.githubAdapter || createFixedFlywheelGitHubIssueAdapterV1({ cwd: repoRoot });

  if (!adapter || text(adapter.repository).toLowerCase() !== FLYWHEEL_CANONICAL_GOAL_REPOSITORY_V1.toLowerCase()) {
    return freeze({ ok: false, authorized: true, reason: 'FLYWHEEL_CANONICAL_GOAL_ADAPTER_REPOSITORY_MISMATCH' });
  }

  const existing = await adapter.findByMarker(issueShape.marker);
  if (existing?.ok !== true) {
    return freeze({
      ok: false,
      authorized: true,
      reason: text(existing?.reason, 'FLYWHEEL_CANONICAL_GOAL_SEARCH_FAILED'),
    });
  }

  let issue = existing.issue || null;
  let created = false;
  if (!issue) {
    const creation = await adapter.createIssue(issueShape);
    if (creation?.ok !== true) {
      return freeze({
        ok: false,
        authorized: true,
        reason: text(creation?.reason, 'FLYWHEEL_CANONICAL_GOAL_CREATE_FAILED'),
      });
    }
    issue = creation.issue;
    created = true;
  }

  const schedulerAdmission = await admitSchedulerGoal({
    root,
    repoRoot,
    issue,
    issueShape,
    nowUtc,
    nowMs,
    readFileFn: input.readFileFn,
    writeAtomicJsonFn: input.writeAtomicJsonFn,
  });
  if (!schedulerAdmission.ok) {
    return freeze({
      ok: false,
      authorized: true,
      issue,
      created,
      reason: schedulerAdmission.reason,
      schedulerAdmission,
    });
  }

  return freeze({
    schemaVersion: FLYWHEEL_CANONICAL_GOAL_ADMISSION_SCHEMA_V1,
    ok: true,
    authorized: true,
    created,
    deduped: !created,
    reason: created
      ? 'FLYWHEEL_CANONICAL_GOAL_CREATED_AND_ADMITTED'
      : 'FLYWHEEL_CANONICAL_GOAL_DEDUPED_AND_ADMITTED',
    eventId: issueShape.eventId,
    capabilityId: issueShape.capabilityId,
    marker: issueShape.marker,
    issue,
    schedulerGoal: schedulerAdmission.record,
    authority: {
      authorityClass: policy.authorityClass,
      authorizationIssue: policy.authorizationIssue,
      parentIssue: policy.parentIssue,
      githubIssueCreationAllowed: true,
      sourceMutationAllowed: false,
      runtimeMutationAllowed: false,
      dispatchAllowed: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      spendAllowed: false,
      credentialAccessAllowed: false,
      arbitraryShellAllowed: false,
    },
    finalVerdict: 'FLYWHEEL_CANONICAL_GOAL_ADMISSION_READY',
  });
}
