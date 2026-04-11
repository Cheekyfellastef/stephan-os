import { buildOperatorGuidanceProjection } from './operatorGuidanceRendering.js';

function asText(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

const PROMPT_ALIASES = Object.freeze({
  'what is my current intent?': 'current-intent',
  'what is my current intent': 'current-intent',
  'show mission packet': 'show-mission-packet',
  'why is this blocked?': 'why-blocked',
  'why is this blocked': 'why-blocked',
  'what would stephanos build next?': 'what-build-next',
  'what would stephanos build next': 'what-build-next',
  'what should stephanos build next?': 'what-build-next',
  'what should stephanos build next': 'what-build-next',
  'what can the ai do right now?': 'what-can-ai-do',
  'what can the ai do right now': 'what-can-ai-do',
  'prepare codex handoff': 'prepare-codex-handoff',
  'mark handoff as applied': 'mark-handoff-applied',
  'mark handoff as failed': 'mark-handoff-failed',
  'mark handoff as rolled back': 'mark-handoff-rolled-back',
  'validation passed': 'confirm-validation-passed',
  'validation failed': 'confirm-validation-failed',
  'accept mission': 'accept-mission',
  'defer mission': 'defer-mission',
  'reject mission': 'reject-mission',
  'start mission': 'start-mission',
  'complete mission': 'complete-mission',
  'fail mission': 'fail-mission',
  'rollback mission': 'rollback-mission',
  'resume mission': 'resume-mission',
});

function summarizeAvailableCommands(guidance) {
  const commands = Array.isArray(guidance?.availableNow)
    ? guidance.availableNow.map((entry) => asText(entry?.command)).filter(Boolean)
    : [];
  return commands.length > 0 ? commands.join(', ') : 'none';
}

function summarizePrimaryBlocker(guidance) {
  const primary = Array.isArray(guidance?.blockedBecause) ? guidance.blockedBecause[0] : null;
  if (!primary) return 'none';
  const command = asText(primary.command, 'unknown-command');
  const reason = asText(primary.reason, 'blocked-by-truth');
  return `${command}: ${reason}`;
}

function formatEnvelopeSummary(guidance = {}, envelope = null) {
  const projectionEnvelope = guidance?.envelopeProjection || null;
  const source = projectionEnvelope || envelope;
  if (!source || typeof source !== 'object') {
    return 'No operator command outcome envelope is available yet.';
  }

  const action = asText(source.actionRequested, 'n/a');
  const allowed = source.actionAllowed === true ? 'yes' : 'no';
  const applied = source.actionApplied === true ? 'yes' : 'no';
  const lifecycle = asText(source.lifecycleState || source.resultingLifecycleState, asText(guidance?.missionLifecycleSummary?.missionPhase, 'unknown'));
  const buildState = asText(source.buildAssistanceState || source.resultingBuildAssistanceState, asText(guidance?.buildAssistanceSummary?.state, 'unavailable'));
  const blocked = asText(source.blockageReason, asText(guidance?.missionLifecycleSummary?.blockageReason, 'none'));
  const next = asText(source.nextRecommendedAction, asText(guidance?.nextStepSummary, 'Await explicit operator guidance.'));
  const warnings = Array.isArray(source.truthWarnings) && source.truthWarnings.length > 0
    ? source.truthWarnings.slice(0, 2).join(' | ')
    : 'none';
  const approvalRequired = source.approvalRequired === true || guidance?.approvalSummary?.requiredNow === true;

  return `Action ${action} (allowed=${allowed}, applied=${applied}) · lifecycle=${lifecycle} · build=${buildState} · blocked=${blocked} · next=${next} · approval=${approvalRequired ? 'required' : 'not-required'} · warnings=${warnings}`;
}

export function resolveOperatorReplyPromptKey(promptText = '') {
  const normalized = asText(promptText).toLowerCase();
  return PROMPT_ALIASES[normalized] || 'unsupported';
}

export function buildOperatorReplyPayload({
  promptText = '',
  promptKey = '',
  finalRouteTruth = null,
  orchestrationTruth = null,
  latestResponseEnvelope = null,
  fallbackMissionSummary = '',
} = {}) {
  const resolvedPromptKey = promptKey || resolveOperatorReplyPromptKey(promptText);
  const guidance = buildOperatorGuidanceProjection({
    finalRouteTruth,
    orchestrationTruth,
    latestResponseEnvelope,
  });

  const mission = guidance.missionLifecycleSummary || {};
  const caution = guidance.operatorCautionSummary || {};

  const responseByPrompt = {
    'current-intent': `Current intent: ${asText(mission.missionTitle, 'not yet established')} (${asText(mission.missionPhase, 'unknown')}). Source: ${caution.inferredIntent ? 'inferred' : 'explicit-or-recorded'}.`,
    'show-mission-packet': `Mission packet: ${asText(mission.missionTitle, 'not yet established')} | phase=${asText(mission.missionPhase, 'unknown')} | lifecycle=${asText(mission.lifecycleState, 'unknown')} | blocked=${mission.blocked === true ? 'yes' : 'no'} | next=${asText(guidance.nextStepSummary, 'Await explicit operator guidance.')}`,
    'why-blocked': mission.blocked
      ? `Blocked: ${asText(mission.blockageReason, 'blockage reason unavailable.')} | next=${asText(guidance.nextStepSummary, 'Await explicit operator guidance.')} | primary=${summarizePrimaryBlocker(guidance)}`
      : `Not blocked now. Primary blocked command: ${summarizePrimaryBlocker(guidance)} | next=${asText(guidance.nextStepSummary, 'Await explicit operator guidance.')}`,
    'what-build-next': asText(guidance.nextStepSummary, asText(fallbackMissionSummary, 'No accepted mission packet exists yet.')),
    'what-can-ai-do': `Available now: ${summarizeAvailableCommands(guidance)} | build=${asText(guidance?.buildAssistanceSummary?.state, 'unavailable')} | approval=${guidance?.approvalSummary?.requiredNow ? 'required' : 'not-required'} | codex=${asText(guidance?.codexReadinessSummary?.state, 'unavailable')} | next=${asText(guidance.nextStepSummary, 'Await explicit operator guidance.')}`,
    'prepare-codex-handoff': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'accept-mission': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'defer-mission': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'reject-mission': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'start-mission': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'complete-mission': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'fail-mission': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'rollback-mission': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'resume-mission': guidance?.resumabilitySummary?.hasResumableMission
      ? `You can resume this mission: ${asText(guidance?.resumabilitySummary?.missionSummary, 'unknown')} | last=${asText(guidance?.resumabilitySummary?.lastExternalAction, 'none')} | next=${asText(guidance?.resumabilitySummary?.nextRecommendedAction, guidance.nextStepSummary)}`
      : `No resumable mission found. ${asText(guidance?.resumabilitySummary?.nextRecommendedAction, guidance.nextStepSummary)}` ,
    'mark-handoff-applied': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'mark-handoff-failed': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'mark-handoff-rolled-back': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'confirm-validation-passed': formatEnvelopeSummary(guidance, latestResponseEnvelope),
    'confirm-validation-failed': formatEnvelopeSummary(guidance, latestResponseEnvelope),
  };

  return {
    promptKey: resolvedPromptKey,
    guidance,
    text: responseByPrompt[resolvedPromptKey] || asText(fallbackMissionSummary, ''),
  };
}
