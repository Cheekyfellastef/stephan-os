import crypto from 'node:crypto';

function stableId(prefix, parts = []) {
  const hash = crypto.createHash('sha1').update(parts.map((part) => String(part ?? '')).join('|')).digest('hex').slice(0, 12);
  return `${prefix}_${hash}`;
}

function stepsForIntent(intentType = 'unknown') {
  const map = {
    diagnose: [
      { description: 'Read relevant runtime state and logs.', stepType: 'read', executionRisk: 'low' },
      { description: 'Analyze likely failure points and produce bounded findings.', stepType: 'analyze', executionRisk: 'low' },
    ],
    build: [
      { description: 'Read impacted modules and constraints.', stepType: 'read', executionRisk: 'low' },
      { description: 'Analyze implementation options and propose minimal slice.', stepType: 'analyze', executionRisk: 'low' },
      { description: 'Apply write changes after explicit approval.', stepType: 'write', executionRisk: 'high' },
    ],
    refactor: [
      { description: 'Read code paths and coupling points.', stepType: 'read', executionRisk: 'low' },
      { description: 'Analyze safe extraction/move boundaries.', stepType: 'analyze', executionRisk: 'medium' },
      { description: 'Apply refactor patch after explicit approval.', stepType: 'write', executionRisk: 'high' },
    ],
    summarize: [
      { description: 'Read source material or provided context.', stepType: 'read', executionRisk: 'low' },
      { description: 'Generate structured summary proposal.', stepType: 'analyze', executionRisk: 'low' },
    ],
    retrieve: [
      { description: 'Retrieve bounded local evidence.', stepType: 'retrieve', executionRisk: 'low' },
      { description: 'Analyze evidence relevance and confidence.', stepType: 'analyze', executionRisk: 'low' },
    ],
    'promote-memory': [
      { description: 'Read memory candidate and adjudication constraints.', stepType: 'read', executionRisk: 'low' },
      { description: 'Prepare memory promotion proposal for explicit approval.', stepType: 'memory', executionRisk: 'medium' },
    ],
    'tile-action': [
      { description: 'Read tile/workspace context and target tile.', stepType: 'read', executionRisk: 'low' },
      { description: 'Prepare tile action proposal.', stepType: 'tile', executionRisk: 'medium' },
    ],
    unknown: [
      { description: 'Read request and collect clarifying context.', stepType: 'read', executionRisk: 'low' },
      { description: 'Analyze ambiguity and request clarification.', stepType: 'analyze', executionRisk: 'low' },
    ],
  };
  return map[intentType] || map.unknown;
}

function computeStepEligibility(stepType) {
  return stepType === 'read' || stepType === 'analyze' || stepType === 'retrieve';
}

export function buildProposal({ requestText = '', intent = {}, context = {} } = {}) {
  const intentType = intent.intentType || 'unknown';
  const seed = `${intentType}:${String(requestText || '').trim().toLowerCase()}`;
  const baseSteps = stepsForIntent(intentType);

  const steps = baseSteps.map((step, index) => ({
    stepId: stableId('step', [seed, index, step.description, step.stepType]),
    description: step.description,
    stepType: step.stepType,
    target: context.target || null,
    dependencies: index > 0 ? [baseSteps[index - 1]?.description].filter(Boolean) : [],
    executionEligible: computeStepEligibility(step.stepType),
    executionRisk: step.executionRisk,
  }));

  const executionEligible = steps.length > 0 && steps.every((step) => step.executionEligible);
  const proposalStatus = intentType === 'unknown' ? 'blocked' : 'ready';
  const proposalReason = intentType === 'unknown'
    ? 'Intent classification uncertain. Clarification required before execution.'
    : `Proposal created from detected intent '${intentType}'.`;

  return {
    proposalId: stableId('proposal', [seed]),
    intentType,
    proposalCreated: true,
    proposalStatus,
    proposalReason,
    steps,
    executionEligible,
  };
}
