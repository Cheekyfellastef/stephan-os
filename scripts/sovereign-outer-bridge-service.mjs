// Existing Core Daemon single-instance lock owns this timer. No new daemon,
// Scheduled Task, GitHub transport, or source-mutation authority is created.
import { resolve } from 'node:path';
import {
  createSharedWorkspaceStatusRecord, writeAtomicJson,
} from '../shared/agents/sharedAgentWorkspaceStore.mjs';
import {
  decideSovereignOuterBridgeAttemptV1, projectSovereignOuterBridgeV1,
  SOVEREIGN_OUTER_BRIDGE_POLL_MS,
} from '../shared/agents/sovereignOuterBridgeV1.mjs';
import { runTemporarySovereignRescueObservationV1 } from './temporary-sovereign-lease-rescue.mjs';

const asTime = now => now instanceof Date ? now : new Date(now);
const code = (value, fallback = 'BRIDGE_CYCLE_UNVERIFIED') =>
  /^[A-Z][A-Z0-9_]{0,119}$/.test(String(value || '')) ? value : fallback;
const blockedRescue = (reason) => Object.freeze({
  schemaVersion: 'stephanos.temporary-sovereign-lease-rescue.v1',
  publicationOk: false,
  canonicalLeaseReleaseProven: false,
  blocker: code(reason),
});

export function createSovereignOuterBridgeSupervisorV1({
  root,
  workspaceRoot,
  runRescue = runTemporarySovereignRescueObservationV1,
  publish = writeAtomicJson,
  now = () => new Date(),
  intervalMs = SOVEREIGN_OUTER_BRIDGE_POLL_MS,
} = {}) {
  if (!root || !workspaceRoot || !Number.isInteger(intervalMs)
      || intervalMs < 30_000 || intervalMs > 10 * 60_000) {
    throw Error('SOVEREIGN_OUTER_BRIDGE_CONFIG_INVALID');
  }
  let nextEligibleAtMs = 0;
  let inFlight = false;
  let lastResult = null;
  let runCount = 0;
  const statusSegments = Object.freeze(['status', 'sovereign-outer-bridge-current.json']);
  const tick = ({ sourceHead, gamingActive = false, shutdown = false } = {}) => {
    const instant = asTime(now());
    const decision = decideSovereignOuterBridgeAttemptV1({
      nowMs: instant.getTime(), nextEligibleAtMs, inFlight, sourceHead,
      gamingActive, shutdown,
    });
    if (!decision.start) return Object.freeze({
      ...decision, inFlight, lastResult, runCount,
    });
    inFlight = true;
    nextEligibleAtMs = instant.getTime() + intervalMs;
    runCount++;
    // Detached only from the 15-second heartbeat's await chain. The Core
    // process owns this single-flight promise and never starts a second one
    // while the first is unresolved. Other core loops continue to heartbeat.
    void (async () => {
      // Publish STARTED before any potentially slow original-worker queue
      // forensics. This proves whether the healthy Core loop reached the bridge
      // even if the canonical reconciler subsequently blocks on an I/O fence.
      const starting = projectSovereignOuterBridgeV1({
        observedAtUtc: instant.toISOString(),
        sourceHead, sourceIdentityVerified: true,
        rescue: blockedRescue('OUTER_RESCUE_INSPECTION_IN_FLIGHT'),
      });
      const startingRecord = {
        ...createSharedWorkspaceStatusRecord({
          statusId: 'sovereign-outer-bridge-current',
          participantId: 'stephanos-core-daemon',
          relatedIssue: '#2961',
          timestampUtc: instant.toISOString(),
          status: 'HELD',
          summary: 'Outer bridge cycle started; original source receipt and lease recovery remain unverified.',
        }),
        bridge: starting,
      };
      let startPublished = false;
      try {
        const receipt = await publish(workspaceRoot, statusSegments, startingRecord, { repoRoot: root });
        startPublished = receipt?.ok === true;
      } catch {
        // Do not take down the Core heartbeat if this optional status fails.
      }
      lastResult = Object.freeze({
        ...starting,
        publicationOk: startPublished,
        finalVerdict: startPublished
          ? 'SOVEREIGN_OUTER_BRIDGE_INSPECTION_IN_FLIGHT'
          : 'SOVEREIGN_OUTER_BRIDGE_START_PUBLICATION_FAILED',
      });
      let rescue;
      try {
        rescue = await runRescue({
          now: instant, sourceHead,
          paths: { repoRoot: root, workspaceRoot },
        });
      } catch {
        rescue = blockedRescue('OUTER_RESCUE_EXECUTION_FAILED');
      }
      const view = projectSovereignOuterBridgeV1({
        observedAtUtc: instant.toISOString(),
        sourceHead, sourceIdentityVerified: true, rescue,
        workerPickupReceiptProven: false,
        unattendedRefillReceiptCount: 0,
      });
      const status = {
        ...createSharedWorkspaceStatusRecord({
          statusId: 'sovereign-outer-bridge-current',
          participantId: 'stephanos-core-daemon',
          relatedIssue: '#2961',
          timestampUtc: instant.toISOString(),
          status: view.status,
          summary: 'Wide Core Daemon to canonical authority bridge; source repair and physical pickup are separately proof-gated.',
        }),
        bridge: view,
      };
      let publicationOk = false;
      try {
        const saved = await publish(workspaceRoot, statusSegments, status, { repoRoot: root });
        publicationOk = saved?.ok === true;
      } catch {
        // A failed status publication is not independent proof or success.
      }
      lastResult = Object.freeze({
        ...view,
        publicationOk,
        finalVerdict: publicationOk ? 'SOVEREIGN_OUTER_BRIDGE_REPORTED_HELD'
          : 'SOVEREIGN_OUTER_BRIDGE_PUBLICATION_FAILED',
      });
      inFlight = false;
    })().catch(() => {
      lastResult = Object.freeze({
        ...projectSovereignOuterBridgeV1({
          observedAtUtc: instant.toISOString(), sourceHead,
          sourceIdentityVerified: false,
          rescue: blockedRescue('OUTER_BRIDGE_INTERNAL_EXCEPTION'),
        }),
        publicationOk: false,
        finalVerdict: 'SOVEREIGN_OUTER_BRIDGE_FAILED',
      });
      inFlight = false;
    });
    return Object.freeze({ ...decision, inFlight: true, runCount });
  };
  const snapshot = () => Object.freeze({
    inFlight, nextEligibleAtMs, runCount, lastResult,
    sourceMutationAllowed: false, mergeAuthority: false,
  });
  return Object.freeze({ tick, snapshot });
}
