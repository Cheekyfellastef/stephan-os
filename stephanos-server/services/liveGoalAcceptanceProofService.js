import { reconcileGoalAcceptance } from '../../shared/agents/goalAcceptanceReconciliationV1.mjs';

const commits = { 1646: '6d18962a3c7b8bfc2131af256b4e6c5c7b94bddf', 1717: '7e2fe1b4ac7755e98af72e7feeaeaef58de4f53d', 1723: '89a7c28058ee1f9534cf083e937ade9257799732' };
const questions = ['SOURCE_STACK','NEXT_EXPERIMENT','EVIDENCE_PLANE','AUTHORING_VS_RUNTIME','VORPX_BASELINE','SKYRIM_PARITY','LICENCE_BOUNDARIES','SPATIAL_BRIDGE_BLOCKERS','NEXT_BOUNDED_GOAL','KNOWN_UNKNOWNS'];

export async function collectGoalAcceptanceProof({ goalNumber, mission, sourceHead, verifyMerge, checkVrLink, checkBrowserFallback, checkVrLabConsumer, askVrResearch, nowUtc = new Date().toISOString() } = {}) {
  const proofs = [];
  const add = (requirement) => proofs.push({ requirement, receiptId: 'verified-' + requirement.toLowerCase().replaceAll('_','-') + '-' + sourceHead.slice(0,12), sourceHead, observedAtUtc: nowUtc, verified: true, authority: 'CANONICAL_INDEPENDENT_VERIFIER', sourceMutationAllowed: false, mergeAuthority: false });
  if (!commits[goalNumber] || !/^[0-9a-f]{40}$/.test(String(sourceHead)) || typeof verifyMerge !== 'function') return { proofs, reconciliation: reconcileGoalAcceptance({ goalNumber, mission, sourceHead }) };
  if (await verifyMerge(commits[goalNumber], sourceHead) === true) add('SOURCE_MERGED');
  if (goalNumber === 1717 && typeof checkVrLink === 'function' && await checkVrLink() === true) add('LOCAL_ROUTE_HTTP_200');
  if (goalNumber === 1717 && typeof checkBrowserFallback === 'function' && await checkBrowserFallback() === true) add('DESKTOP_FALLBACK_BROWSER_PROVEN');
  if (goalNumber === 1723 && typeof askVrResearch === 'function') {
    let valid = 0;
    for (const q of questions) {
      try { const answer = await askVrResearch(q); if (answer?.ok === true && answer.participantId === 'stephanos-vr-research' && answer.answer && (answer.gapObservation || answer.answer.answerVerdict === 'ANSWERED_GROUNDED')) valid++; } catch {}
    }
    if (valid > 0) add('QA_ROUTE_HTTP_200');
    if (valid === questions.length) add('TEN_QUESTION_ROUTE_PROVEN');
  }
  if (goalNumber === 1723 && typeof checkVrLabConsumer === 'function' && await checkVrLabConsumer() === true) add('VR_LAB_CONSUMER_PROVEN');
  return { proofs, reconciliation: reconcileGoalAcceptance({ goalNumber, mission, sourceHead, proofs }) };
}
