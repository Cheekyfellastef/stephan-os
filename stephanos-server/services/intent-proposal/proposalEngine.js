import { detectIntent } from './intentDetector.js';
import { buildProposal } from './proposalBuilder.js';
import { intentProposalStore } from './proposalStore.js';
import { normalizeProposalTruthModel } from './proposalTruthModel.js';
import { buildExecutionTruth } from './executionController.js';

export function buildIntentProposalEnvelope({ requestText = '', context = {}, approvalGranted = false } = {}) {
  const intent = detectIntent(requestText);
  const proposalDraft = buildProposal({ requestText, intent, context });
  const proposalTruth = normalizeProposalTruthModel(proposalDraft);
  const executionTruth = buildExecutionTruth({ proposal: proposalTruth, approvalGranted, simulateOnly: true });

  intentProposalStore.setActiveProposal(proposalTruth);

  return {
    intent,
    proposal: proposalTruth,
    execution: executionTruth,
  };
}
