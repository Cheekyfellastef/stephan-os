import { execFile } from 'node:child_process';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';

import {
  PROGRAMME_CONTROLLER_HEARTBEAT_STATUS_ID,
  PROGRAMME_STALL_MONITOR_HANDLER_ID,
  SOURCE_MUTATION_LEASE_RELEASE_SCHEMA,
  SOURCE_MUTATION_LEASE_STATUS_ID,
  TERMINAL_LANE_FINALIZATION_SCHEMA,
  buildAuthoritativeProgrammeProjection,
  buildCanonicalImplementationLaneProjection,
  buildProgrammeStallMonitorDefinition,
  buildSchedulerGoalsFromProgrammeSources,
  buildTerminalLaneFinalizationPlan,
  createProgrammeControllerHeartbeat,
  createProgrammeStallMonitorHandler,
  createSourceMutationLeaseRecord,
  createSourceMutationLeaseReleaseRecord,
  createTerminalLaneEvidenceId,
  createTerminalLaneEvidenceRecords,
  projectProgrammeControllerHeartbeat,
  renewSourceMutationLeaseRecord,
  validateSourceMutationLease,
} from '../../shared/agents/programmeAuthorityV1.mjs';
import {
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import { readSharedWorkspaceDashboardFeed } from '../../shared/agents/shared-workspace-dashboard-feed.mjs';
import {
  acquireSharedWorkspaceOperationLock,
  readCurrentExecutionReceipt,
} from '../../shared/agents/executionReceiptV1.mjs';
import { buildCriticalBacklogProjection } from '../../shared/agents/criticalBacklogConveyor.mjs';
import { buildStephanosCapabilityRegistryProjection } from '../../shared/agents/stephanosCapabilityRegistry.mjs';
import { buildMissionScheduler } from '../../shared/runtime/missionScheduler.mjs';
import {
  fetchGithubPrEvidence,
  resolveGithubTokenConfig,
} from './githubPrEvidenceService.js';
import { listMissionRecords } from './missionOrchestratorStore.js';
import { validateExistingSharedWorkspaceRuntimeConfig } from '../../shared/agents/sharedWorkspaceRuntimeConfig.mjs';
import {
  projectMissionWorkerHeartbeat,
  resolveCanonicalMissionWorkerPaths,
} from '../../scripts/mission-orchestrator-worker-heartbeat.mjs';

export const PROGRAMME_AUTHORITY_SERVICE_SCHEMA = 'stephanos.programme-authority-service.v1';
export const SOURCE_MUTATION_LEASE_FILE = `${SOURCE_MUTATION_LEASE_STATUS_ID}.json`;
export const PROGRAMME_CONTROLLER_HEARTBEAT_FILE = `${PROGRAMME_CONTROLLER_HEARTBEAT_STATUS_ID}.json`;
const SOURCE_MUTATION_LEASE_OPERATION_GUARD_FILE = 'source-mutation-lease-operation.lock';
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const SHA_40 = /^[0-9a-f]{40}$/i;
const execFileAsync = promisify(execFile);
const AFFIRMATIVE_PROOF_STATUSES = new Set([
  'COMPLETE',
  'COMPLETED',
  'MERGED',
  'PASS',
  'PASSED',
  'PROVED',
  'SUCCEEDED',
  'SUCCESS',
  'VERIFIED',
]);

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value : [];
}

function safeNow(value) {
  const normalized = text(value);
  return EXPLICIT_TIMEZONE.test(normalized) && Number.isFinite(Date.parse(normalized))
    ? new Date(Date.parse(normalized)).toISOString()
    : '';
}

function parseRepository(value) {
  const match = /^([a-z0-9_.-]+)\/([a-z0-9_.-]+)$/i.exec(text(value));
  return match ? { owner: match[1], repo: match[2] } : null;
}

