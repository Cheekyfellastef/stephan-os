import { appendWorkspaceJsonl, listLatestSharedWorkspaceParticipantStatuses } from './sharedAgentWorkspaceStore.mjs';
import { buildRecurringCapabilityCalibrationReadinessV1 } from './recurringMultiAgentCapabilityCalibrationV1.mjs';

export const RECURRING_CALIBRATION_RUNNER_SCHEMA = 'stephanos.recurring-calibration-runner.v1';

export async function runRecurringCalibrationReadinessV1(options = {}) {
  const nowUtc = options.nowUtc || new Date().toISOString();
  const trigger = String(options.trigger || 'SCHEDULED').toUpperCase();
  const workspaceRoot = options.workspaceRoot || options.root;
  const loadStatuses = options.loadParticipantStatuses || listLatestSharedWorkspaceParticipantStatuses;
  const publishRecord = options.publishRecord || (async (record) =>
    appendWorkspaceJsonl(workspaceRoot, ['events', 'capability-calibration.jsonl'], record, {
      repoRoot: options.repoRoot,
      nowMs: Date.parse(nowUtc),
    }));
  if (!workspaceRoot && !options.loadParticipantStatuses) {
    return Object.freeze({ schemaVersion: RECURRING_CALIBRATION_RUNNER_SCHEMA, ok: false, reason: 'workspace-root-required' });
  }
  const loaded = await loadStatuses(workspaceRoot, { repoRoot: options.repoRoot, nowMs: Date.parse(nowUtc) });
  const records = Array.isArray(loaded?.records) ? loaded.records : [];
  const readiness = buildRecurringCapabilityCalibrationReadinessV1({
    nowUtc,
    trigger,
    participantStatusRecords: records,
    intervalMs: options.intervalMs,
  });
  if (readiness.valid !== true) return Object.freeze({ schemaVersion: RECURRING_CALIBRATION_RUNNER_SCHEMA, ok: false, reason: 'readiness-invalid', readiness });
  const vrDue = readiness.dueParticipantIds.includes('stephanos-vr-research');
  const receipt = Object.freeze({
    schemaVersion: RECURRING_CALIBRATION_RUNNER_SCHEMA,
    kind: 'EVENT',
    eventId: 'recurring-calibration-readiness-' + nowUtc.replace(/[^0-9]/g, ''),
    participantId: 'durable-flywheel-controller',
    timestampUtc: nowUtc,
    eventKind: 'capability-calibration-readiness',
    summary: 'Recurring calibration readiness: due=' + readiness.dueParticipantIds.length + '; vrResearchDue=' + vrDue + '.',
    dueParticipantIds: readiness.dueParticipantIds,
    vrResearchDue: vrDue,
    trigger,
  });
  const publication = await publishRecord(receipt);
  return Object.freeze({
    schemaVersion: RECURRING_CALIBRATION_RUNNER_SCHEMA,
    ok: publication?.ok !== false,
    reason: 'RECURRING_CALIBRATION_READINESS_EVALUATED',
    readiness,
    receipt,
    publication,
  });
}
