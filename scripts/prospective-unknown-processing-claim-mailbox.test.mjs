import test from 'node:test';
import assert from 'node:assert/strict';
import { cancelMissionOrchestratorMission } from './battle-bridge-github-command-mailbox.mjs';

test('mailbox routes prospective UNKNOWN quarantine to the existing exact-claim handler', async () => {
  let genericCalls = 0;
  let legacyCalls = 0;
  let cancelCalls = 0;
  const command = {
    missionId: 'critical-1574-elastic-goal',
    commandId: 'quarantine-1574-r5-unknown',
    reason: 'Prospective containment only.',
    requestId: 'quarantine-1574-r5-request',
    expectedMissionRevision: 6,
    prospectiveOrphanQuarantineRequested: true,
    sourceExecutionId: 'critical-1574-elastic-goal-r5-101c4622bbe4',
    sourceExecutionLeaseKey: 'critical-1574-elastic-goal-r5-lease',
    processingClaimSha256: 'a'.repeat(64),
  };
  const result = await cancelMissionOrchestratorMission(command, {
    readSourceIdentity: async () => ({ ok: true, sourceHead: 'b'.repeat(40) }),
    cancelMission: async () => { cancelCalls += 1; return {}; },
    quarantineSourceAttempt: async () => { legacyCalls += 1; return {}; },
    quarantineUnknownClaim: async input => {
      genericCalls += 1;
      assert.equal(input.operatorSourceRevision, 'b'.repeat(40));
      assert.equal(input.sourceExecutionId, command.sourceExecutionId);
      assert.equal(input.processingClaimSha256, command.processingClaimSha256);
      return {
        state: {
          missionId: command.missionId,
          currentPhase: 'CANCELLED',
          storeMetadata: {
            originalSourceAttemptFence: {
              schemaVersion: 'stephanos.original-source-attempt-prospective-orphan-fence.v1',
            },
          },
        },
        processingClaimQuarantine: {
          quarantined: true,
          processingClaimSha256: command.processingClaimSha256,
        },
      };
    },
  });
  assert.equal(genericCalls, 1);
  assert.equal(legacyCalls, 0);
  assert.equal(cancelCalls, 0);
  assert.equal(result.ok, true);
  assert.equal(result.processingClaimQuarantined, true);
  assert.equal(result.processingClaimSha256, command.processingClaimSha256);
});