function positiveInteger(value) {
  const normalized = typeof value === 'number' ? String(value) : text(value).replace(/^#/, '');
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requestedLaneSelector(options = {}) {
  const requested = [
    options.targetLaneId,
    options.targetRepository,
    options.targetIssueNumber,
    options.targetPrNumber,
  ].some((value) => value !== undefined && value !== null && value !== '');
  const selector = {
    requested,
    laneId: text(options.targetLaneId),
    repository: text(options.targetRepository),
    issueNumber: positiveInteger(options.targetIssueNumber),
    prNumber: positiveInteger(options.targetPrNumber),
  };
  const complete = Boolean(
    selector.laneId
    && /^[a-z0-9][a-z0-9._:-]{0,79}$/i.test(selector.laneId)
    && parseRepository(selector.repository)
    && selector.issueNumber
    && selector.prNumber,
  );
  return Object.freeze({ ...selector, complete });
}

function dependencies(options = {}) {
  if (options.dependencies && options.testOnly !== true) {
    throw new TypeError('dependency overrides are test-only');
  }
  return {
    validateWorkspaceConfig: validateExistingSharedWorkspaceRuntimeConfig,
    readWorkspaceFeed: readSharedWorkspaceDashboardFeed,
    fetchGithubPrEvidence,
    resolveGithubTokenConfig,
    readCurrentExecutionReceipt,
    listMissionRecords,
    buildMissionScheduler,
    buildCriticalBacklogProjection,
    buildCapabilityRegistry: buildStephanosCapabilityRegistryProjection,
    acquireSharedWorkspaceOperationLock,
    readFile,
    writeFile,
    unlink,
    writeAtomicJson,
    readRepositoryHead: ({ repositoryRoot }) => readCanonicalRepositoryHead({
      repositoryRoot,
      execFileImpl: options.testOnly === true && options.execFile
        ? options.execFile
        : execFileAsync,
    }),
    ...(options.dependencies ?? {}),
  };
}

async function readCanonicalRepositoryHead({ repositoryRoot, execFileImpl = execFileAsync } = {}) {
  const expectedRepositoryRoot = text(repositoryRoot);
  if (!expectedRepositoryRoot) {
    return Object.freeze({ ok: false, reason: 'CANONICAL_REPOSITORY_ROOT_MISSING', headSha: '' });
  }
  try {
    const commandOptions = { encoding: 'utf8', windowsHide: true, timeout: 5_000, maxBuffer: 64 * 1024 };
    const [headResult, branchResult] = await Promise.all([
      execFileImpl('git', ['-C', expectedRepositoryRoot, 'rev-parse', 'HEAD'], commandOptions),
      execFileImpl('git', ['-C', expectedRepositoryRoot, 'rev-parse', '--abbrev-ref', 'HEAD'], commandOptions),
    ]);
    const headSha = text(headResult?.stdout ?? headResult).toLowerCase();
    const branch = text(branchResult?.stdout ?? branchResult);
    if (!SHA_40.test(headSha)) {
      return Object.freeze({ ok: false, reason: 'CANONICAL_REPOSITORY_HEAD_INVALID', headSha: '' });
    }
    if (branch !== 'main') {
      return Object.freeze({
        ok: false,
        reason: 'CANONICAL_REPOSITORY_BRANCH_NOT_MAIN',
        repositoryRoot: expectedRepositoryRoot,
        branch,
        headSha,
      });
    }
    return Object.freeze({
      ok: true,
      reason: 'CANONICAL_REPOSITORY_HEAD_READ',
      repositoryRoot: expectedRepositoryRoot,
      branch,
      headSha,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: 'CANONICAL_REPOSITORY_HEAD_READ_FAILED',
      repositoryRoot: expectedRepositoryRoot,
      headSha: '',
      errorCode: error?.code || '',
    });
  }
}

function blockedRead(reason, additions = {}) {
  return Object.freeze({
    ok: false,
    present: false,
    reason,
    record: null,
    validation: null,
    ...additions,
  });
}

async function readJson(path, read = readFile) {
  try {
    return { present: true, value: JSON.parse(await read(path, 'utf8')), error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, value: null, error: null };
    return { present: false, value: null, error };
  }
}

function authorityPath(root, repoRoot, directory, file) {
  return resolveSharedWorkspacePath({
    root,
    repoRoot,
    segments: [directory, file],
  });
}

async function withSourceMutationLeaseOperationGuard({
  root,
  repoRoot,
  deps,
  failure,
}, action) {
  const guard = await deps.acquireSharedWorkspaceOperationLock(
    root,
    ['status', SOURCE_MUTATION_LEASE_OPERATION_GUARD_FILE],
    {
      repoRoot,
      operationLockTimeoutMs: 1_000,
      operationLockRetryMs: 25,
      operationStaleLockMs: 30_000,
      operationLockHeartbeatMs: 5_000,
    },
  );
  if (!guard.ok) {
    return Object.freeze({
      ...failure,
      reason: guard.reason === 'SHARED_WORKSPACE_OPERATION_LOCK_TIMEOUT'
        ? 'SOURCE_MUTATION_LEASE_OPERATION_BUSY'
        : 'SOURCE_MUTATION_LEASE_OPERATION_GUARD_FAILED',
      guard,
      leaseOperationGuardIsAuthority: false,
      leaseSeizureAllowed: false,
    });
  }

  let result;
  let actionError = null;
  try {
    result = await action();
  } catch (error) {
    actionError = error;
  }
  const released = await guard.release();
  if (actionError) throw actionError;
  if (!released) {
    return Object.freeze({
      ...failure,
      reason: 'SOURCE_MUTATION_LEASE_OPERATION_GUARD_RELEASE_FAILED',
      operationCommitted: result?.ok === true,
      operationResult: result,
      guard,
      leaseOperationGuardIsAuthority: false,
      leaseSeizureAllowed: false,
    });
  }
  return result;
}

export function resolveProgrammeAuthorityPaths({ root, repoRoot } = {}) {
  const lease = authorityPath(root, repoRoot, 'status', SOURCE_MUTATION_LEASE_FILE);
  const controllerHeartbeat = authorityPath(root, repoRoot, 'status', PROGRAMME_CONTROLLER_HEARTBEAT_FILE);
  return Object.freeze({
    ok: lease.ok && controllerHeartbeat.ok,
    reason: lease.ok ? controllerHeartbeat.reason : lease.reason,
    root: lease.root || controllerHeartbeat.root || '',
    leasePath: lease.path,
    controllerHeartbeatPath: controllerHeartbeat.path,
  });
}

export async function readSourceMutationLease({
  root,
  repoRoot,
  nowUtc,
  readFileImpl = readFile,
} = {}) {
  const resolved = authorityPath(root, repoRoot, 'status', SOURCE_MUTATION_LEASE_FILE);
  if (!resolved.ok) return blockedRead(resolved.reason);
  const loaded = await readJson(resolved.path, readFileImpl);
  if (loaded.error) return blockedRead('SOURCE_MUTATION_LEASE_READ_FAILED', { errorCode: loaded.error.code || '' });
  if (!loaded.present) {
    return Object.freeze({
      ok: true,
      present: false,
      reason: 'SOURCE_MUTATION_LEASE_NOT_CLAIMED',
      record: null,
      validation: null,
      path: resolved.path,
    });
  }
  const validation = validateSourceMutationLease(loaded.value, { nowUtc });
  if (validation.valid) {
    const expectedRelease = createSourceMutationLeaseReleaseRecord(loaded.value, { timestampUtc: nowUtc });
    const releasePath = authorityPath(
      resolved.root,
      repoRoot,
      'status',
      `${expectedRelease.statusId}.json`,
    );
    if (!releasePath.ok) return blockedRead(releasePath.reason, { present: true, record: loaded.value, validation });
    const release = await readJson(releasePath.path, readFileImpl);
    if (release.error) {
      return blockedRead('SOURCE_MUTATION_LEASE_RELEASE_RECORD_READ_FAILED', {
        present: true,
        record: loaded.value,
        validation,
      });
    }
    if (release.present) {
      const exact = exactSourceMutationLeaseRelease(release.value, loaded.value);
      return Object.freeze({
        ok: false,
        present: true,
        reason: exact
          ? 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT'
          : 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_CONFLICT',
        record: loaded.value,
        validation: Object.freeze({
          ...validation,
          active: false,
          stale: false,
          finalVerdict: 'SOURCE_MUTATION_LEASE_RELEASED',
        }),
        releaseRecord: release.value,
        path: resolved.path,
      });
    }
  }
  return Object.freeze({
    ok: validation.valid,
    present: true,
    reason: validation.finalVerdict,
    record: loaded.value,
    validation,
    path: resolved.path,
  });
}

export async function claimSourceMutationLease(input = {}, options = {}) {
  const nowUtc = safeNow(input.nowUtc ?? input.acquiredAtUtc);
  const requestedRepository = text(input.repository);
  const requestedPrNumber = positiveInteger(input.prNumber);
  if (!nowUtc || !parseRepository(requestedRepository) || !requestedPrNumber) {
    return Object.freeze({
      ok: false,
      claimed: false,
      reason: !nowUtc
        ? 'SOURCE_MUTATION_LEASE_CLAIM_TIME_INVALID'
        : !parseRepository(requestedRepository)
          ? 'SOURCE_MUTATION_LEASE_REPOSITORY_INVALID'
          : 'SOURCE_MUTATION_LEASE_PR_INVALID',
      record: null,
    });
  }
  const deps = dependencies(options);
  const layout = await ensureSharedWorkspaceLayout({ root: options.root, repoRoot: options.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, claimed: false, reason: layout.reason, record: null });
  const resolved = authorityPath(layout.root, options.repoRoot, 'status', SOURCE_MUTATION_LEASE_FILE);
  if (!resolved.ok) return Object.freeze({ ok: false, claimed: false, reason: resolved.reason, record: null });
  return withSourceMutationLeaseOperationGuard({
    root: layout.root,
    repoRoot: options.repoRoot,
    deps,
    failure: { ok: false, claimed: false, record: null },
  }, async () => {
    const github = await githubEvidenceForLaneIdentity({
      repository: requestedRepository,
      prNumber: requestedPrNumber,
    }, options, deps);
    const canonicalRepository = text(github?.repository);
    const canonicalPrNumber = positiveInteger(github?.prNumber);
    const canonicalBranch = text(github?.headBranch);
    const canonicalHead = text(github?.headSha).toLowerCase();
    const githubValid = Boolean(
      github?.status === 'fetched'
      && canonicalRepository === requestedRepository
      && canonicalPrNumber === requestedPrNumber
      && github?.merged !== true
      && text(github?.prState).toUpperCase() === 'OPEN'
      && canonicalBranch
      && SHA_40.test(canonicalHead)
    );
    if (!githubValid) {
      return Object.freeze({
        ok: false,
        claimed: false,
        reason: 'SOURCE_MUTATION_LEASE_GITHUB_TRUTH_INVALID_OR_NON_ACTIVE',
        record: null,
        github,
      });
    }
    if ((text(input.branch) && text(input.branch) !== canonicalBranch)
      || (text(input.headSha) && text(input.headSha).toLowerCase() !== canonicalHead)) {
      return Object.freeze({
        ok: false,
        claimed: false,
        reason: 'SOURCE_MUTATION_LEASE_GITHUB_IDENTITY_MISMATCH',
        record: null,
        github,
      });
    }
    const record = createSourceMutationLeaseRecord({
      ...input,
      repository: canonicalRepository,
      prNumber: canonicalPrNumber,
      branch: canonicalBranch,
      headSha: canonicalHead,
      acquiredAtUtc: nowUtc,
    });
    const leaseValidation = validateSourceMutationLease(record, { nowUtc });
    const workspaceValidation = validateSharedWorkspaceRecord(record, { nowMs: Date.parse(nowUtc) });
    if (!leaseValidation.valid || !leaseValidation.active || !workspaceValidation.valid) {
      return Object.freeze({
        ok: false,
        claimed: false,
        reason: leaseValidation.errors[0] || workspaceValidation.refusalReason || 'SOURCE_MUTATION_LEASE_INVALID',
        record,
        leaseValidation,
        workspaceValidation,
        github,
      });
    }
    const releaseMarker = createSourceMutationLeaseReleaseRecord(record, { timestampUtc: nowUtc });
    const releaseMarkerPath = authorityPath(
      layout.root,
      options.repoRoot,
      'status',
      `${releaseMarker.statusId}.json`,
    );
    if (!releaseMarkerPath.ok) {
      return Object.freeze({ ok: false, claimed: false, reason: releaseMarkerPath.reason, record });
    }
    const priorRelease = await readJson(releaseMarkerPath.path, deps.readFile);
    if (priorRelease.error) {
      return Object.freeze({
        ok: false,
        claimed: false,
        reason: 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_READ_FAILED',
        record,
      });
    }
    if (priorRelease.present) {
      return Object.freeze({
        ok: false,
        claimed: false,
        reason: 'SOURCE_MUTATION_LEASE_IDENTITY_ALREADY_RELEASED',
        record,
        leaseSeizureAllowed: false,
        github,
      });
    }
    try {
      await deps.writeFile(resolved.path, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: 'utf8',
        flag: 'wx',
        mode: 0o600,
      });
      return Object.freeze({
        schemaVersion: PROGRAMME_AUTHORITY_SERVICE_SCHEMA,
        ok: true,
        claimed: true,
        idempotent: false,
        reason: 'SOURCE_MUTATION_LEASE_CLAIMED',
        record,
        path: resolved.path,
        leaseSeizureAllowed: false,
      });
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return Object.freeze({ ok: false, claimed: false, reason: 'SOURCE_MUTATION_LEASE_WRITE_FAILED', errorCode: error?.code || '', record });
      }
    }
    const existing = await readSourceMutationLease({
      root: layout.root,
      repoRoot: options.repoRoot,
      nowUtc,
      readFileImpl: deps.readFile,
    });
    if (!existing.ok) {
      return Object.freeze({
        ok: false,
        claimed: false,
        reason: existing.reason,
        existing,
        leaseSeizureAllowed: false,
      });
    }
    const exact = validateSourceMutationLease(existing.record, {
      nowUtc,
      expected: {
        leaseId: record.leaseId,
        laneId: record.laneId,
        repository: record.repository,
        issueNumber: record.issueNumber,
        prNumber: record.prNumber,
        branch: record.branch,
        headSha: record.headSha,
        ownerId: record.ownerId,
      },
    });
    if (exact.valid && exact.active) {
      return Object.freeze({
        schemaVersion: PROGRAMME_AUTHORITY_SERVICE_SCHEMA,
        ok: true,
        claimed: false,
        idempotent: true,
        reason: 'SOURCE_MUTATION_LEASE_ALREADY_CLAIMED_BY_EXACT_OWNER',
        record: existing.record,
        path: existing.path,
        leaseSeizureAllowed: false,
      });
    }
    return Object.freeze({
      ok: false,
      claimed: false,
      idempotent: false,
      reason: exact.valid
        ? 'SOURCE_MUTATION_LEASE_STALE_REQUIRES_RECONCILIATION'
        : 'SOURCE_MUTATION_LEASE_ALREADY_OWNED',
      existing,
      exactBindingErrors: exact.errors,
      leaseSeizureAllowed: false,
    });
  });
}

