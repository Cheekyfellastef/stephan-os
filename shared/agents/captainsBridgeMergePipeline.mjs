export const CAPTAINS_BRIDGE_MERGE_PIPELINE_SCHEMA_VERSION = 'stephanos.captains-bridge-merge-pipeline.v1';
const SHA = /^[a-f0-9]{7,64}$/i;
function text(v, f='') { if (v == null) return f; const s = String(v).trim(); return s || f; }
function token(prNumber, headSha) { return `APPROVE_PR_${prNumber}_HEAD_${headSha}`; }
export function createCaptainsBridgeExactHeadApproval(input = {}) {
  return Object.freeze({ prNumber: Number(input.prNumber) || null, headSha: text(input.headSha), token: token(Number(input.prNumber) || 'UNKNOWN', text(input.headSha, 'UNKNOWN')), approvedAtUtc: text(input.approvedAtUtc, 'pending') });
}
export function projectCaptainsBridgeMergePipeline(input = {}) {
  const pr = input.pr || input.pullRequest || {};
  const prNumber = Number(pr.number || input.prNumber) || null;
  const headSha = text(pr.headSha || input.headSha);
  const proofPassed = ['passed','pass','ready','succeeded'].includes(text(input.proof?.status || pr.latestProof?.status).toLowerCase());
  const approval = input.approval || null;
  const approvalMatches = !!(approval && prNumber && Number(approval.prNumber) === prNumber && text(approval.headSha) === headSha && SHA.test(headSha));
  const merged = input.mergeReceipt?.merged === true || text(pr.state).toUpperCase() === 'MERGED';
  const mainSynced = input.mainSync?.synced === true;
  const ignitionPassed = ['passed','pass','ready'].includes(text(input.ignitionProof?.status).toLowerCase());
  let phase = 'PR';
  const missingEvidence = [];
  let exactNextAction = 'Open a pull request with a stable head SHA before proof or approval.';
  if (!prNumber || !SHA.test(headSha)) missingEvidence.push('PR_HEAD_SHA');
  else if (!proofPassed) { phase = 'PROOF'; missingEvidence.push('PASSED_PROOF'); exactNextAction = 'Run required proof and publish passing evidence before requesting exact-head approval.'; }
  else if (!approvalMatches) { phase = 'EXACT_HEAD_APPROVAL'; missingEvidence.push(approval ? 'FRESH_EXACT_HEAD_APPROVAL' : 'EXACT_HEAD_APPROVAL'); exactNextAction = `Operator approve exact head only: ${token(prNumber, headSha)}.`; }
  else if (!merged) { phase = 'MERGE_RECEIPT'; missingEvidence.push('MERGE_RECEIPT'); exactNextAction = `Operator may merge PR #${prNumber} at exact head ${headSha}; no auto-merge is permitted.`; }
  else if (!mainSynced) { phase = 'MAIN_SYNC'; missingEvidence.push('MAIN_SYNC_RECEIPT'); exactNextAction = 'Sync main after merge, rebuild if needed, and publish the main-sync receipt.'; }
  else if (!ignitionPassed) { phase = 'IGNITION_PROOF'; missingEvidence.push('IGNITION_PROOF'); exactNextAction = 'Run npm run stephanos:ignite and attach ignition proof after main sync.'; }
  else { phase = 'COMPLETE'; exactNextAction = 'Merge pipeline complete; keep monitoring runtime health.'; }
  return Object.freeze({ schemaVersion: CAPTAINS_BRIDGE_MERGE_PIPELINE_SCHEMA_VERSION, kind: 'stephanos.captains_bridge.merge_pipeline.projection', readOnly: true, exactHeadApprovalRequired: true, autoMergeAllowed: false, autoPushAllowed: false, hardResetAllowed: false, branchDeletionAllowed: false, prNumber, headSha: headSha || 'UNKNOWN', phase, missingEvidence, exactNextAction, approval: approvalMatches ? approval : null, expectedApprovalToken: prNumber && headSha ? token(prNumber, headSha) : token('UNKNOWN','UNKNOWN'), finalVerdict: phase === 'COMPLETE' ? 'CAPTAINS_BRIDGE_MERGE_PIPELINE_COMPLETE' : 'CAPTAINS_BRIDGE_MERGE_PIPELINE_HELD' });
}
