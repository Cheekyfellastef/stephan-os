import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STEPHANOS_GOVERNED_IMPROVEMENT_PROPOSAL_SCHEMA_VERSION,
  planStephanosGovernedImprovementProposalV1,
} from './stephanosGovernedImprovementProposalV1.mjs';

const HEAD = 'a'.repeat(40);

function packet(overrides = {}) {
  const input = {
    gap: {
      gapId: 'gap-ui-chat-friction',
      gapSource: 'OPERATOR_REPORTED_GAP',
      gapSummary: 'Conversation evidence is too difficult to inspect.',
      operatorOutcome: 'Make the Stephanos conversation easier to understand.',
      evidenceRefs: ['evidence/ui-audit-1'],
    },
    architecture: {
      snapshotId: 'architecture-1',
      repository: 'Cheekyfellastef/stephan-os',
      sourceHead: HEAD,
      existingOwner: {
        goalRef: '#1722',
        componentRefs: ['stephanos-ui', 'conversation-canvas'],
      },
      activeWriter: null,
    },
    diagnosis: {
      rootCauseState: 'KNOWN',
      rootCauseSummary: 'Evidence presentation lacks progressive disclosure.',
      researchRoute: 'NO_RESEARCH_NEEDED_KNOWN_REPAIR',
      researchRefs: [],
    },
    proposal: {
      proposalId: 'proposal-ui-chat-friction',
      changeClass: 'BOUNDED_SOURCE_CHANGE',
      summary: 'Add an expandable evidence rail to the existing conversation canvas.',
      whyThisChange: 'It fixes the proven friction without creating a second chat surface.',
      alternatives: ['Leave evidence as raw text', 'Open a separate diagnostics page'],
      expectedBenefit: 'Faster evidence inspection with less navigation.',
      blastRadius: 'Conversation presentation components only.',
      reversibility: 'Source-only component change can be reverted by exact commit.',
      resourceScopes: ['ui:conversation-canvas'],
      requiredReview: ['review:ui-independent'],
      requiredProof: ['proof:desktop', 'proof:ipad', 'proof:reduced-motion'],
      rollbackPlan: 'Revert the bounded conversation component commit.',
      attemptsAuthorityWidening: false,
    },
  };
  return {
    ...input,
    ...overrides,
    gap: { ...input.gap, ...(overrides.gap || {}) },
    architecture: { ...input.architecture, ...(overrides.architecture || {}) },
    diagnosis: { ...input.diagnosis, ...(overrides.diagnosis || {}) },
    proposal: { ...input.proposal, ...(overrides.proposal || {}) },
  };
}

test('operator-reported gap maps to existing owner and produces inert bounded proposal', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet());
  assert.equal(result.schemaVersion, STEPHANOS_GOVERNED_IMPROVEMENT_PROPOSAL_SCHEMA_VERSION);
  assert.equal(result.status, 'IMPROVEMENT_PROPOSAL_READY_EXISTING_OWNER');
  assert.equal(result.currentOwnerGoal, '#1722');
  assert.equal(result.authorityRequired, 'SOURCE_IMPLEMENTATION_AUTHORIZATION_REQUIRED');
  assert.equal(result.proposalReady, true);
  assert.equal(result.implementationAllowed, false);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.mergeAllowed, false);
});

test('Stephanos-detected gaps use the same canonical proposal path', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    gap: {
      gapSource: 'STEPHANOS_CONVERSATIONAL_GAP',
      gapId: 'gap-stepanos-answer-evidence',
    },
  }));
  assert.equal(result.status, 'IMPROVEMENT_PROPOSAL_READY_EXISTING_OWNER');
  assert.equal(result.gapSource, 'STEPHANOS_CONVERSATIONAL_GAP');
  assert.equal(result.currentOwnerGoal, '#1722');
});

test('unknown root cause routes to #1902 research instead of guessing a change', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    diagnosis: {
      rootCauseState: 'UNKNOWN',
      rootCauseSummary: '',
      researchRoute: 'MULTI_AGENT_RESEARCH_COUNCIL',
      researchRefs: [],
    },
  }));
  assert.equal(result.status, 'RESEARCH_REQUIRED');
  assert.match(result.nextAction, /1902/);
  assert.equal(result.proposalReady, false);
});