export async function renewSourceMutationLease(input = {}, options = {}) {
  const deps = dependencies(options);
  const layout = await ensureSharedWorkspaceLayout({ root: options.root, repoRoot: options.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, renewed: false, reason: layout.reason });
  return withSourceMutationLeaseOperationGuard({
    root: layout.root,
    repoRoot: options.repoRoot,
    deps,
    failure: { ok: false, renewed: false },
  }, async () => {
    const current = await readSourceMutationLease({
      root: layout.root,
      repoRoot: options.repoRoot,
      nowUtc: input.nowUtc,
      readFileImpl: deps.readFile,
    });
    if (!current.ok || !current.present) {
      return Object.freeze({ ok: false, renewed: false, reason: current.reason, current });
    }
    const renewal = renewSourceMutationLeaseRecord(current.record, input);
    if (!renewal.ok) return Object.freeze({ ok: false, renewed: false, reason: renewal.reason, current, renewal });
    const github = await githubEvidenceForLaneIdentity(current.record, options, deps);
    const githubActive = Boolean(
      github?.status === 'fetched'
      && text(github.repository) === current.record.repository
      && positiveInteger(github.prNumber) === current.record.prNumber
      && github.merged !== true
      && text(github.prState).toUpperCase() === 'OPEN'
      && text(github.headBranch)
      && SHA_40.test(text(github.headSha))
    );
    if (!githubActive) {
      return Object.freeze({
        ok: false,
        renewed: false,
        reason: 'SOURCE_MUTATION_LEASE_RENEWAL_GITHUB_TRUTH_INVALID_OR_NON_ACTIVE',
        current,
        renewal,
        github,
      });
    }
    if (
      text(github.headBranch) !== current.record.branch
      || text(github.headSha).toLowerCase() !== current.record.headSha
    ) {
      return Object.freeze({
        ok: false,
        renewed: false,
        reason: 'SOURCE_MUTATION_LEASE_RENEWAL_GITHUB_IDENTITY_MISMATCH',
        current,
        renewal,
        github,
      });
    }
    const write = await deps.writeAtomicJson(
      layout.root,
      ['status', SOURCE_MUTATION_LEASE_FILE],
      renewal.record,
      { repoRoot: options.repoRoot, nowMs: Date.parse(input.nowUtc) },
    );
    return Object.freeze({
      ok: write.ok === true,
      renewed: write.ok === true,
      reason: write.ok ? 'SOURCE_MUTATION_LEASE_RENEWED_AND_PUBLISHED' : write.reason,
      record: renewal.record,
      write,
    });
  });
}

