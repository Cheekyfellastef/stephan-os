import { createCodexQueueRecord, transitionCodexQueueRecord } from './codexDispatchQueue.mjs';
import { dispatchQueuedCodexJob } from './automatedCodexDispatcher.mjs';
import { createLocalCodexExecIntegration } from './localCodexExecIntegration.mjs';

const SCENARIO_PROMPTS = Object.freeze({
  MUSIC_RATING_PRESERVES_PLAYBACK: [
    'Run the Music Tile in Microsoft Edge on this Windows Battle Bridge.',
    'First prove git HEAD exactly matches the requested PR head; otherwise stop with EXPECTED_HEAD_MISMATCH.',
    'Mount a Listening Deck Spotify iframe and a verified Discovery Spotify iframe.',
    'Retain direct references to both iframe DOM nodes, click a rating button, and prove both references remain strictly identical and isConnected after the click.',
    'Prove the non-player legacy discovery ranking changed truthfully and capture browser console errors.',
    'Do not substitute source inspection, regex assertions, DOM emulation, or Linux browser results.',
  ].join(' '),
});

export function buildExactHeadWindowsBrowserProofPacket(command = {}, timestampUtc = new Date().toISOString()) {
  const prompt = SCENARIO_PROMPTS[command.proofScenario];
  if (!prompt) throw new Error('WINDOWS_BROWSER_PROOF_SCENARIO_NOT_ALLOWED');
  const created = createCodexQueueRecord({
    jobId: `windows-browser-proof-${command.requestId}`,
    issueNumber: 1507,
    branch: 'main',
    prompt: `PR #${command.prNumber}; expected head ${command.expectedHead}. ${prompt}`,
    requestedProofCommands: ['git rev-parse HEAD', 'npm run stephanos:browser-proof'],
    createdAt: timestampUtc,
    approvalRequirements: {
      requiresOperatorApprovalBeforeDispatch: true,
      requiresExactHeadApproval: true,
      requiresOperatorApprovalBeforeMerge: true,
    },
  });
  const waiting = transitionCodexQueueRecord(created, 'WAITING_OPERATOR_APPROVAL', {
    timestamp: timestampUtc,
    reason: 'GitHub mailbox received an owner-authored bounded Windows browser-proof request.',
  });
  if (!waiting.valid) throw new Error('WINDOWS_BROWSER_PROOF_QUEUE_APPROVAL_STATE_FAILED');
  const ready = transitionCodexQueueRecord(waiting.record, 'READY_FOR_MANUAL_DISPATCH', {
    timestamp: timestampUtc,
    reason: 'Operator approval was validated by the Battle Bridge mailbox.',
    approvalReceipt: `mailbox-${command.requestId}`,
  });
  if (!ready.valid) throw new Error('WINDOWS_BROWSER_PROOF_QUEUE_READY_STATE_FAILED');
  return ready.record;
}

export async function dispatchExactHeadWindowsBrowserProof(command, {
  platform = process.platform,
  integration = null,
  now = () => new Date().toISOString(),
} = {}) {
  if (platform !== 'win32') return { ok: false, blocker: 'WINDOWS_EXECUTION_SURFACE_REQUIRED' };
  const timestampUtc = now();
  const packet = buildExactHeadWindowsBrowserProofPacket(command, timestampUtc);
  const dispatcher = dispatchQueuedCodexJob({
    queueRecord: packet,
    integration: integration || createLocalCodexExecIntegration(),
    now: timestampUtc,
  });
  const ok = dispatcher.finalVerdict === 'CODEX_JOB_DISPATCHED';
  return {
    ok,
    finalVerdict: ok ? 'WINDOWS_BROWSER_PROOF_DISPATCHED' : 'WINDOWS_BROWSER_PROOF_DISPATCH_BLOCKED',
    blocker: ok ? '' : (dispatcher.blocker || dispatcher.reason || 'WINDOWS_BROWSER_PROOF_DISPATCH_FAILED'),
    taskId: dispatcher.record?.jobId || packet.jobId,
    prNumber: Number(command.prNumber),
    expectedHead: String(command.expectedHead),
    proofScenario: String(command.proofScenario),
    executionSurface: 'WINDOWS_BATTLE_BRIDGE_EDGE',
    mergeAuthority: false,
    sourceMutationAuthority: false,
  };
}
