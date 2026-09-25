import { createHash } from 'node:crypto';

import { buildStephanosSharedConversationThread } from './stephanosSharedConversationThreadV1.mjs';
import {
  UI_AGENT_CONVERSATION_CANVAS_PRESENTER_SCHEMA_VERSION,
  UI_AGENT_CONVERSATION_CANVAS_SURFACE_PROFILES,
} from './uiAgentConversationCanvasPresenterV1.mjs';

export const STEPHANOS_SHARED_THREAD_CANVAS_PROJECTION_SCHEMA_VERSION =
  'stephanos.shared-thread-canvas-projection.v1';
export const STEPHANOS_PRIMARY_SHARED_CONVERSATION_THREAD_ID = 'shared-operator-primary';

const ALLOWED_SURFACES = new Set(Object.keys(UI_AGENT_CONVERSATION_CANVAS_SURFACE_PROFILES));

function text(value, limit = 24000) {
  const out = typeof value === 'string' ? value.trim() : '';
  return out && out.length <= limit ? out : '';
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function authorityBoundary() {
  return Object.freeze({
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
  });
}

function blocked(errors = []) {
  return Object.freeze({
    schemaVersion: STEPHANOS_SHARED_THREAD_CANVAS_PROJECTION_SCHEMA_VERSION,
    valid: false,
    classification: 'SHARED_THREAD_CANVAS_PROJECTION_BLOCKED',
    conversationCanvasView: null,
    errors: Object.freeze([...new Set(errors)]),
    authority: authorityBoundary(),
  });
}

function transcriptItems(thread) {
  return Object.freeze(thread.transcript.map((turn) => Object.freeze({
    contributorId: turn.senderParticipantId,
    contributionType: 'CONVERSATION_TURN',
    summary: turn.text,
    evidenceRefs: Object.freeze(Array.isArray(turn.proofRefs) ? [...turn.proofRefs] : []),
    turnId: turn.turnId,
    replyToTurnId: turn.replyToTurnId,
    timestampUtc: turn.timestampUtc,
  })));
}

export function buildStephanosSharedThreadConversationCanvasV1(input = {}, options = {}) {
  try {
    const surface = text(input.surface, 64) || 'desktop-browser';
    if (!ALLOWED_SURFACES.has(surface)) return blocked(['unsupported-surface']);

    const nowMs = Number.isFinite(options.nowMs) ? options.nowMs : Date.now();
    const threadProjection = buildStephanosSharedConversationThread(input.turnRecords, {
      threadId: text(input.threadId, 128),
      workspaceValidationOptions: {
        nowMs,
        ...(Number.isFinite(options.staleAfterMs) ? { staleAfterMs: options.staleAfterMs } : {}),
      },
    });
    if (!threadProjection?.valid || !threadProjection.thread) {
      return blocked([
        'shared-thread-rejected',
        ...(Array.isArray(threadProjection?.errors) ? threadProjection.errors : []),
      ]);
    }

    const thread = threadProjection.thread;
    const latest = thread.transcript.at(-1);
    const items = transcriptItems(thread);
    const reducedMotion = input.prefersReducedMotion === true;
    const section = Object.freeze({
      id: 'shared-thread',
      title: 'Shared Stephan + ChatGPT + Stephanos conversation',
      kind: 'PROVIDER_AGENT_CONTRIBUTION',
      summary: `${thread.turnCount} durable turn${thread.turnCount === 1 ? '' : 's'} across the canonical shared thread.`,
      itemCount: items.length,
      expanded: true,
      items,
      priority: 'PRIMARY',
      ariaLabel: `Shared conversation. ${thread.turnCount} turns. Expanded.`,
    });
    const layoutProfile = UI_AGENT_CONVERSATION_CANVAS_SURFACE_PROFILES[surface];
    const continuity = Object.freeze({
      roundId: thread.threadId,
      questionId: latest?.turnId || thread.threadId,
      responseId: latest?.turnId || thread.threadId,
    });
    const core = Object.freeze({
      schemaVersion: UI_AGENT_CONVERSATION_CANVAS_PRESENTER_SCHEMA_VERSION,
      valid: true,
      state: 'READY',
      surface,
      layoutProfile,
      stateBanner: Object.freeze({
        state: 'READY',
        label: 'Shared conversation continuity is ready.',
        detail: text(input.statusMessage, 1000),
        colorOnlyStatusAllowed: false,
      }),
      summary: Object.freeze({
        kind: 'DIRECT_ANSWER',
        text: latest?.text || 'Shared conversation ready.',
        continuity,
        visibleByDefault: true,
        ariaLabel: 'Latest shared conversation turn',
      }),
      sections: Object.freeze([section]),
      sectionNavigation: Object.freeze([
        Object.freeze({ sectionId: 'shared-thread', label: section.title, priority: 'PRIMARY' }),
      ]),
      experienceModes: Object.freeze([]),
      progressiveDisclosure: Object.freeze({
        summaryAlwaysVisible: true,
        evidenceCollapsedByDefault: false,
        rawAgentTranscriptDefaultVisible: true,
        phoneUsesSingleColumn: surface === 'iphone',
        ipadTouchFirst: surface === 'ipad',
      }),
      accessibility: Object.freeze({
        reducedMotion,
        animationAllowed: !reducedMotion,
        colorOnlyStatusAllowed: false,
        evidenceKeyboardReachable: true,
        touchTargetsLarge: layoutProfile.touchTarget === 'LARGE',
      }),
      authority: authorityBoundary(),
    });

    const conversationCanvasView = Object.freeze({
      ...core,
      viewId: `conversation-canvas-view-${digest(core).slice(0, 24)}`,
      errors: Object.freeze([]),
    });

    return Object.freeze({
      schemaVersion: STEPHANOS_SHARED_THREAD_CANVAS_PROJECTION_SCHEMA_VERSION,
      valid: true,
      classification: 'SHARED_THREAD_CANVAS_PROJECTION_READY',
      thread,
      conversationCanvasView,
      errors: Object.freeze([]),
      authority: authorityBoundary(),
    });
  } catch {
    return blocked(['shared-thread-canvas-projection-failed-closed']);
  }
}
