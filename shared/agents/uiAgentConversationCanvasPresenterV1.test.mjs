import test from 'node:test';
import assert from 'node:assert/strict';

import {
  UI_AGENT_CONVERSATION_CANVAS_PRESENTER_SCHEMA_VERSION,
  UI_AGENT_CONVERSATION_CANVAS_SURFACE_PROFILES,
  buildUiAgentConversationCanvasPresenterV1,
} from './uiAgentConversationCanvasPresenterV1.mjs';

function canvasContract(overrides = {}) {
  return {
    schemaVersion: 'stephanos.ui-agent.conversation-canvas-contract.v1',
    valid: true,
    state: 'CONVERSATION_CANVAS_CONTRACT_READY_FOR_BOUNDED_IMPLEMENTATION',
    contractId: 'conversation-canvas-test',
    ...overrides,
  };
}

function richResponse(overrides = {}) {
  return {
    schemaVersion: 'stephanos.rich-conversational-response.v1',
    valid: true,
    responseId: 'rich-response-test',
    directAnswer: 'Stephanos should preserve the existing qualified route, expose the evidence boundary, and avoid duplicate machinery.',
    epistemicClaims: [{
      claimId: 'claim-test',
      text: 'The existing route is the canonical owner.',
      epistemicState: 'INFERRED_FROM_EVIDENCE',
      evidenceRefs: ['evidence/receipt/current-owner'],
    }],
    evidenceRefs: ['evidence/receipt/current-owner'],
    goalsMissions: [{ ref: '#1776', label: 'Stephanos Product Build', state: 'ACTIVE', evidenceRefs: ['evidence/receipt/current-owner'] }],
    agentProviderContributions: [{ contributorId: 'openclaw-local', contributionType: 'RESEARCH_EVIDENCE', summary: 'Returned bounded local evidence.', evidenceRefs: ['evidence/research/local'] }],
    unknowns: ['Physical device acceptance is not yet proven.'],
    options: [{ optionId: 'option:preserve', label: 'Preserve the existing lane', tradeoff: 'Avoids duplicate machinery.', evidenceRefs: ['evidence/receipt/current-owner'] }],
    recommendedAction: { state: 'AVAILABLE', actionId: 'improve:conversation-canvas', label: 'Advance the existing Conversation Canvas lane', rationale: 'The contract is already canonical.', requiresApproval: 'NO', evidenceRefs: ['evidence/receipt/current-owner'] },
    approvalState: { state: 'NOT_REQUIRED', approvalRef: '', evidenceRefs: ['evidence/receipt/current-owner'] },
    visualisationCandidates: ['SYSTEM_MAP', 'RESEARCH_EXPEDITION', 'IMPROVE_STEPHANOS'],
    continuity: { roundId: 'stephanos-round-001', questionId: 'stephanos-round-001-q01' },
    ...overrides,
  };
}

test('desktop READY presenter produces a deterministic summary-first Conversation Canvas view model', () => {
  const result = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse(),
    surface: 'desktop-browser',
    state: 'READY',
  });

  assert.equal(result.valid, true, result.errors.join(','));
  assert.equal(result.schemaVersion, UI_AGENT_CONVERSATION_CANVAS_PRESENTER_SCHEMA_VERSION);
  assert.match(result.viewId, /^conversation-canvas-view-[0-9a-f]{24}$/);
  assert.equal(result.surface, 'desktop-browser');
  assert.deepEqual(result.layoutProfile, UI_AGENT_CONVERSATION_CANVAS_SURFACE_PROFILES['desktop-browser']);
  assert.equal(result.summary.visibleByDefault, true);
  assert.match(result.summary.text, /preserve the existing qualified route/i);
  assert.deepEqual(result.summary.continuity, {
    roundId: 'stephanos-round-001',
    questionId: 'stephanos-round-001-q01',
    responseId: 'rich-response-test',
  });
  assert.deepEqual(result.sections.map((section) => section.id), ['evidence', 'goals', 'contributors', 'unknowns', 'options', 'action', 'visuals']);
  assert.equal(result.sectionNavigation.length, 7);
});

test('progressive disclosure keeps sections visually collapsed while retaining bounded details for disclosure', () => {
  const collapsed = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse(),
    surface: 'desktop-browser',
  });
  const evidenceCollapsed = collapsed.sections.find((section) => section.id === 'evidence');
  const actionCollapsed = collapsed.sections.find((section) => section.id === 'action');
  assert.equal(evidenceCollapsed.expanded, false);
  assert.equal(evidenceCollapsed.itemCount, 2);
  assert.equal(evidenceCollapsed.items.length, 2);
  assert.equal(actionCollapsed.expanded, false);
  assert.equal(actionCollapsed.items.length, 2);
  assert.equal(collapsed.progressiveDisclosure.evidenceCollapsedByDefault, true);
  assert.equal(collapsed.accessibility.evidenceKeyboardReachable, true);

  const expanded = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse(),
    surface: 'desktop-browser',
    expandedSections: ['evidence', 'action'],
  });
  const evidenceExpanded = expanded.sections.find((section) => section.id === 'evidence');
  const actionExpanded = expanded.sections.find((section) => section.id === 'action');
  assert.equal(evidenceExpanded.expanded, true);
  assert.deepEqual(evidenceExpanded.items, evidenceCollapsed.items);
  assert.equal(actionExpanded.expanded, true);
  assert.deepEqual(actionExpanded.items, actionCollapsed.items);
  assert.equal(expanded.progressiveDisclosure.evidenceCollapsedByDefault, false);
});

