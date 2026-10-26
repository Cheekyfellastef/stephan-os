import { mailboxRotationDigest, parseMailboxRotationComment, MAILBOX_ROTATION_OPERATION } from './canonicalMailboxRotationV1.mjs';

export const MAILBOX_ROTATION_FENCE_MARKER = '<!-- stephanos:2315-mailbox-rotation-fence:v1 -->';
export const MAILBOX_ROTATION_FENCE_GOAL = 2315;
export const MAILBOX_ROTATION_DRAIN_WORKFLOWS = Object.freeze([
  'protected-workflow-dispatch-mailbox.yml', 'operator-merge-approval-gate.yml',
  'battle-bridge-out-of-band-observer-v1.yml', 'battle-bridge-tailscale-bootstrap-pipe.yml',
  'mailbox-receipt-index.yml', 'codex-banked-reset-telemetry.yml',
]);
const repo = 'Cheekyfellastef/stephan-os';
const positive = n => Number.isSafeInteger(n) && n > 0;

// This is a deny-only projection of the original native command and receipt.
// It cannot nominate an authority, merge a PR, or authorize a source update.
export function buildMailboxRotationFence(record, { commandCommentId, receiptCommentId = 0, receiptIssue = 0 } = {}) {
  const value = {};
  for (const key of ['transitionId', 'phase', 'predecessorIssue', 'successorIssue', 'cutoverPrNumber',
    'cutoverHead', 'preparationHead', 'freezeCommentId', 'drained']) value[key] = record[key];
  Object.assign(value, { commandCommentId, receiptCommentId, receiptIssue });
  return `${MAILBOX_ROTATION_FENCE_MARKER}\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\nDeny-only migration fence. Protected source remains the sole command authority.\n`;
}

export function findMailboxRotationFence(comments) {
  const matches = comments.filter(c => c?.user?.login === 'Cheekyfellastef'
    && typeof c.body === 'string' && c.body.startsWith(MAILBOX_ROTATION_FENCE_MARKER));
  if (matches.length > 1) throw new Error('MAILBOX_ROTATION_GLOBAL_FENCE_AMBIGUOUS');
  return matches[0] || null;
}

export async function readMailboxRotationFence(readComments, readComment) {
  const comment = findMailboxRotationFence(await readComments(MAILBOX_ROTATION_FENCE_GOAL));
  if (!comment) return null;
  const value = parseMailboxRotationFenceBody(comment);
  const proofs = { freeze: await readComment(value.freezeCommentId) };
  if (value.phase !== 'DRAINING') {
    proofs.command = await readComment(value.commandCommentId);
    proofs.receipt = await readComment(value.receiptCommentId);
  }
  return validateMailboxRotationFenceProof(value, proofs);
}

export function parseMailboxRotationFenceBody(comment) {
  let value;
  try { value = JSON.parse(comment.body.match(/```json\s*([\s\S]*?)```/)[1]); }
  catch { throw new Error('MAILBOX_ROTATION_GLOBAL_FENCE_INVALID'); }
  return value;
}

