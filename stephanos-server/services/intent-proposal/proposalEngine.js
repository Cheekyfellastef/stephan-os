import { detectIntent } from './intentDetector.js';
import { buildProposal } from './proposalBuilder.js';
import { intentProposalStore } from './proposalStore.js';
import { normalizeProposalTruthModel } from './proposalTruthModel.js';
import { buildExecutionTruth } from './executionController.js';
import { isTrivialNonProjectQuery } from '../assistantQueryClassifier.js';

export function buildIntentProposalEnvelope({ requestText = '', context = {}, approvalGranted = false } = {}) {
  if (isTrivialNonProjectQuery(requestText)) {
    intentProposalStore.clear();
    return {
      intent: {
        intentDetected: false,
        intentType: 'assistant-query',
        intentConfidence: 'high',
        intentReason: 'trivial-non-project-query',
      },
      proposal: {
        proposalId: 'proposal_inactive',
        intentType: 'assistant-query',
        proposalCreated: false,
        proposalStatus: 'draft',
        proposalReason: 'Proposal pipeline inactive for trivial assistant query.',
        steps: [],
        proposalStepCount: 0,
      },
      execution: {
        executionEligible: false,
        executionStarted: false,
        executionCompleted: false,
        executionBlockedReason: 'No proposal required for direct assistant response.',
        executionResultSummary: 'Execution pipeline inactive.',
      },
    };
  }

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
