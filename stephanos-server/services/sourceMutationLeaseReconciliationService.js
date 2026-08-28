import { readFile, unlink } from 'node:fs/promises';

import {
  createSourceMutationLeaseReleaseRecord,
  validateSourceMutationLease,
  validateSourceMutationLeaseReleaseRecord,
} from '../../shared/agents/programmeAuthorityV1.mjs';
import {
  ensureSharedWorkspaceLayout,
  resolveSharedWorkspacePath,
  writeAtomicJson,
} from '../../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  EXECUTION_RECEIPT_TERMINAL_STATES,
  acquireSharedWorkspaceOperationLock,
  readCurrentExecutionReceipt,
} from '../../shared/agents/executionReceiptV1.mjs';
import {
  SOURCE_MUTATION_LEASE_FILE,
  readSourceMutationLease,
} from './programmeAuthorityService.js';
import { listMissionRecords } from './missionOrchestratorStore.js';

export const SOURCE_MUTATION_LEASE_RECONCILIATION_SCHEMA = 'stephanos.source-mutation-lease-reconciliation.v1';
const SOURCE_MUTATION_LEASE_OPERATION_GUARD_FILE = 'source-mutation-lease-operation.lock';
const EXPLICIT_TIMEZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;
const SHA_40 = /^[0-9a-f]{40}$/i;

function text(value, fallback = '') {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || fallback;
}

function safeNow(value) {
  const normalized = text(value);
  return EXPLICIT_TIMEZONE.test(normalized) && Number.isFinite(Date.parse(normalized))
    ? new Date(Date.parse(normalized)).toISOString()
    : '';
}

function positiveInteger(value) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function dependencies(options = {}) {
  if (options.dependencies && options.testOnly !== true) {
    throw new TypeError('dependency overrides are test-only');
  }
  return {
    listMissionRecords,
    readCurrentExecutionReceipt,
    acquireSharedWorkspaceOperationLock,
    readFile,
    unlink,
    writeAtomicJson,
    ...(options.dependencies ?? {}),
  };
}

function exactLeaseIdentity(value, expected) {
  return Boolean(
    value
    && expected
    && text(value.leaseId) === text(expected.leaseId)
    && text(value.laneId) === text(expected.laneId)
    && text(value.repository) === text(expected.repository)
    && positiveInteger(value.issueNumber) === positiveInteger(expected.issueNumber)
    && positiveInteger(value.prNumber) === positiveInteger(expected.prNumber)
    && text(value.branch) === text(expected.branch)
    && text(value.headSha).toLowerCase() === text(expected.headSha).toLowerCase()
    && text(value.ownerId) === text(expected.ownerId)
  );
}

function exactExecutionIdentity(receipt, lease) {
  return Boolean(
    receipt
    && lease
    && text(receipt.repository) === text(lease.repository)
    && positiveInteger(receipt.issueNumber) === positiveInteger(lease.issueNumber)
    && positiveInteger(receipt.prNumber) === positiveInteger(lease.prNumber)
    && text(receipt.branch) === text(lease.branch)
    && text(receipt.sourceHead).toLowerCase() === text(lease.headSha).toLowerCase()
    && text(receipt.leaseKey) === text(lease.leaseId)
    && text(receipt.workerId) === text(lease.ownerId)
  );
}

function liveMissionOwner(missions, lease) {
  for (const mission of Array.isArray(missions) ? missions : []) {
    const dispatch = mission?.dispatch || {};
    if (text(dispatch.status).toLowerCase() !== 'running') continue;
    if (
      text(mission?.missionId).toLowerCase() === text(lease?.laneId).toLowerCase()
      || text(dispatch.workerId) === text(lease?.ownerId)
    ) {
      return Object.freeze({
        missionId: text(mission?.missionId),
        workerId: text(dispatch.workerId),
        actionId: text(dispatch.actionId),
      });
    }
  }
  return null;
}