export function validateMailboxRotationFenceProof(value, proofs) {
  const frozen = parseMailboxRotationComment(proofs.freeze, value.predecessorIssue);
  const freeze = frozen?.value;
  if (frozen?.type !== 'command' || freeze.operation !== MAILBOX_ROTATION_OPERATION || freeze.rotationAction !== 'FREEZE'
    || freeze.transitionId !== value.transitionId || freeze.successorIssue !== value.successorIssue
    || freeze.cutoverPrNumber !== value.cutoverPrNumber || freeze.cutoverHead !== value.cutoverHead
    || freeze.expectedHead !== value.preparationHead || freeze.operatorApproval !== 'operator-approved') {
    throw new Error('MAILBOX_ROTATION_GLOBAL_FREEZE_PROOF_INVALID');
  }
  if (!['DRAINING', 'FROZEN', 'VERIFIED', 'CANCELLED'].includes(value.phase)) throw new Error('MAILBOX_ROTATION_GLOBAL_FENCE_INVALID');
  if (value.phase === 'DRAINING') return value; // Missing receipt never relaxes a denial.
  if (!positive(value.receiptCommentId) || !positive(value.commandCommentId)
    || ![value.predecessorIssue, value.successorIssue].includes(value.receiptIssue)) throw new Error('MAILBOX_ROTATION_GLOBAL_RECEIPT_REQUIRED');
  const command = parseMailboxRotationComment(proofs.command, value.receiptIssue);
  const receipt = parseMailboxRotationComment(proofs.receipt, value.receiptIssue);
  const c = command?.value, r = receipt?.value;
  const p = r?.operationResult?.mailboxRotation || r?.result?.result?.mailboxRotation || r?.result?.mailboxRotation;
  if (command?.type !== 'command' || receipt?.type !== 'receipt' || r.state !== 'DONE'
    || c.operation !== MAILBOX_ROTATION_OPERATION || r.operation !== c.operation
    || c.requestId !== r.requestId || c.expectedHead !== r.expectedHead || r.processSourceHead !== c.expectedHead
    || c.transitionId !== value.transitionId || p?.transitionId !== value.transitionId
    || p.phase !== value.phase || p.cutoverPrNumber !== value.cutoverPrNumber || p.cutoverHead !== value.cutoverHead
    || p.predecessorIssue !== value.predecessorIssue || p.successorIssue !== value.successorIssue
    || (value.phase === 'FROZEN' && (p.drained !== true || value.drained !== true))) {
    throw new Error('MAILBOX_ROTATION_GLOBAL_RECEIPT_INVALID');
  }
  return value;
}

export function mailboxRotationWorkflowAllowed(fence, { mode, prNumber, head } = {}) {
  if (!fence || ['VERIFIED', 'CANCELLED'].includes(fence.phase)) return true;
  if (mode === 'receipt') return true; // Provenance publication continues while execution drains.
  return fence.phase === 'FROZEN' && fence.drained === true && mode === 'protected'
    && prNumber === fence.cutoverPrNumber && head === fence.cutoverHead;
}

export async function inventoryMailboxRotationActions(readRunsByStatus, now = new Date().toISOString()) {
  const responses = [];
  for (const status of ['queued', 'in_progress', 'waiting', 'requested', 'pending']) responses.push(await readRunsByStatus(status));
  return evaluateMailboxRotationActionInventory(responses, now);
}

export function evaluateMailboxRotationActionInventory(responses, now = new Date().toISOString()) {
  if (!Array.isArray(responses) || responses.length !== 5) throw new Error('MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE');
  const runs = [];
  const seen = new Set();
  for (const response of responses) {
    // exclude_pull_requests=true is not enough: all non-completed runs are
    // inspected, including waiting/environment approvals and previous source.
    if (!response || !Number.isSafeInteger(response.total_count) || response.total_count < 0
      || response.total_count > 100 || !Array.isArray(response.workflow_runs)
      || response.workflow_runs.length !== response.total_count) throw new Error('MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE');
    for (const run of response.workflow_runs) {
      if (!positive(run.id) || !['completed', 'queued', 'in_progress', 'waiting', 'requested', 'pending'].includes(run.status)
        || typeof run.path !== 'string') throw new Error('MAILBOX_ROTATION_ACTIONS_INVENTORY_INVALID');
      const workflow = MAILBOX_ROTATION_DRAIN_WORKFLOWS.find(w => run.path === `.github/workflows/${w}`);
      // PR proof jobs cannot execute the production paths; all other live jobs count.
      if (workflow && run.status !== 'completed' && run.event !== 'pull_request' && !seen.has(run.id)) {
        seen.add(run.id); runs.push({ id: run.id, workflow, status: run.status });
      }
    }
  }
  return { complete: true, observedAt: now, pendingRuns: runs, inventoryDigest: mailboxRotationDigest(runs) };
}