test('research-led evidence can produce a bounded proposal but never grants implementation authority', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    gap: {
      gapId: 'gap-research-led-conversation-evidence',
      gapSource: 'STEPHANOS_RESEARCH_DISCOVERY',
      evidenceRefs: ['evidence/research-expedition-1902'],
    },
    diagnosis: {
      rootCauseState: 'KNOWN',
      rootCauseSummary: 'Bounded research found that evidence hierarchy is the smallest useful change.',
      researchRoute: 'SPECIALIST_RESEARCH',
      researchRefs: ['research/1902/evidence-hierarchy'],
    },
  }));
  assert.equal(result.status, 'IMPROVEMENT_PROPOSAL_READY_EXISTING_OWNER');
  assert.equal(result.gapSource, 'STEPHANOS_RESEARCH_DISCOVERY');
  assert.equal(result.currentOwnerGoal, '#1722');
  assert.equal(result.authorityRequired, 'SOURCE_IMPLEMENTATION_AUTHORIZATION_REQUIRED');
  assert.equal(result.proposalReady, true);
  assert.equal(result.implementationAllowed, false);
  assert.equal(result.dispatchAllowed, false);
  assert.equal(result.mergeAllowed, false);
});

test('overlapping active writer blocks duplicate implementation ownership', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    architecture: {
      activeWriter: {
        writerId: 'writer-existing-ui',
        resourceScopes: ['ui:conversation-canvas'],
      },
    },
  }));
  assert.equal(result.status, 'EXISTING_IMPLEMENTATION_OWNER_ACTIVE');
  assert.match(result.blocker, /writer-existing-ui/);
  assert.equal(result.dispatchAllowed, false);
});

test('unowned gap recommends one bounded new-goal scope but cannot create it', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    architecture: { existingOwner: null },
  }));
  assert.equal(result.status, 'NEW_GOAL_SCOPE_AUTHORIZATION_REQUIRED');
  assert.equal(result.authorityRequired, 'NEW_GOAL_SCOPE_AUTHORIZATION_REQUIRED');
  assert.equal(result.goalCreationAllowed, false);
  assert.equal(result.recommendation.proposalId, 'proposal-ui-chat-friction');
});

test('runtime and account changes preserve distinct explicit authority requirements', () => {
  const cases = [
    ['WINDOWS_RUNTIME_MUTATION', 'WINDOWS_RUNTIME_MUTATION_AUTHORIZATION_REQUIRED'],
    ['OPENCLAW_MUTATION', 'OPENCLAW_MUTATION_AUTHORIZATION_REQUIRED'],
    ['SPENDING_OR_EXTERNAL_ACCOUNT', 'SPENDING_OR_EXTERNAL_ACCOUNT_AUTHORIZATION_REQUIRED'],
    ['EXACT_HEAD_MERGE', 'EXACT_HEAD_MERGE_AUTHORIZATION_REQUIRED'],
  ];
  for (const [changeClass, authority] of cases) {
    const result = planStephanosGovernedImprovementProposalV1(packet({ proposal: { changeClass } }));
    assert.equal(result.authorityRequired, authority);
    assert.equal(result.implementationAllowed, false);
  }
});

test('self-authority widening cannot be admitted as ordinary self-improvement', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    proposal: {
      attemptsAuthorityWidening: true,
      changeClass: 'BOUNDED_SOURCE_CHANGE',
    },
  }));
  assert.equal(result.status, 'OPERATOR_JUDGMENT_REQUIRED');
  assert.equal(result.authorityRequired, 'HIGH_RISK_OPERATOR_JUDGMENT_REQUIRED');
  assert.equal(result.authorityWideningAllowed, false);
});

test('authority or constitution changes always require high-risk operator judgment', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    proposal: { changeClass: 'AUTHORITY_OR_CONSTITUTION_CHANGE' },
  }));
  assert.equal(result.status, 'OPERATOR_JUDGMENT_REQUIRED');
  assert.equal(result.authorityRequired, 'HIGH_RISK_OPERATOR_JUDGMENT_REQUIRED');
});

test('missing canonical evidence fails closed', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    gap: { evidenceRefs: [] },
  }));
  assert.equal(result.status, 'SAFE_HOLD');
  assert.equal(result.proposalReady, false);
});

test('unknown fields cannot smuggle execution authority', () => {
  const candidate = packet();
  candidate.executeNow = true;
  const result = planStephanosGovernedImprovementProposalV1(candidate);
  assert.equal(result.status, 'SAFE_HOLD');
  assert.equal(result.implementationAllowed, false);
});