export async function releaseSourceMutationLease(expected = {}, options = {}) {
  const deps = dependencies(options);
  const nowUtc = safeNow(expected.nowUtc);
  const expectedIdentity = terminalIdentity(expected);
  if (!nowUtc || !expectedIdentity.complete) {
    return Object.freeze({
      ok: false,
      released: false,
      reason: !nowUtc
        ? 'SOURCE_MUTATION_LEASE_RELEASE_TIME_INVALID'
        : 'SOURCE_MUTATION_LEASE_RELEASE_IDENTITY_INCOMPLETE',
      releaseOnlyExactLease: true,
    });
  }
  const layout = await ensureSharedWorkspaceLayout({ root: options.root, repoRoot: options.repoRoot });
  if (!layout.ok) return Object.freeze({ ok: false, released: false, reason: layout.reason, releaseOnlyExactLease: true });
  return withSourceMutationLeaseOperationGuard({
    root: layout.root,
    repoRoot: options.repoRoot,
    deps,
    failure: { ok: false, released: false, releaseOnlyExactLease: true },
  }, async () => {
    const expectedReleaseRecord = createSourceMutationLeaseReleaseRecord(expectedIdentity, { timestampUtc: nowUtc });
    const releaseRecordPath = authorityPath(
      layout.root,
      options.repoRoot,
      'status',
      `${expectedReleaseRecord.statusId}.json`,
    );
    if (!releaseRecordPath.ok) {
      return Object.freeze({ ok: false, released: false, reason: releaseRecordPath.reason, releaseOnlyExactLease: true });
    }
    const existingRelease = await readJson(releaseRecordPath.path, deps.readFile);
    if (existingRelease.error) {
      return Object.freeze({
        ok: false,
        released: false,
        reason: 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_READ_FAILED',
        releaseOnlyExactLease: true,
      });
    }
    const current = await readSourceMutationLease({
      root: layout.root,
      repoRoot: options.repoRoot,
      nowUtc,
      readFileImpl: deps.readFile,
    });
    if (
      current.present
      && current.reason === 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT'
      && existingRelease.present
      && exactSourceMutationLeaseRelease(existingRelease.value, expectedIdentity)
    ) {
      try {
        await deps.unlink(current.path);
        return Object.freeze({
          ok: true,
          released: true,
          idempotent: true,
          recoveredInterruptedRelease: true,
          reason: 'SOURCE_MUTATION_LEASE_RELEASE_COMPLETED_FROM_DURABLE_MARKER',
          releaseRecord: existingRelease.value,
          releaseOnlyExactLease: true,
        });
      } catch (error) {
        if (error?.code === 'ENOENT') {
          return Object.freeze({
            ok: true,
            released: false,
            idempotent: true,
            recoveredInterruptedRelease: true,
            reason: 'SOURCE_MUTATION_LEASE_ALREADY_RELEASED',
            releaseRecord: existingRelease.value,
            releaseOnlyExactLease: true,
          });
        }
        return Object.freeze({
          ok: false,
          released: false,
          reason: 'SOURCE_MUTATION_LEASE_RELEASE_RECOVERY_FAILED',
          errorCode: error?.code || '',
          releaseOnlyExactLease: true,
        });
      }
    }
    if (current.ok && !current.present) {
      if (!existingRelease.present || !exactSourceMutationLeaseRelease(existingRelease.value, expectedIdentity)) {
        return Object.freeze({
          ok: false,
          released: false,
          idempotent: false,
          reason: 'SOURCE_MUTATION_LEASE_RELEASE_EVIDENCE_MISSING_OR_CONFLICTING',
          releaseOnlyExactLease: true,
        });
      }
      return Object.freeze({
        ok: true,
        released: false,
        idempotent: true,
        reason: 'SOURCE_MUTATION_LEASE_ALREADY_RELEASED',
        releaseRecord: existingRelease.value,
        releaseOnlyExactLease: true,
      });
    }
    if (!current.ok) return Object.freeze({ ok: false, released: false, reason: current.reason, current });
    const validation = validateSourceMutationLease(current.record, {
      nowUtc,
      expected: expectedIdentity,
    });
    if (!validation.valid) {
      return Object.freeze({
        ok: false,
        released: false,
        reason: 'SOURCE_MUTATION_LEASE_RELEASE_BINDING_MISMATCH',
        validation,
        releaseOnlyExactLease: true,
      });
    }
    const releaseRecord = createSourceMutationLeaseReleaseRecord(current.record, { timestampUtc: nowUtc });
    let releasePublication;
    if (existingRelease.present) {
      if (!exactSourceMutationLeaseRelease(existingRelease.value, expectedIdentity)) {
        return Object.freeze({
          ok: false,
          released: false,
          reason: 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_CONFLICT',
          releaseOnlyExactLease: true,
        });
      }
      releasePublication = Object.freeze({
        ok: true,
        idempotent: true,
        reason: 'SOURCE_MUTATION_LEASE_RELEASE_RECORD_ALREADY_PUBLISHED',
        path: releaseRecordPath.path,
      });
    } else {
      releasePublication = await deps.writeAtomicJson(
        layout.root,
        ['status', `${releaseRecord.statusId}.json`],
        releaseRecord,
        { repoRoot: options.repoRoot, nowMs: Date.parse(nowUtc) },
      );
      if (!releasePublication.ok) {
        return Object.freeze({
          ok: false,
          released: false,
          reason: releasePublication.reason,
          releasePublication,
          releaseOnlyExactLease: true,
        });
      }
    }
    try {
      await deps.unlink(current.path);
      return Object.freeze({
        schemaVersion: PROGRAMME_AUTHORITY_SERVICE_SCHEMA,
        ok: true,
        released: true,
        idempotent: false,
        reason: 'SOURCE_MUTATION_LEASE_RELEASED',
        leaseId: current.record.leaseId,
        laneId: current.record.laneId,
        headSha: current.record.headSha,
        releaseRecord,
        releasePublication,
        releaseOnlyExactLease: true,
      });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return Object.freeze({
          ok: true,
          released: false,
          idempotent: true,
          reason: 'SOURCE_MUTATION_LEASE_ALREADY_RELEASED',
          releaseRecord,
          releasePublication,
          releaseOnlyExactLease: true,
        });
      }
      return Object.freeze({
        ok: false,
        released: false,
        reason: 'SOURCE_MUTATION_LEASE_RELEASE_FAILED',
        errorCode: error?.code || '',
      });
    }
  });
}

export async function readProgrammeControllerHeartbeat({
  root,
  repoRoot,
  nowUtc,
  maxAgeMs,
  expectedSourceRevision,
  readFileImpl = readFile,
} = {}) {
  const resolved = authorityPath(root, repoRoot, 'status', PROGRAMME_CONTROLLER_HEARTBEAT_FILE);
  if (!resolved.ok) return blockedRead(resolved.reason);
  const loaded = await readJson(resolved.path, readFileImpl);
  if (loaded.error) return blockedRead('PROGRAMME_CONTROLLER_HEARTBEAT_READ_FAILED', { errorCode: loaded.error.code || '' });
  if (!loaded.present) return blockedRead('PROGRAMME_CONTROLLER_HEARTBEAT_MISSING', { path: resolved.path });
  const projection = projectProgrammeControllerHeartbeat(loaded.value, {
    nowUtc,
    maxAgeMs,
    expectedSourceRevision,
  });
  return Object.freeze({
    ok: projection.valid,
    present: true,
    reason: projection.finalVerdict,
    record: loaded.value,
    projection,
    path: resolved.path,
  });
}