test('iPad and phone profiles preserve touch-first and compact single-column behavior with reduced motion', () => {
  const ipad = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse(),
    surface: 'ipad',
    prefersReducedMotion: true,
  });
  assert.equal(ipad.valid, true);
  assert.equal(ipad.layoutProfile.layout, 'TOUCH_STACK_WITH_DETAIL_DRAWER');
  assert.equal(ipad.progressiveDisclosure.ipadTouchFirst, true);
  assert.equal(ipad.accessibility.touchTargetsLarge, true);
  assert.equal(ipad.accessibility.reducedMotion, true);
  assert.equal(ipad.accessibility.animationAllowed, false);
  assert.equal(ipad.accessibility.colorOnlyStatusAllowed, false);

  const phone = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse(),
    surface: 'iphone',
  });
  assert.equal(phone.valid, true);
  assert.equal(phone.layoutProfile.layout, 'SINGLE_COLUMN_PROGRESSIVE');
  assert.equal(phone.progressiveDisclosure.phoneUsesSingleColumn, true);
  assert.equal(phone.accessibility.touchTargetsLarge, true);
});

test('research and improvement semantics become dedicated inert experience modes rather than raw agent transcripts', () => {
  const result = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse(),
    surface: 'desktop-browser',
  });
  const modes = new Map(result.experienceModes.map((entry) => [entry.mode, entry]));
  assert.equal(modes.has('RESEARCH_EXPEDITION'), true);
  assert.equal(modes.get('RESEARCH_EXPEDITION').rawAgentTranscriptDefaultVisible, false);
  assert.equal(modes.get('RESEARCH_EXPEDITION').executable, false);
  assert.equal(modes.has('IMPROVE_STEPHANOS'), true);
  assert.equal(modes.get('IMPROVE_STEPHANOS').constructionExecutionOwnedHere, false);
  assert.equal(modes.get('IMPROVE_STEPHANOS').executable, false);
  assert.equal(modes.has('SYSTEMS_EXPERT_MAP'), true);
  assert.equal(result.progressiveDisclosure.rawAgentTranscriptDefaultVisible, false);
});

test('recommended actions and approval cards remain presentation-only and cannot widen authority', () => {
  const result = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse(),
    surface: 'desktop-browser',
    expandedSections: ['action'],
  });
  const action = result.sections.find((section) => section.id === 'action');
  assert.equal(action.items[0].executable, false);
  assert.equal(action.items[0].requiresApproval, 'NO');
  assert.equal(action.items[1].interactiveApprovalAllowed, false);
  for (const [key, value] of Object.entries(result.authority)) {
    if (key === 'presenterMayHideEvidence') assert.equal(value, false);
    else assert.equal(value, false, key);
  }
});

test('LOADING ERROR and OFFLINE states render explicit truth without requiring a fabricated answer', () => {
  for (const state of ['LOADING', 'ERROR', 'OFFLINE']) {
    const result = buildUiAgentConversationCanvasPresenterV1({
      canvasContract: canvasContract(),
      surface: 'iphone',
      state,
      statusMessage: state === 'ERROR' ? 'Evidence reconciliation failed safely.' : '',
    });
    assert.equal(result.valid, true, `${state}: ${result.errors.join(',')}`);
    assert.equal(result.state, state);
    assert.equal(result.summary.text, '');
    assert.deepEqual(result.sections, []);
    assert.equal(result.stateBanner.colorOnlyStatusAllowed, false);
  }
});

test('READY and PARTIAL states require a valid rich response with continuity and direct answer', () => {
  const missing = buildUiAgentConversationCanvasPresenterV1({ canvasContract: canvasContract(), surface: 'desktop-browser', state: 'READY' });
  assert.equal(missing.valid, false);
  assert.deepEqual(missing.errors, ['valid-rich-response-required']);

  const wrongSchema = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse({ schemaVersion: 'other' }),
    surface: 'desktop-browser',
  });
  assert.equal(wrongSchema.valid, false);
  assert.deepEqual(wrongSchema.errors, ['valid-rich-response-required']);

  const noContinuity = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse({ continuity: {} }),
    surface: 'desktop-browser',
  });
  assert.equal(noContinuity.valid, false);
  assert.deepEqual(noContinuity.errors, ['continuity-required']);
});

test('unsupported surfaces and unready contracts fail closed', () => {
  const badSurface = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: richResponse(),
    surface: 'quest3-spatial',
  });
  assert.equal(badSurface.valid, false);
  assert.deepEqual(badSurface.errors, ['unsupported-surface']);

  const badContract = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract({ state: 'SAFE_HOLD' }),
    richResponse: richResponse(),
    surface: 'desktop-browser',
  });
  assert.equal(badContract.valid, false);
  assert.deepEqual(badContract.errors, ['canvas-contract-not-ready']);
});

test('presented view is detached from later caller mutation', () => {
  const response = richResponse();
  const result = buildUiAgentConversationCanvasPresenterV1({
    canvasContract: canvasContract(),
    richResponse: response,
    surface: 'desktop-browser',
    expandedSections: ['goals', 'unknowns'],
  });
  response.directAnswer = 'mutated';
  response.goalsMissions[0].label = 'mutated';
  response.unknowns.push('mutated');
  assert.match(result.summary.text, /existing qualified route/i);
  assert.equal(result.sections.find((section) => section.id === 'goals').items[0].label, 'Stephanos Product Build');
  assert.equal(result.sections.find((section) => section.id === 'unknowns').itemCount, 1);
});
