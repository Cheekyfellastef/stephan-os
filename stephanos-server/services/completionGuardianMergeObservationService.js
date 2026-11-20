import { createHash } from 'node:crypto';
import { externalMergeCandidateV1, validateExternalMergeObservationV1 } from '../../shared/agents/externalMergeObservationV1.mjs';
import { fetchExternalMergeObservation } from './githubPrEvidenceService.js';
import { appendMissionEvent } from './missionOrchestratorStore.js';

const attemptedAt = new Map();
// One retained mission per existing sweep. Least-recently-attempted selection
// remains fair even when sweeps are farther apart than the cooldown. Attempt
// times bound reads only; they never substitute cached merge truth.
export async function reconcileExternalMergeObservation(missions, options = {}) {
  const now = Date.now();
  const candidates = missions.filter(externalMergeCandidateV1);
  for (const key of attemptedAt.keys()) if (!candidates.some(m => `${options.root}:${m.missionId}` === key)) attemptedAt.delete(key);
  const lastAttempt = m => attemptedAt.get(`${options.root}:${m.missionId}`);
  const mission = candidates
    .filter(m => lastAttempt(m) === undefined || now - lastAttempt(m) >= 60_000)
    .sort((a, b) => (lastAttempt(a) ?? 0) - (lastAttempt(b) ?? 0)
      || String(a.missionId).localeCompare(String(b.missionId)))[0];
  if (!mission) return { status: 'skipped', reasonCode: 'NO_ELIGIBLE_MERGE_OBSERVATION' };
  attemptedAt.set(`${options.root}:${mission.missionId}`, now);
  const result = await fetchExternalMergeObservation(mission, options);
  if (result.status !== 'fetched') return { ...result, missionId: mission.missionId };
  const observation = result.observation;
  const evidenceSha256 = createHash('sha256').update(JSON.stringify(observation)).digest('hex');
  const eventId = `external-merge-${evidenceSha256}`;
  const event = {
    eventType: 'EXTERNAL_PULL_REQUEST_MERGE_OBSERVED', eventId, missionId: mission.missionId,
    expectedRevision: mission.revision, expectedCurrentPhase: mission.currentPhase, observation,
    timestamp: new Date().toISOString(), summary: 'Observed existing PR integrated on main; goal acceptance remains unproven.',
    receipt: { receiptId: eventId, source: 'completion-guardian-github-observation', evidenceType: 'github-merged-observation',
      requirement: 'source integration observation only', verified: true, exitCode: 0,
      createdAt: observation.observedAtUtc, commandOutputHash: evidenceSha256 },
  };
  try {
    const written = await appendMissionEvent(mission.missionId, event, {
      root: options.root, snapshotRoot: options.snapshotRoot,
      authorizeExternalMergeObservation: current => {
        if (!validateExternalMergeObservationV1(current, observation, new Date().toISOString()).valid) {
          throw new Error('EXTERNAL_MERGE_OBSERVATION_NO_LONGER_VALID');
        }
      },
    });
    return { status: written.preconditionFailed ? 'deferred' : 'recorded',
      reasonCode: written.reason, missionId: mission.missionId, state: written.state };
  } catch {
    return { status: 'deferred', reasonCode: 'EXTERNAL_MERGE_OBSERVATION_NOT_RECORDED', missionId: mission.missionId };
  }
}