test('accessor-bearing inputs fail closed without invoking the accessor', () => {
  let invoked = false;
  const candidate = packet();
  Object.defineProperty(candidate.proposal, 'summary', {
    enumerable: true,
    get() {
      invoked = true;
      return 'unsafe';
    },
  });
  const result = planStephanosGovernedImprovementProposalV1(candidate);
  assert.equal(result.status, 'SAFE_HOLD');
  assert.equal(invoked, false);
});

test('sparse or custom arrays fail closed', () => {
  const sparse = packet();
  sparse.gap.evidenceRefs = new Array(1);
  assert.equal(planStephanosGovernedImprovementProposalV1(sparse).status, 'SAFE_HOLD');

  const custom = packet();
  const refs = ['evidence/ui-audit-1'];
  Object.setPrototypeOf(refs, Object.create(Array.prototype));
  custom.gap.evidenceRefs = refs;
  assert.equal(planStephanosGovernedImprovementProposalV1(custom).status, 'SAFE_HOLD');
});

test('malformed or traversal-shaped repository identities fail closed', () => {
  for (const repository of [
    '../stephan-os',
    './stephan-os',
    'Cheekyfellastef/..',
    'Cheekyfellastef/.',
    'Cheekyfellastef//stephan-os',
    ' Cheekyfellastef/stephan-os ',
  ]) {
    const result = planStephanosGovernedImprovementProposalV1(packet({
      architecture: { repository },
    }));
    assert.equal(result.status, 'SAFE_HOLD', repository);
    assert.equal(result.blocker, 'gap-or-architecture-evidence-invalid', repository);
    assert.equal(result.proposalReady, false, repository);
  }
});

test('hidden own properties cannot smuggle authority data', () => {
  const hidden = packet();
  Object.defineProperty(hidden, 'executeNow', {
    enumerable: false,
    value: true,
  });
  const hiddenResult = planStephanosGovernedImprovementProposalV1(hidden);
  assert.equal(hiddenResult.status, 'SAFE_HOLD');
  assert.equal(hiddenResult.blocker, 'invalid-data-only-envelope');

  const symbol = packet();
  symbol[Symbol('executeNow')] = true;
  const symbolResult = planStephanosGovernedImprovementProposalV1(symbol);
  assert.equal(symbolResult.status, 'SAFE_HOLD');
  assert.equal(symbolResult.blocker, 'invalid-data-only-envelope');
});

test('hostile reflection failures fail closed even when arbitrary values are thrown', () => {
  const hostile = new Proxy(packet(), {
    getPrototypeOf() {
      throw null;
    },
  });
  const result = planStephanosGovernedImprovementProposalV1(hostile);
  assert.equal(result.status, 'SAFE_HOLD');
  assert.equal(result.blocker, 'invalid-data-only-envelope');
  assert.equal(result.proposalReady, false);
});

test('new-goal scope cannot request duplicate authority when a canonical owner exists', () => {
  const result = planStephanosGovernedImprovementProposalV1(packet({
    proposal: { changeClass: 'NEW_GOAL_SCOPE' },
  }));
  assert.equal(result.status, 'SAFE_HOLD');
  assert.equal(result.blocker, 'new-goal-scope-conflicts-with-existing-owner');
  assert.equal(result.nextAction, 'RECLASSIFY_CHANGE_UNDER_EXISTING_OWNER');
  assert.equal(result.authorityRequired, '');
  assert.equal(result.proposalReady, false);
  assert.equal(result.goalCreationAllowed, false);
});

test('accessor-backed array elements fail closed without invoking getters', () => {
  let invoked = false;
  const candidate = packet();
  Object.defineProperty(candidate.gap.evidenceRefs, '0', {
    configurable: true,
    enumerable: true,
    get() {
      invoked = true;
      return 'evidence/ui-audit-1';
    },
  });
  const result = planStephanosGovernedImprovementProposalV1(candidate);
  assert.equal(result.status, 'SAFE_HOLD');
  assert.equal(result.blocker, 'invalid-data-only-envelope');
  assert.equal(result.proposalReady, false);
  assert.equal(invoked, false);
});