export async function publishProgrammeControllerHeartbeat(input = {}, options = {}) {
  const timestampUtc = safeNow(input.timestampUtc);
  const record = createProgrammeControllerHeartbeat({ ...input, timestampUtc });
  const projection = projectProgrammeControllerHeartbeat(record, {
    nowUtc: timestampUtc,
    maxAgeMs: options.maxAgeMs,
  });
  if (!projection.valid) return Object.freeze({ ok: false, reason: projection.errors[0], record, projection });
  const write = await dependencies(options).writeAtomicJson(
    options.root,
    ['status', PROGRAMME_CONTROLLER_HEARTBEAT_FILE],
    record,
    { repoRoot: options.repoRoot, nowMs: Date.parse(timestampUtc) },
  );
  return Object.freeze({
    ok: write.ok === true,
    reason: write.ok ? 'PROGRAMME_CONTROLLER_HEARTBEAT_PUBLISHED' : write.reason,
    record,
    projection,
    write,
  });
}

async function readMissionWorkerHeartbeat(options, deps, nowUtc, expectedHeadSha) {
  const paths = resolveCanonicalMissionWorkerPaths({
    env: options.env || process.env,
    home: options.home,
  });
  const loaded = await readJson(paths.heartbeatPath, deps.readFile);
  if (loaded.error || !loaded.present) {
    return Object.freeze({
      ok: false,
      record: null,
      projection: Object.freeze({
        valid: false,
        fresh: false,
        errors: Object.freeze([loaded.error ? 'worker-heartbeat-read-failed' : 'worker-heartbeat-missing']),
        controllerHeartbeatAuthority: false,
        finalVerdict: 'MISSION_WORKER_HEARTBEAT_BLOCKED',
      }),
      path: paths.heartbeatPath,
    });
  }
  return Object.freeze({
    ok: true,
    record: loaded.value,
    projection: projectMissionWorkerHeartbeat(loaded.value, {
      nowUtc,
      maxAgeMs: options.workerHeartbeatMaxAgeMs,
      expectedRepositoryRoot: paths.repositoryRoot,
      expectedHeadSha,
    }),
    path: paths.heartbeatPath,
  });
}

function isAffirmativeProofRecord(record) {
  return Boolean(
    record
    && validateSharedWorkspaceRecord(record).valid
    && record.kind === 'stephanos.shared_workspace.proof'
    && AFFIRMATIVE_PROOF_STATUSES.has(text(record.status).toUpperCase())
  );
}

function canonicalPositiveAlias(values) {
  const supplied = values.filter((value) => (
    value !== undefined
    && value !== null
    && String(value).trim()
  ));
  if (!supplied.length) return null;
  const normalized = supplied.map(positiveInteger);
  if (normalized.some((value) => !value)) return null;
  const uniqueValues = [...new Set(normalized)];
  return uniqueValues.length === 1 ? uniqueValues[0] : null;
}

function canonicalShaAlias(values) {
  const supplied = values.filter((value) => (
    value !== undefined
    && value !== null
    && String(value).trim()
  ));
  if (!supplied.length) return null;
  const normalized = supplied.map((value) => text(value).toLowerCase());
  if (normalized.some((value) => !SHA_40.test(value))) return null;
  const uniqueValues = [...new Set(normalized)];
  return uniqueValues.length === 1 ? uniqueValues[0] : null;
}

export function buildAffirmativeSchedulerProofSources(workspaceFeed, executionReceipt) {
  const records = list(workspaceFeed?.records?.proofRecords);
  const proofHeadShas = [];
  const proofReceipts = [];
  const proofRefs = [];
  for (const record of records) {
    if (!isAffirmativeProofRecord(record)) continue;
    const headSha = canonicalShaAlias([record.headSha, record.sourceHead]);
    const issue = canonicalPositiveAlias([record.issueNumber, record.relatedIssue]);
    const activePr = canonicalPositiveAlias([record.prNumber, record.relatedPr]);
    if (!issue || !activePr || !/^[0-9a-f]{40}$/.test(headSha)) continue;
    proofHeadShas.push(headSha);
    proofReceipts.push({ issue, activePr, headSha });
    proofRefs.push(...list(record.proofRefs), ...list(record.refs));
  }
  if (executionReceipt?.state === 'completed') proofRefs.push(...list(executionReceipt.proofRefs));
  return Object.freeze({
    records: Object.freeze(records),
    proofHeadShas: Object.freeze([...new Set(proofHeadShas)]),
    proofReceipts: Object.freeze(proofReceipts),
    proofRefs: Object.freeze([...new Set(proofRefs.map(String).map((value) => value.trim()).filter(Boolean))]),
  });
}

async function githubEvidenceForLaneIdentity(identity, options, deps) {
  const repository = parseRepository(identity?.repository);
  if (!repository) return { status: 'error', source: 'github-api', recommendedNextAction: 'Lane repository identity is invalid.' };
  const auth = await deps.resolveGithubTokenConfig({
    env: options.env || process.env,
    ghTokenProvider: options.ghTokenProvider,
    execFile: options.execFile,
  });
  if (!auth.configured) {
    return {
      status: 'error',
      source: 'github-api',
      repository: identity.repository,
      prNumber: identity.prNumber,
      recommendedNextAction: 'GitHub read authority is unavailable.',
    };
  }
  return deps.fetchGithubPrEvidence({
    owner: repository.owner,
    repo: repository.repo,
    prNumber: identity.prNumber,
    auth,
    ghTokenProvider: options.ghTokenProvider,
    fetchImpl: options.testOnly === true ? options.fetchImpl : undefined,
  });
}

function holdProjection(nowUtc, reason, additions = {}) {
  return buildAuthoritativeProgrammeProjection({
    nowUtc,
    workspaceFeed: additions.workspaceFeed,
    lane: additions.lane,
    mutationLease: additions.mutationLease,
    controllerHeartbeatProjection: additions.controllerHeartbeatProjection,
    workerHeartbeatProjection: additions.workerHeartbeatProjection,
    executionReceipt: additions.executionReceipt,
    battleBridgeProofs: additions.battleBridgeProofs,
    runtimeHealthRecords: additions.runtimeHealthRecords,
    scheduler: additions.scheduler,
    criticalBacklog: additions.criticalBacklog,
    machineryInventory: additions.machineryInventory,
    receiptId: additions.receiptId,
    additionalBlockers: [`service:${reason}`],
    sourceConstructionMode: 'production-contracts',
  });
}