async function readJson(path, read = readFile) {
  try {
    return { present: true, value: JSON.parse(await read(path, 'utf8')), error: null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { present: false, value: null, error: null };
    return { present: false, value: null, error };
  }
}

function result(ok, additions = {}) {
  return Object.freeze({
    schemaVersion: SOURCE_MUTATION_LEASE_RECONCILIATION_SCHEMA,
    ok,
    reconciled: false,
    released: false,
    leaseSeizureAllowed: false,
    ...additions,
  });
}

export async function reconcileStaleSourceMutationLease(input = {}, options = {}) {
  const nowUtc = safeNow(input.nowUtc);
  if (!nowUtc) return result(false, { reason: 'STALE_SOURCE_LEASE_RECONCILIATION_TIME_INVALID' });

  const layout = await ensureSharedWorkspaceLayout({ root: options.root, repoRoot: options.repoRoot });
  if (!layout.ok) return result(false, { reason: layout.reason });

  const deps = dependencies(options);
  const guard = await deps.acquireSharedWorkspaceOperationLock(
    layout.root,
    ['status', SOURCE_MUTATION_LEASE_OPERATION_GUARD_FILE],
    {
      repoRoot: options.repoRoot,
      operationLockTimeoutMs: 1_000,
      operationLockRetryMs: 25,
      operationStaleLockMs: 30_000,
      operationLockHeartbeatMs: 5_000,
    },
  );
  if (!guard.ok) {
    return result(false, {
      reason: guard.reason === 'SHARED_WORKSPACE_OPERATION_LOCK_TIMEOUT'
        ? 'STALE_SOURCE_LEASE_RECONCILIATION_BUSY'
        : 'STALE_SOURCE_LEASE_RECONCILIATION_GUARD_FAILED',
      guard,
    });
  }

  let operationResult;
  try {
    const current = await readSourceMutationLease({
      root: layout.root,
      repoRoot: options.repoRoot,
      nowUtc,
      readFileImpl: deps.readFile,
    });
    if (current.ok && !current.present) {
      operationResult = result(true, {
        reason: 'STALE_SOURCE_LEASE_RECONCILIATION_NOT_REQUIRED',
        current,
      });
    } else if (!current.ok || !current.present || !current.record) {
      operationResult = result(false, {
        reason: `STALE_SOURCE_LEASE_CURRENT_STATE_BLOCKED:${text(current.reason, 'unknown')}`,
        current,
      });
    } else {
      const lease = current.record;
      const validation = validateSourceMutationLease(lease, { nowUtc });
      if (!validation.valid) {
        operationResult = result(false, {
          reason: 'STALE_SOURCE_LEASE_IDENTITY_INVALID',
          validation,
        });
      } else if (validation.active) {
        operationResult = result(true, {
          reason: 'STALE_SOURCE_LEASE_RECONCILIATION_NOT_REQUIRED_ACTIVE_LEASE',
          current,
          validation,
        });
      } else if (!validation.stale) {
        operationResult = result(false, {
          reason: 'STALE_SOURCE_LEASE_STATE_AMBIGUOUS',
          current,
          validation,
        });
      } else {
        const missions = await deps.listMissionRecords(options);
        if (!Array.isArray(missions)) {
          operationResult = result(false, {
            reason: 'STALE_SOURCE_LEASE_MISSION_STATE_UNAVAILABLE',
          });
        } else {
          const liveOwner = liveMissionOwner(missions, lease);
          if (liveOwner) {
            operationResult = result(false, {
              reason: 'STALE_SOURCE_LEASE_LIVE_MISSION_OWNER_PRESENT',
              liveOwner,
            });
          } else {
            const execution = await deps.readCurrentExecutionReceipt(
              layout.root,
              { leaseKey: lease.leaseId, expectedHead: lease.headSha },
              { repoRoot: options.repoRoot },
            );
            if (!execution?.ok) {
              operationResult = result(false, {
                reason: `STALE_SOURCE_LEASE_EXECUTION_EVIDENCE_BLOCKED:${text(execution?.reason, 'unknown')}`,
                execution,
              });
            } else if (
              execution.receipt
              && !exactExecutionIdentity(execution.receipt, lease)
            ) {
              operationResult = result(false, {
                reason: 'STALE_SOURCE_LEASE_EXECUTION_IDENTITY_MISMATCH',
                execution,
              });
            } else if (
              execution.receipt
              && !EXECUTION_RECEIPT_TERMINAL_STATES.includes(text(execution.receipt.state).toLowerCase())
            ) {
              operationResult = result(false, {
                reason: 'STALE_SOURCE_LEASE_NONTERMINAL_EXECUTION_PRESENT',
                execution,
              });
            } else {
              const releaseRecord = createSourceMutationLeaseReleaseRecord(lease, { timestampUtc: nowUtc });
              const releasePath = resolveSharedWorkspacePath({
                root: layout.root,
                repoRoot: options.repoRoot,
                segments: ['status', `${releaseRecord.statusId}.json`],
              });
              if (!releasePath.ok) {
                operationResult = result(false, { reason: releasePath.reason });
              } else {
                const existingRelease = await readJson(releasePath.path, deps.readFile);
                if (existingRelease.error) {
                  operationResult = result(false, {
                    reason: 'STALE_SOURCE_LEASE_RELEASE_RECORD_READ_FAILED',
                    errorCode: existingRelease.error.code || '',
                  });
                } else if (
                  existingRelease.present
                  && !validateSourceMutationLeaseReleaseRecord(existingRelease.value, lease, { nowUtc }).valid
                ) {
                  operationResult = result(false, {
                    reason: 'STALE_SOURCE_LEASE_RELEASE_RECORD_CONFLICT',
                  });
                } else {
                  let publication = existingRelease.present
                    ? Object.freeze({ ok: true, idempotent: true, path: releasePath.path })
                    : await deps.writeAtomicJson(
                        layout.root,
                        ['status', `${releaseRecord.statusId}.json`],
                        releaseRecord,
                        { repoRoot: options.repoRoot, nowMs: Date.parse(nowUtc) },
                      );
                  if (!publication.ok) {
                    operationResult = result(false, {
                      reason: `STALE_SOURCE_LEASE_RELEASE_PUBLICATION_FAILED:${text(publication.reason, 'unknown')}`,
                      publication,
                    });
                  } else {
                    const reloaded = await readJson(current.path, deps.readFile);
                    const exactReload = reloaded.present
                      && !reloaded.error
                      && exactLeaseIdentity(reloaded.value, lease)
                      && validateSourceMutationLease(reloaded.value, { nowUtc }).stale === true;
                    if (!exactReload) {
                      operationResult = result(false, {
                        reason: 'STALE_SOURCE_LEASE_CHANGED_DURING_RECONCILIATION',
                        publication,
                      });
                    } else {
                      try {
                        await deps.unlink(current.path);
                        operationResult = result(true, {
                          reconciled: true,
                          released: true,
                          reason: 'STALE_SOURCE_LEASE_RECONCILED_AND_RELEASED',
                          leaseId: lease.leaseId,
                          laneId: lease.laneId,
                          repository: lease.repository,
                          issueNumber: lease.issueNumber,
                          prNumber: lease.prNumber,
                          branch: lease.branch,
                          headSha: lease.headSha,
                          ownerId: lease.ownerId,
                          executionState: execution.receipt?.state || 'NO_EXECUTION_RECEIPT',
                          releaseRecord,
                          publication,
                          releaseOnlyExactLease: true,
                        });
                      } catch (error) {
                        if (error?.code === 'ENOENT') {
                          operationResult = result(true, {
                            reconciled: true,
                            released: false,
                            reason: 'STALE_SOURCE_LEASE_ALREADY_RELEASED_AFTER_EXACT_PROOF',
                            leaseId: lease.leaseId,
                            releaseRecord,
                            publication,
                            releaseOnlyExactLease: true,
                          });
                        } else {
                          operationResult = result(false, {
                            reason: 'STALE_SOURCE_LEASE_UNLINK_FAILED',
                            errorCode: error?.code || '',
                            releaseRecord,
                            publication,
                          });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch (error) {
    operationResult = result(false, {
      reason: 'STALE_SOURCE_LEASE_RECONCILIATION_FAILED',
      errorCode: error?.code || '',
    });
  }

  const guardReleased = await guard.release();
  if (!guardReleased) {
    return result(false, {
      reason: 'STALE_SOURCE_LEASE_RECONCILIATION_GUARD_RELEASE_FAILED',
      operationCommitted: operationResult?.ok === true && operationResult?.reconciled === true,
      operationResult,
    });
  }
  return operationResult;
}

export function isExactSourceMutationGrant(actionGrant = {}) {
  return Boolean(
    actionGrant?.schemaVersion === 'stephanos.mission-worker-action-grant.v1'
    && actionGrant?.boundedActionCount === 1
    && ['codex', 'openclaw-local', 'chatgpt-github', 'foundry-forge'].includes(text(actionGrant.adapter).toLowerCase())
    && text(actionGrant.laneId)
    && text(actionGrant.repository)
    && positiveInteger(actionGrant.issueNumber)
    && positiveInteger(actionGrant.prNumber)
    && text(actionGrant.branch)
    && SHA_40.test(text(actionGrant.headSha).toLowerCase())
    && text(actionGrant.workerId)
    && actionGrant.mergeAuthority === false
    && actionGrant.leaseSeizureAllowed === false
  );
}
