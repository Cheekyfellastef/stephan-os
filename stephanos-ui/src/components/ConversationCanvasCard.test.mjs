import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { importBundledModule, srcRoot } from '../test/renderHarness.mjs';

const ZERO_AUTHORITY_KEYS = [
  'sourceMutationAllowed',
  'commandExecutionAllowed',
  'approvalAuthorityAdded',
  'mergeAllowed',
  'deploymentAllowed',
  'runtimeMutationAllowed',
  'providerSelectionAuthorityAdded',
  'privateUiTruthAllowed',
  'presenterMayExecuteActions',
  'presenterMayHideEvidence',
];

function canvasView(overrides = {}) {
  return {
    schemaVersion: 'stephanos.ui-agent.conversation-canvas-presenter.v1',
    valid: true,
    state: 'READY',
    surface: 'desktop-browser',
    layoutProfile: {
      layout: 'TWO_COLUMN_WITH_DETAIL_RAIL',
      density: 'COMPACT',
      touchTarget: 'STANDARD',
      sectionNavigation: 'STICKY',
    },
    stateBanner: {
      state: 'READY',
      label: 'Answer and available evidence are ready.',
      detail: '',
      colorOnlyStatusAllowed: false,
    },
    summary: {
      kind: 'DIRECT_ANSWER',
      text: 'Stephanos should preserve the existing qualified route and keep the evidence boundary visible.',
      continuity: {
        roundId: 'stephanos-round-001',
        questionId: 'stephanos-round-001-q01',
        responseId: 'rich-response-test',
      },
      visibleByDefault: true,
    },
    sections: [
      {
        id: 'evidence',
        title: 'Evidence and confidence',
        kind: 'EVIDENCE_DISCLOSURE',
        summary: 'One observed claim and one evidence reference.',
        itemCount: 2,
        expanded: true,
        ariaLabel: 'Evidence and confidence. 2 items. Expanded.',
        items: [
          {
            claimId: 'claim-test',
            text: 'The current owner is evidence-bound.',
            epistemicState: 'OBSERVED_FROM_RUNTIME_OR_PROOF',
            evidenceRefs: ['proof/current-owner'],
          },
          { evidenceRef: 'proof/current-owner' },
        ],
      },
      {
        id: 'action',
        title: 'Recommended action and approval',
        kind: 'RECOMMENDED_ACTION',
        summary: 'Advance the existing lane.',
        itemCount: 2,
        expanded: true,
        ariaLabel: 'Recommended action and approval. 2 items. Expanded.',
        items: [
          {
            state: 'AVAILABLE',
            actionId: 'improve:conversation-canvas',
            label: 'Advance the existing Conversation Canvas lane',
            rationale: 'The lane is already canonical.',
            requiresApproval: 'NO',
            evidenceRefs: ['proof/current-owner'],
            executable: false,
          },
          {
            state: 'NOT_REQUIRED',
            approvalRef: '',
            evidenceRefs: ['proof/current-owner'],
            interactiveApprovalAllowed: false,
          },
        ],
      },
    ],
    experienceModes: [
      { mode: 'RESEARCH_EXPEDITION', executable: false },
      { mode: 'IMPROVE_STEPHANOS', executable: false, constructionExecutionOwnedHere: false },
      { mode: 'SYSTEMS_EXPERT_MAP', executable: false },
    ],
    accessibility: {
      reducedMotion: false,
      colorOnlyStatusAllowed: false,
      evidenceKeyboardReachable: true,
      touchTargetsLarge: false,
      animationAllowed: true,
    },
    authority: {
      sourceMutationAllowed: false,
      commandExecutionAllowed: false,
      approvalAuthorityAdded: false,
      mergeAllowed: false,
      deploymentAllowed: false,
      runtimeMutationAllowed: false,
      providerSelectionAuthorityAdded: false,
      privateUiTruthAllowed: false,
      presenterMayExecuteActions: false,
      presenterMayHideEvidence: false,
    },
    ...overrides,
  };
}

async function renderer(label) {
  return importBundledModule(
    path.join(srcRoot, 'test/renderConversationCanvasCardEntry.jsx'),
    {},
    label,
  );
}