export async function readAuthoritativeProgrammeProjection(options = {}) {
  const deps = dependencies(options);
  const suppliedNow = options.nowUtc === undefined ? '' : safeNow(options.nowUtc);
  const nowUtc = suppliedNow || new Date().toISOString();
  if (options.nowUtc !== undefined && !suppliedNow) {
    const projection = holdProjection(nowUtc, 'PROGRAMME_OBSERVATION_TIME_INVALID');
    return Object.freeze({
      ...projection,
      productionSourcesConstructed: true,
      dependencyInjectionUsed: options.dependencies ? true : false,
    });
  }
  const workspaceConfig = await deps.validateWorkspaceConfig({
    root: options.root,
    repoRoot: options.repoRoot,
    env: options.env || process.env,
  });
  if (!workspaceConfig.ok) {
    const projection = holdProjection(nowUtc, workspaceConfig.reason);
    return Object.freeze({
      ...projection,
      productionSourcesConstructed: true,
      workspaceConfig,
    });
  }
  const root = workspaceConfig.root;
  const selector = requestedLaneSelector(options);
  const missionWorkerPaths = resolveCanonicalMissionWorkerPaths({
    env: options.env || process.env,
    home: options.home,
  });
  const repositoryHeadRead = await deps.readRepositoryHead({
    repositoryRoot: missionWorkerPaths.repositoryRoot,
  });
  const repositoryHeadValid = Boolean(
    repositoryHeadRead.ok
    && repositoryHeadRead.branch === 'main'
    && SHA_40.test(text(repositoryHeadRead.headSha)),
  );
  const expectedSourceRevision = repositoryHeadValid ? repositoryHeadRead.headSha : 'invalid';
  const [
    leaseRead,
    controllerHeartbeatRead,
    workspaceFeed,
    missionRecords,
  ] = await Promise.all([
    readSourceMutationLease({ root, repoRoot: options.repoRoot, nowUtc, readFileImpl: deps.readFile }),
    readProgrammeControllerHeartbeat({
      root,
      repoRoot: options.repoRoot,
      nowUtc,
      maxAgeMs: options.controllerHeartbeatMaxAgeMs,
      expectedSourceRevision,
      readFileImpl: deps.readFile,
    }),
    deps.readWorkspaceFeed({
      root,
      repoRoot: options.repoRoot,
      nowMs: Date.parse(nowUtc),
      staleAfterMs: options.workspaceStaleAfterMs,
    }),
    deps.listMissionRecords({
      root: options.orchestratorRoot,
      snapshotRoot: options.snapshotRoot,
      env: options.env || process.env,
    }),
  ]);
  const workerHeartbeatRead = await readMissionWorkerHeartbeat(
    options,
    deps,
    nowUtc,
    expectedSourceRevision,
  );

  const lease = leaseRead.present ? leaseRead.record : null;
  const githubIdentity = lease ?? (selector.complete ? selector : null);
  const github = githubIdentity ? await githubEvidenceForLaneIdentity(githubIdentity, options, deps) : null;
  const executionRead = lease
    ? await deps.readCurrentExecutionReceipt(root, {
      leaseKey: lease.leaseId,
      repository: lease.repository,
      issueNumber: lease.issueNumber,
      branch: lease.branch,
      expectedHead: lease.headSha,
    }, { repoRoot: options.repoRoot, nowMs: Date.parse(nowUtc) })
    : null;
  const executionReceipt = executionRead?.receipt ?? null;
  const proof = buildAffirmativeSchedulerProofSources(workspaceFeed, executionReceipt);
  const lane = githubIdentity
    ? buildCanonicalImplementationLaneProjection({
      laneId: selector.laneId || lease?.laneId,
      issueNumber: selector.issueNumber ?? lease?.issueNumber,
      prNumber: selector.prNumber ?? lease?.prNumber,
      headSha: lease?.headSha ?? github?.headSha,
      branch: lease?.branch ?? github?.headBranch,
      repository: selector.repository || lease?.repository,
      github,
      mutationLease: lease,
      executionReceipt,
      proofRefs: proof.proofRefs,
      nowUtc,
    })
    : null;
  const schedulerGoals = buildSchedulerGoalsFromProgrammeSources({
    nowUtc,
    lane,
    goalRecords: workspaceFeed?.records?.goalRecords,
  });
  const scheduler = deps.buildMissionScheduler({
    now: nowUtc,
    goals: schedulerGoals.goals,
    proofHeadShas: proof.proofHeadShas,
    proofReceipts: proof.proofReceipts,
    proofRefs: proof.proofRefs,
    correlationId: text(options.correlationId, `programme-${nowUtc.replace(/[^0-9]/g, '').slice(0, 14)}`),
  });
  const criticalBacklog = deps.buildCriticalBacklogProjection({ missionRecords });
  const sourceHead = repositoryHeadValid ? repositoryHeadRead.headSha : '';
  const machineryInventory = deps.buildCapabilityRegistry({
    sourceHead,
    generatedAtUtc: nowUtc,
  });
  const sourceBlockers = [
    ...(!leaseRead.ok ? [`source:${leaseRead.reason}`] : []),
    ...(!controllerHeartbeatRead.ok ? [`source:${controllerHeartbeatRead.reason}`] : []),
    ...(!workerHeartbeatRead.ok ? ['source:mission-worker-heartbeat-unavailable'] : []),
    ...(!repositoryHeadValid ? [`source:${repositoryHeadRead.reason || 'CANONICAL_REPOSITORY_HEAD_INVALID'}`] : []),
    ...(!schedulerGoals.valid ? schedulerGoals.blockers.map((blocker) => `source:${blocker}`) : []),
    ...(selector.requested && !selector.complete ? ['source:lane-selector-incomplete-or-invalid'] : []),
    ...(githubIdentity && github?.status !== 'fetched' ? ['source:github-pr-evidence-unavailable'] : []),
    ...(lease && executionRead?.ok === false ? [`source:${executionRead.reason}`] : []),
  ];
  const projection = buildAuthoritativeProgrammeProjection({
    nowUtc,
    workspaceFeed,
    lane,
    mutationLease: lease,
    controllerHeartbeatProjection: controllerHeartbeatRead.projection,
    workerHeartbeatProjection: workerHeartbeatRead.projection,
    executionReceipt,
    battleBridgeProofs: proof.records,
    runtimeHealthRecords: workspaceFeed?.records?.statusRecords,
    scheduler,
    criticalBacklog,
    machineryInventory,
    receiptId: text(options.receiptId),
    stallAfterMs: options.stallAfterMs,
    additionalBlockers: sourceBlockers,
    sourceConstructionMode: 'production-contracts',
  });
  return Object.freeze({
    ...projection,
    schema: PROGRAMME_AUTHORITY_SERVICE_SCHEMA,
    productionSourcesConstructed: true,
    dependencyInjectionUsed: options.dependencies ? true : false,
    sourceReads: Object.freeze({
      workspaceConfig,
      repositoryHead: repositoryHeadRead.reason,
      lease: leaseRead.reason,
      controllerHeartbeat: controllerHeartbeatRead.reason,
        workerHeartbeat: workerHeartbeatRead.projection.finalVerdict,
        github: github?.status ?? 'not-required',
        laneSelector: selector.requested ? (selector.complete ? 'complete' : 'invalid') : 'not-requested',
      executionReceipt: executionRead?.reason ?? 'not-required',
    }),
  });
}

function exactTerminalReceipt(record, records) {
  const proofRef = `proof/${records.evidenceId}.json`;
  return Boolean(
    record
    && validateSharedWorkspaceRecord(record).valid
    && record.schema === records.receipt.schema
    && record.receiptId === records.receipt.receiptId
    && record.participantId === 'terminal-lane-finalizer'
    && record.correlationId === records.receipt.leaseId
    && record.relatedIssue === `#${records.receipt.issueNumber}`
    && record.relatedPr === `#${records.receipt.prNumber}`
    && record.receivedRecordId === records.evidenceId
    && Array.isArray(record.proofRefs)
    && record.proofRefs.length === 1
    && record.proofRefs[0] === proofRef
    && record.laneId === records.receipt.laneId
    && record.repository === records.receipt.repository
    && record.issueNumber === records.receipt.issueNumber
    && record.prNumber === records.receipt.prNumber
    && record.branch === records.receipt.branch
    && record.headSha === records.receipt.headSha
    && record.leaseId === records.receipt.leaseId
    && record.ownerId === records.receipt.ownerId
    && record.disposition === 'terminal-evidence-published'
    && record.releaseOnlyExactLease === true
    && record.mergeAuthority === false
  );
}

