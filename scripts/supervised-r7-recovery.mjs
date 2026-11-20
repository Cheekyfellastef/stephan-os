import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveCriticalBacklogRuntimePaths } from '../stephanos-server/services/criticalBacklogConveyorServiceCore.js';
import { readMissionRecord } from '../stephanos-server/services/missionOrchestratorStore.js';
import { reconcileExpiredElasticReviewLeaseV1 } from '../stephanos-server/services/elasticPrHeadLeaseService.js';
import { retireSupervisedOriginalSourceRecovery } from '../stephanos-server/services/originalSourceAttemptFenceService.js';
import { describeSupervisedR7Maintenance, beginSupervisedR7Maintenance, preserveSupervisedR7Maintenance,
  persistRuntimeSupervisedR7Packet, supervisedRecoveryDigest } from '../stephanos-server/services/supervisedR7RecoveryRuntime.js';

// Explicit operator tool using existing stores, worker paths and reconciler.
// Not registered with an autonomous controller or the public mailbox. It never
// restarts a worker, runs a generated command or accepts a caller-selected path.
export async function runSupervisedR7Recovery(stage, input, approvalCommentId, options = {}) {
  const paths = options.paths || resolveCriticalBacklogRuntimePaths({});
  const opts = { ...options, paths };
  if (stage === 'describe-maintenance') {
    const packet = await describeSupervisedR7Maintenance(input, opts);
    return { packet, packetDigest: supervisedRecoveryDigest(packet), hostMutationPerformed: false };
  }
  if (stage === 'maintenance') return beginSupervisedR7Maintenance(input, approvalCommentId, opts);
  if (stage === 'preserve') return preserveSupervisedR7Maintenance(opts);
  if (stage === 'prepare') return persistRuntimeSupervisedR7Packet(input, opts);
  if (stage !== 'retire') throw new Error('SUPERVISED_R7_STAGE_INVALID');
  const cancelled = await retireSupervisedOriginalSourceRecovery(input, approvalCommentId, opts);
  if (cancelled.preconditionFailed) throw new Error('SUPERVISED_R7_CANCELLATION_NOT_COMMITTED');
  const { state } = await readMissionRecord('critical-2962-elastic-goal', { root: paths.orchestratorRoot, env: options.env });
  const released = await reconcileExpiredElasticReviewLeaseV1({ paths, env: options.env,
    sourceRevision: input.sourceRevision, missionRecords: [state] });
  return { cancelled: state.cancelled === true, released,
    historicalExecutionOutcome: 'UNKNOWN', witnessCommissioned: false,
    hostileWriterExclusionProven: false, workerRestarted: false, workerPickupProven: false };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Private stdin prevents source paths/approval packet bodies being pasted into
  // public commands. Request fields are closed-world validated by the service.
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 4096) throw new Error('SUPERVISED_R7_REQUEST_UNBOUNDED');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks).toString('utf8');
  const body = JSON.parse(bytes);
  if (Object.keys(body).some(k => !['request', 'approvalCommentId'].includes(k)))
    throw new Error('SUPERVISED_R7_REQUEST_FIELDS_FORBIDDEN');
  const result = await runSupervisedR7Recovery(process.argv[2], body.request, body.approvalCommentId);
  process.stdout.write(JSON.stringify(result) + '\n');
}