test('authority-bearing proposals are held before unknown-root-cause research routing', () => {
  const cases = [
    { attemptsAuthorityWidening: true, changeClass: 'BOUNDED_SOURCE_CHANGE' },
    { attemptsAuthorityWidening: false, changeClass: 'AUTHORITY_OR_CONSTITUTION_CHANGE' },
  ];
  for (const proposal of cases) {
    const result = planStephanosGovernedImprovementProposalV1(packet({
      diagnosis: {
        rootCauseState: 'UNKNOWN',
        rootCauseSummary: '',
        researchRoute: 'DIRECT_BOUNDED_RESEARCH',
        researchRefs: [],
      },
      proposal,
    }));
    assert.equal(result.status, 'OPERATOR_JUDGMENT_REQUIRED');
    assert.equal(result.authorityRequired, 'HIGH_RISK_OPERATOR_JUDGMENT_REQUIRED');
    assert.equal(result.nextAction, 'PRESENT_HIGH_RISK_IMPROVEMENT_FOR_EXPLICIT_OPERATOR_JUDGMENT');
    assert.equal(result.proposalReady, false);
    assert.equal(result.dispatchAllowed, false);
    assert.equal(result.authorityWideningAllowed, false);
  }
});

test('parent and child resource scopes block duplicate writers in either direction', () => {
  const cases = [
    [['shared/agents'], ['shared/agents/foo.mjs']],
    [['shared/agents/foo.mjs'], ['shared/agents']],
  ];
  for (const [writerScopes, proposalScopes] of cases) {
    const result = planStephanosGovernedImprovementProposalV1(packet({
      architecture: {
        activeWriter: {
          writerId: 'writer-existing-agent',
          resourceScopes: writerScopes,
        },
      },
      proposal: { resourceScopes: proposalScopes },
    }));
    assert.equal(result.status, 'EXISTING_IMPLEMENTATION_OWNER_ACTIVE');
    assert.equal(result.blocker, 'resource-owned-by:writer-existing-agent');
    assert.equal(result.proposalReady, false);
    assert.equal(result.dispatchAllowed, false);
  }
});

test('trailing separators normalize before resource-scope overlap checks', () => {
  const cases = [
    [['shared/agents/'], ['shared/agents']],
    [['shared/agents'], ['shared/agents/']],
  ];
  for (const [writerScopes, proposalScopes] of cases) {
    const result = planStephanosGovernedImprovementProposalV1(packet({
      architecture: {
        activeWriter: {
          writerId: 'writer-existing-agent',
          resourceScopes: writerScopes,
        },
      },
      proposal: { resourceScopes: proposalScopes },
    }));
    assert.equal(result.status, 'EXISTING_IMPLEMENTATION_OWNER_ACTIVE');
    assert.equal(result.blocker, 'resource-owned-by:writer-existing-agent');
  }
});

test('traversal-shaped resource scopes fail closed', () => {
  const proposalResult = planStephanosGovernedImprovementProposalV1(packet({
    proposal: { resourceScopes: ['shared/agents/bar/../foo.mjs'] },
  }));
  assert.equal(proposalResult.status, 'SAFE_HOLD');
  assert.equal(proposalResult.blocker, 'improvement-proposal-incomplete');

  const writerResult = planStephanosGovernedImprovementProposalV1(packet({
    architecture: {
      activeWriter: {
        writerId: 'writer-existing-agent',
        resourceScopes: ['shared/agents/./foo.mjs'],
      },
    },
  }));
  assert.equal(writerResult.status, 'SAFE_HOLD');
  assert.equal(writerResult.blocker, 'active-writer-evidence-invalid');
});

test('unowned consequential proposals preserve their explicit authority requirement', () => {
  const cases = [
    ['EXACT_HEAD_MERGE', 'EXACT_HEAD_MERGE_AUTHORIZATION_REQUIRED'],
    ['DEPLOYMENT', 'DEPLOYMENT_AUTHORIZATION_REQUIRED'],
    ['WINDOWS_RUNTIME_MUTATION', 'WINDOWS_RUNTIME_MUTATION_AUTHORIZATION_REQUIRED'],
    ['OPENCLAW_MUTATION', 'OPENCLAW_MUTATION_AUTHORIZATION_REQUIRED'],
    ['SPENDING_OR_EXTERNAL_ACCOUNT', 'SPENDING_OR_EXTERNAL_ACCOUNT_AUTHORIZATION_REQUIRED'],
  ];
  for (const [changeClass, authorityRequired] of cases) {
    const result = planStephanosGovernedImprovementProposalV1(packet({
      architecture: { existingOwner: null },
      proposal: { changeClass },
    }));
    assert.equal(result.status, 'SAFE_HOLD');
    assert.equal(result.blocker, 'consequential-change-has-no-canonical-owner');
    assert.equal(result.authorityRequired, authorityRequired);
    assert.match(result.nextAction, new RegExp(authorityRequired));
    assert.equal(result.proposalReady, false);
    assert.equal(result.goalCreationAllowed, false);
  }
});