function exactSourceMutationLeaseRelease(record, identity) {
  const expected = createSourceMutationLeaseReleaseRecord(identity, {
    timestampUtc: record?.releasedAtUtc,
  });
  return Boolean(
    record
    && validateSharedWorkspaceRecord(record).valid
    && record.schema === SOURCE_MUTATION_LEASE_RELEASE_SCHEMA
    && record.statusId === expected.statusId
    && record.participantId === 'source-mutation-lease-authority'
    && record.status === 'RELEASED'
    && record.timestampUtc === record.releasedAtUtc
    && record.leaseId === identity.leaseId
    && record.laneId === identity.laneId
    && record.repository === identity.repository
    && record.issueNumber === identity.issueNumber
    && record.prNumber === identity.prNumber
    && record.branch === identity.branch
    && record.headSha === identity.headSha
    && record.ownerId === identity.ownerId
    && record.releaseOnlyExactLease === true
    && record.executionReceiptLeaseKeyIsCorrelationOnly === true
    && record.mergeAuthority === false
  );
}

function terminalIdentity(input = {}) {
  const issueNumber = Number(input.issueNumber);
  const prNumber = Number(input.prNumber);
  const headSha = text(input.headSha).toLowerCase();
  const complete = Boolean(
    text(input.leaseId)
    && text(input.laneId)
    && text(input.repository)
    && Number.isSafeInteger(issueNumber)
    && issueNumber > 0
    && Number.isSafeInteger(prNumber)
    && prNumber > 0
    && text(input.branch)
    && /^[0-9a-f]{40}$/.test(headSha)
    && text(input.ownerId),
  );
  return Object.freeze({
    complete,
    leaseId: text(input.leaseId),
    laneId: text(input.laneId),
    repository: text(input.repository),
    issueNumber,
    prNumber,
    branch: text(input.branch),
    headSha,
    ownerId: text(input.ownerId),
    evidenceId: complete ? createTerminalLaneEvidenceId(input, input) : '',
  });
}

function exactTerminalReceiptForIdentity(record, identity) {
  const proofRef = `proof/${identity.evidenceId}.json`;
  return Boolean(
    record
    && validateSharedWorkspaceRecord(record).valid
    && record.schema === TERMINAL_LANE_FINALIZATION_SCHEMA
    && record.receiptId === identity.evidenceId
    && record.participantId === 'terminal-lane-finalizer'
    && record.correlationId === identity.leaseId
    && record.relatedIssue === `#${identity.issueNumber}`
    && record.relatedPr === `#${identity.prNumber}`
    && record.receivedRecordId === identity.evidenceId
    && Array.isArray(record.proofRefs)
    && record.proofRefs.length === 1
    && record.proofRefs[0] === proofRef
    && record.laneId === identity.laneId
    && record.repository === identity.repository
    && record.issueNumber === identity.issueNumber
    && record.prNumber === identity.prNumber
    && record.branch === identity.branch
    && record.headSha === identity.headSha
    && record.leaseId === identity.leaseId
    && record.ownerId === identity.ownerId
    && record.disposition === 'terminal-evidence-published'
    && record.releaseOnlyExactLease === true
    && record.mergeAuthority === false
  );
}

function exactTerminalProofForIdentity(record, identity, expectedProof = null) {
  const proofRef = `proof/${identity.evidenceId}.json`;
  const mergeFactsMatch = !expectedProof || (
    text(record?.mergeCommitSha).toLowerCase() === text(expectedProof.mergeCommitSha).toLowerCase()
    && safeNow(record?.mergedAtUtc) === safeNow(expectedProof.mergedAtUtc)
  );
  return Boolean(
    record
    && validateSharedWorkspaceRecord(record).valid
    && record.schema === TERMINAL_LANE_FINALIZATION_SCHEMA
    && record.proofId === identity.evidenceId
    && record.participantId === 'terminal-lane-finalizer'
    && record.correlationId === identity.leaseId
    && record.relatedIssue === `#${identity.issueNumber}`
    && record.relatedPr === `#${identity.prNumber}`
    && Array.isArray(record.proofRefs)
    && record.proofRefs.length === 1
    && record.proofRefs[0] === proofRef
    && Array.isArray(record.refs)
    && record.refs.length === 1
    && record.refs[0] === proofRef
    && record.laneId === identity.laneId
    && record.repository === identity.repository
    && record.issueNumber === identity.issueNumber
    && record.prNumber === identity.prNumber
    && record.branch === identity.branch
    && record.headSha === identity.headSha
    && record.leaseId === identity.leaseId
    && record.ownerId === identity.ownerId
    && record.status === 'MERGED'
    && SHA_40.test(text(record.mergeCommitSha))
    && Boolean(safeNow(record.mergedAtUtc))
    && mergeFactsMatch
    && record.releaseOnlyExactLease === true
    && record.mergeAuthority === false
  );
}