test('served Conversation Canvas renders summary-first answer, continuity, evidence and dedicated experience modes', async () => {
  const { renderConversationCanvasCard } = await renderer('conversation-canvas-ready');
  const rendered = renderConversationCanvasCard(canvasView());

  assert.match(rendered, /data-testid="conversation-canvas-card"/);
  assert.match(rendered, /data-canvas-surface="desktop-browser"/);
  assert.match(rendered, /data-canvas-layout="TWO_COLUMN_WITH_DETAIL_RAIL"/);
  assert.match(rendered, /Stephanos · READY/);
  assert.match(rendered, /preserve the existing qualified route/);
  assert.match(rendered, /stephanos-round-001/);
  assert.match(rendered, /Evidence and confidence/);
  assert.match(rendered, /OBSERVED_FROM_RUNTIME_OR_PROOF/);
  assert.match(rendered, /proof\/current-owner/);
  assert.match(rendered, /Research Expedition/);
  assert.match(rendered, /Improve Stephanos/);
  assert.match(rendered, /Systems Expert Map/);
});

test('collapsed served details retain evidence for keyboard disclosure without opening by default', async () => {
  const { renderConversationCanvasCard } = await renderer('conversation-canvas-collapsed-evidence');
  const evidence = canvasView().sections[0];
  const rendered = renderConversationCanvasCard(canvasView({
    sections: [{ ...evidence, expanded: false, ariaLabel: 'Evidence and confidence. 2 items. Collapsed.' }],
  }));

  assert.match(rendered, /data-canvas-section="evidence"/);
  assert.doesNotMatch(rendered, /<details open=/);
  assert.match(rendered, /The current owner is evidence-bound/);
  assert.match(rendered, /proof\/current-owner/);
});

test('recommended action and approval remain visibly inert in the served Canvas', async () => {
  const { renderConversationCanvasCard } = await renderer('conversation-canvas-inert');
  const rendered = renderConversationCanvasCard(canvasView());

  assert.match(rendered, /data-action-executable="false"/);
  assert.match(rendered, /data-approval-interactive="false"/);
  assert.match(rendered, /data-action-authority="none"/);
  assert.match(rendered, /Presentation only/);
  assert.doesNotMatch(rendered, /<button/);
});

test('iPad and iPhone Canvas projections retain touch/single-column surface truth without adding motion', async () => {
  const { renderConversationCanvasCard } = await renderer('conversation-canvas-touch');
  const touchAccessibility = {
    reducedMotion: true,
    colorOnlyStatusAllowed: false,
    evidenceKeyboardReachable: true,
    touchTargetsLarge: true,
    animationAllowed: false,
  };

  const ipad = renderConversationCanvasCard(canvasView({
    surface: 'ipad',
    layoutProfile: { layout: 'TOUCH_STACK_WITH_DETAIL_DRAWER' },
    accessibility: touchAccessibility,
  }));
  assert.match(ipad, /data-canvas-surface="ipad"/);
  assert.match(ipad, /data-canvas-layout="TOUCH_STACK_WITH_DETAIL_DRAWER"/);
  assert.match(ipad, /data-reduced-motion="true"/);
  assert.match(ipad, /min-height:44px/);

  const phone = renderConversationCanvasCard(canvasView({
    surface: 'iphone',
    layoutProfile: { layout: 'SINGLE_COLUMN_PROGRESSIVE' },
    accessibility: touchAccessibility,
  }));
  assert.match(phone, /data-canvas-surface="iphone"/);
  assert.match(phone, /data-canvas-layout="SINGLE_COLUMN_PROGRESSIVE"/);
  assert.match(phone, /grid-template-columns:minmax\(0, 1fr\)/);
});

test('every authority widening and mismatched accessibility/layout contract fails closed', async () => {
  const { renderConversationCanvasCard } = await renderer('conversation-canvas-fail-closed');

  assert.equal(renderConversationCanvasCard(canvasView({ valid: false })), '');
  assert.equal(renderConversationCanvasCard(canvasView({ surface: 'quest3-spatial' })), '');
  assert.equal(renderConversationCanvasCard(canvasView({ layoutProfile: { layout: 'SINGLE_COLUMN_PROGRESSIVE' } })), '');
  assert.equal(renderConversationCanvasCard(canvasView({ stateBanner: { ...canvasView().stateBanner, colorOnlyStatusAllowed: true } })), '');
  assert.equal(renderConversationCanvasCard(canvasView({ accessibility: { ...canvasView().accessibility, evidenceKeyboardReachable: false } })), '');

  for (const key of ZERO_AUTHORITY_KEYS) {
    assert.equal(
      renderConversationCanvasCard(canvasView({ authority: { ...canvasView().authority, [key]: true } })),
      '',
      key,
    );
  }

  assert.equal(renderConversationCanvasCard(canvasView({ experienceModes: [{ mode: 'SYSTEMS_EXPERT_MAP', executable: true }] })), '');
  assert.equal(renderConversationCanvasCard(canvasView({ sections: [{ kind: 'RECOMMENDED_ACTION', items: [{ executable: true }] }] })), '');
  assert.equal(renderConversationCanvasCard({ schemaVersion: 'unknown', valid: true }), '');
});