export async function finalizeTerminalImplementationLane(input = {}, options = {}) {
  const deps = dependencies(options);
  const suppliedNow = input.nowUtc === undefined ? '' : safeNow(input.nowUtc);
  if (input.nowUtc !== undefined && !suppliedNow) {
    return Object.freeze({ ok: false, finalized: false, reason: 'TERMINAL_FINALIZATION_TIME_INVALID' });
  }
  const nowUtc = suppliedNow || new Date().toISOString();
  const expected = terminalIdentity(input);
  if (!expected.complete) {
    return Object.freeze({ ok: false, finalized: false, reason: 'TERMINAL_FINALIZATION_IDENTITY_INCOMPLETE' });
  }
  const workspaceConfig = await deps.validateWorkspaceConfig({
    root: options.root,
    repoRoot: options.repoRoot,
    env: options.env || process.env,
  });
  if (!workspaceConfig.ok) return Object.freeze({ ok: false, finalized: false, reason: workspaceConfig.reason });
  const root = workspaceConfig.root;
  const leaseRead = await readSourceMutationLease({
    root,
    repoRoot: options.repoRoot,
    nowUtc,
    readFileImpl: deps.readFile,
  });
  const leaseAlreadyAbsent = leaseRead.ok && !leaseRead.present;
  const interruptedReleaseRecovery = (
    !leaseRead.ok
    && leaseRead.present
    && leaseRead.reason === 'SOURCE_MUTATION_LEASE_RELEASE_MARKER_PRESENT'
  );
  if (leaseAlreadyAbsent || interruptedReleaseRecovery) {
    const receiptPath = authorityPath(root, options.repoRoot, 'receipts', `${expected.evidenceId}.json`);
    const proofPath = authorityPath(root, options.repoRoot, 'proof', `${expected.evidenceId}.json`);
    if (!receiptPath.ok || !proofPath.ok) {
      return Object.freeze({
        ok: false,
        finalized: false,
        reason: receiptPath.ok ? proofPath.reason : receiptPath.reason,
        leaseRead,
      });
    }
    const [existingReceipt, existingProof] = await Promise.all([
      readJson(receiptPath.path, deps.readFile),
      readJson(proofPath.path, deps.readFile),
    ]);
    if (
      existingReceipt.present
      && existingProof.present
      && exactTerminalReceiptForIdentity(existingReceipt.value, expected)
      && exactTerminalProofForIdentity(existingProof.value, expected)
    ) {
      const release = await releaseSourceMutationLease({
        ...expected,
        nowUtc,
      }, {
        ...options,
        root,
        dependencies: options.dependencies,
      });
      if (!release.ok) {
        return Object.freeze({
          ok: false,
          finalized: false,
          reason: release.reason,
          release,
          terminalEvidencePublished: true,
        });
      }
      return Object.freeze({
        schemaVersion: PROGRAMME_AUTHORITY_SERVICE_SCHEMA,
        ok: true,
        finalized: true,
        idempotent: true,
        reason: 'TERMINAL_LANE_ALREADY_FINALIZED',
        release,
        schedulesWork: false,
        dispatchesWork: false,
        mergeAuthority: false,
      });
    }
    return Object.freeze({ ok: false, finalized: false, reason: 'TERMINAL_FINALIZATION_EVIDENCE_MISSING', leaseRead });
  }
  if (!leaseRead.ok) return Object.freeze({ ok: false, finalized: false, reason: leaseRead.reason, leaseRead });
  const lease = leaseRead.record;
  const exactLease = validateSourceMutationLease(lease, { nowUtc, expected });
  if (!exactLease.valid) {
    return Object.freeze({
      ok: false,
      finalized: false,
      reason: 'TERMINAL_FINALIZATION_LEASE_IDENTITY_MISMATCH',
      exactLease,
    });
  }
  const github = await githubEvidenceForLaneIdentity(lease, options, deps);
  const lane = buildCanonicalImplementationLaneProjection({
    laneId: lease.laneId,
    issueNumber: lease.issueNumber,
    prNumber: lease.prNumber,
    headSha: lease.headSha,
    branch: lease.branch,
    repository: lease.repository,
    github,
    mutationLease: lease,
    nowUtc,
  });
  const plan = buildTerminalLaneFinalizationPlan({
    lane,
    mutationLease: lease,
    github,
    leaseId: expected.leaseId,
    ownerId: expected.ownerId,
    nowUtc,
  });
  if (!plan.valid) {
    return Object.freeze({
      ok: false,
      finalized: false,
      reason: plan.blockers[0] || 'TERMINAL_LANE_FINALIZATION_HOLD',
      plan,
      github,
    });
  }
  const records = createTerminalLaneEvidenceRecords(plan, { timestampUtc: nowUtc });
  const receiptPath = authorityPath(root, options.repoRoot, 'receipts', `${records.evidenceId}.json`);
  const proofPath = authorityPath(root, options.repoRoot, 'proof', `${records.evidenceId}.json`);
  if (!receiptPath.ok || !proofPath.ok) {
    return Object.freeze({
      ok: false,
      finalized: false,
      reason: receiptPath.ok ? proofPath.reason : receiptPath.reason,
      plan,
    });
  }
  const [existing, existingProof] = await Promise.all([
    readJson(receiptPath.path, deps.readFile),
    readJson(proofPath.path, deps.readFile),
  ]);
  if (existing.error || existingProof.error) {
    return Object.freeze({ ok: false, finalized: false, reason: 'TERMINAL_EVIDENCE_READ_FAILED', plan });
  }
  let evidencePublication = null;
  let receiptPublication = null;
  let idempotent = false;
  if (existing.present) {
    if (!exactTerminalReceipt(existing.value, records) || !exactTerminalProofForIdentity(existingProof.value, expected, records.proof)) {
      return Object.freeze({ ok: false, finalized: false, reason: 'TERMINAL_RECEIPT_IDENTITY_CONFLICT', plan });
    }
    idempotent = true;
  } else {
    if (existingProof.present && !exactTerminalProofForIdentity(existingProof.value, expected, records.proof)) {
      return Object.freeze({ ok: false, finalized: false, reason: 'TERMINAL_PROOF_IDENTITY_CONFLICT', plan });
    }
    if (existingProof.present) {
      evidencePublication = Object.freeze({ ok: true, idempotent: true, reason: 'TERMINAL_PROOF_ALREADY_PUBLISHED' });
    } else {
      evidencePublication = await deps.writeAtomicJson(
        root,
        ['proof', `${records.evidenceId}.json`],
        records.proof,
        { repoRoot: options.repoRoot, nowMs: Date.parse(nowUtc) },
      );
      if (!evidencePublication.ok) {
        return Object.freeze({
          ok: false,
          finalized: false,
          reason: evidencePublication.reason,
          plan,
          evidencePublication,
        });
      }
    }
    receiptPublication = await deps.writeAtomicJson(
      root,
      ['receipts', `${records.evidenceId}.json`],
      records.receipt,
      { repoRoot: options.repoRoot, nowMs: Date.parse(nowUtc) },
    );
    if (!receiptPublication.ok) {
      return Object.freeze({
        ok: false,
        finalized: false,
        reason: receiptPublication.reason,
        plan,
        evidencePublication,
        receiptPublication,
      });
    }
  }
  const release = await releaseSourceMutationLease({
    nowUtc,
    leaseId: lease.leaseId,
    laneId: lane.laneId,
    repository: lane.repository,
    issueNumber: lane.issueNumber,
    prNumber: lane.prNumber,
    branch: lane.branch,
    headSha: lane.headSha,
    ownerId: lease.ownerId,
  }, {
    ...options,
    root,
    dependencies: options.dependencies,
  });
  if (!release.ok) {
    return Object.freeze({
      ok: false,
      finalized: false,
      reason: release.reason,
      plan,
      records,
      evidencePublication,
      receiptPublication,
      release,
      terminalEvidencePublished: true,
    });
  }
  return Object.freeze({
    schemaVersion: PROGRAMME_AUTHORITY_SERVICE_SCHEMA,
    ok: true,
    finalized: true,
    idempotent,
    reason: idempotent ? 'TERMINAL_LANE_ALREADY_FINALIZED' : 'TERMINAL_LANE_FINALIZED',
    plan,
    records,
    evidencePublication,
    receiptPublication,
    release,
    schedulesWork: false,
    dispatchesWork: false,
    mergeAuthority: false,
  });
}

export function buildProgrammeStallMonitorRegistration(options = {}) {
  const definition = buildProgrammeStallMonitorDefinition(options);
  if (!definition.ok) return definition;
  const handler = createProgrammeStallMonitorHandler({
    stallAfterMs: options.stallAfterMs,
    loadProjection: ({ nowUtc }) => readAuthoritativeProgrammeProjection({
      ...options,
      nowUtc,
      dependencies: options.dependencies,
      testOnly: options.testOnly,
    }),
  });
  return Object.freeze({
    ok: true,
    definition: definition.definition,
    handlers: Object.freeze({ [PROGRAMME_STALL_MONITOR_HANDLER_ID]: handler }),
    runtime: 'monitor-multiplexer',
    startsNewRuntime: false,
    createsScheduler: false,
    createsWorker: false,
    finalVerdict: 'PROGRAMME_STALL_MONITOR_REGISTERED_WITH_EXISTING_MULTIPLEXER',
  });
}
