const CHAT_CONTEXT_VERSION = 'v1';

const CANON_RULES = [
  { id: 'canon.merge_block_failed_checks', text: 'do not merge when checks/build/verify fail', tags: ['merge', 'pr', 'codex'] },
  { id: 'canon.dist_not_truth', text: 'dist is never source of truth', tags: ['ui', 'build', 'truth'] },
  { id: 'canon.ui_reality_proof', text: 'visual UI changes require browser/UI Reality proof', tags: ['ui', 'proof'] },
  { id: 'canon.source_owns_behavior', text: 'source must own behaviour', tags: ['architecture', 'truth'] },
  { id: 'canon.tests_not_ui_proof', text: 'do not treat terminal-only UI checks as complete', tags: ['ui', 'proof', 'merge', 'pr'] },
  { id: 'canon.no_broad_refactor', text: 'no broad UI refactors when repairing one pane', tags: ['ui', 'repair'] },
  { id: 'canon.first_class_collapsible', text: 'first-class panes must be collapsible', tags: ['ui'] },
  { id: 'canon.arrange_mode_controls', text: 'Move up/down belongs to Arrange Mode', tags: ['ui'] },
  { id: 'canon.copy_green_confirmed', text: 'copy buttons turn green only after confirmed clipboard success', tags: ['ui'] },
  { id: 'canon.multi_surface_allowed', text: 'Mission Console multi-surface mounting is allowed, duplicate implementation is not', tags: ['mission-console', 'architecture'] },
  { id: 'canon.prefer_pr_amend_open', text: 'prefer amendment to existing PR when PR is still open', tags: ['merge', 'pr', 'codex'] },
  { id: 'canon.no_junk_drawer', text: 'AI Console must not become a junk drawer for operational panes', tags: ['ai-console', 'architecture'] },
];

function pickResponseMode(msg = '') {
  const text = String(msg || '').toLowerCase();
  if (/\bdo i merge\b|\bshould i merge\b|\bmerge this\b/.test(text)) return 'merge-decision';
  if (/\bgive me (a )?(codex )?prompt\b|\bcodex prompt\b/.test(text)) return 'codex-prompt';
  if (/\bbroken\b|\bnot working\b|\berror\b|\bbug\b|\bpane is broken\b/.test(text)) return 'diagnosis';
  if (/\bwhat should we build next\b|\bbuild next\b|\bmission plan\b|\bmission planning\b/.test(text)) return 'mission-planning';
  if (/\bwhy does it feel generic\b|\bwhy does stephanos feel generic\b|\barchitecture\b/.test(text)) return 'architecture-guidance';
  if (/\bvr\b|flat-to-vr|\bresearch\b/.test(text)) return 'research-scouting';
  return 'direct-answer';
}

export function buildChatContextPack(input = {}) {
  const operatorMessage = String(input.operatorMessage || '').trim();
  const uiReality = input.uiRealityStatus || {};
  const routeTruth = input.routeTruth || {};
  const providerTruth = input.providerTruth || {};
  const missionState = input.missionState || {};
  const responseMode = pickResponseMode(operatorMessage);
  const warnings = [];
  if (!operatorMessage) warnings.push('operator message missing');
  if (String(uiReality.severity || '').toUpperCase() === 'FAIL') warnings.push('UI Reality FAIL: visual proof required before merge claims.');
  const uiTask = /\b(ui|pane|render|layout|button|console|collapse|arrange)\b/i.test(operatorMessage) || responseMode === 'diagnosis';
  const mergeDecisionTask = responseMode === 'merge-decision';
  const inferredSubsystems = mergeDecisionTask
    ? ['merge', 'pr', 'codex', 'proof', 'source-truth']
    : (uiTask ? ['ui', 'proof', 'source-truth'] : ['general']);
  const relevantCanon = CANON_RULES.filter((rule) => {
    if (mergeDecisionTask) return rule.tags.includes('merge') || rule.tags.includes('pr') || rule.tags.includes('codex') || rule.tags.includes('truth') || rule.tags.includes('ui') || rule.tags.includes('proof');
    if (uiTask) return rule.tags.includes('ui') || rule.tags.includes('truth') || rule.tags.includes('proof');
    return true;
  });

  const compactSummary = {
    status: warnings.length > 0 && !operatorMessage ? 'warning' : 'active',
    version: CHAT_CONTEXT_VERSION,
    responseMode,
    relevantCanonCount: relevantCanon.length,
    affectedSubsystems: Array.isArray(input.supportSnapshot?.affectedSubsystems) && input.supportSnapshot.affectedSubsystems.length
      ? input.supportSnapshot.affectedSubsystems
      : inferredSubsystems,
    nextAction: mergeDecisionTask
      ? 'Collect build/verify/UI proof and amend the open PR before deciding merge.'
      : (uiTask ? 'Capture browser/UI Reality proof before asserting visible fix.' : 'Answer directly with bounded confidence.'),
    warningCount: warnings.length,
    warnings,
    contextSourcesUsed: ['uiRealityStatus', 'routeTruth', 'providerTruth', 'missionState', 'supportSnapshot', 'memoryState', 'agentState'].filter((key) => input[key] && typeof input[key] === 'object'),
    uiRealityStatusAtBuild: String(uiReality.severity || 'UNKNOWN'),
    missionStateAtBuild: String(missionState.mode || missionState.status || 'unknown'),
    providerRouteSummaryAtBuild: `${String(routeTruth.routeKind || 'unknown')}:${String(routeTruth.executedProvider || providerTruth.executableProvider || 'unknown')}:${String(routeTruth.routeUsableState || 'unknown')}`,
    createdAt: new Date().toISOString(),
    requestId: String(input.requestId || input.commandId || '').trim() || null,
  };

  return {
    version: CHAT_CONTEXT_VERSION,
    compactSummary,
    operatorIntent: responseMode,
    affectedSubsystems: Array.isArray(input.supportSnapshot?.affectedSubsystems) && input.supportSnapshot.affectedSubsystems.length
      ? input.supportSnapshot.affectedSubsystems
      : inferredSubsystems,
    missionMode: String(missionState.mode || missionState.status || 'unknown'),
    riskLevel: (uiTask || mergeDecisionTask) ? 'medium' : 'low',
    relevantCanon,
    relevantMemory: Array.isArray(input.memoryState?.candidates) ? input.memoryState.candidates.slice(0, 3) : [],
    currentTruthSummary: {
      runtime: String(input.runtimeTruth?.status || 'unknown'),
      routeKind: String(routeTruth.routeKind || 'unknown'),
      routeUsable: String(routeTruth.routeUsableState || 'unknown'),
      provider: String(routeTruth.executedProvider || providerTruth.executableProvider || 'unknown'),
    },
    uiRealitySummary: {
      status: String(uiReality.severity || 'UNKNOWN'),
      reason: String(uiReality.reason || uiReality.uiRealityReason || 'unknown'),
    },
    routeProviderSummary: {
      requestedProvider: String(routeTruth.requestedProvider || 'unknown'),
      selectedProvider: String(routeTruth.selectedProvider || 'unknown'),
      executedProvider: String(routeTruth.executedProvider || providerTruth.executableProvider || 'unknown'),
    },
    agentSummary: input.agentState || {},
    proofRequirements: uiTask
      ? ['browser-ui-reality-proof', 'source-of-truth-proof', 'targeted-tests']
      : ['targeted-evidence'],
    recommendedResponseMode: responseMode,
    recommendedNextAction: mergeDecisionTask
      ? 'Collect build/verify/UI proof and amend the open PR before deciding merge.'
      : (uiTask ? 'Capture browser/UI Reality proof before asserting visible fix.' : 'Answer directly with bounded confidence.'),
    warnings,
    contextForPrompt: {
      operatorMessage,
      responseMode,
      missionMode: String(missionState.mode || missionState.status || 'unknown'),
      uiRealityStatus: String(uiReality.severity || 'UNKNOWN'),
      route: String(routeTruth.routeKind || 'unknown'),
      provider: String(routeTruth.executedProvider || providerTruth.executableProvider || 'unknown'),
      canon: relevantCanon.map((rule) => rule.text),
      proofRequirements: uiTask ? 'ui-reality+source-truth required' : 'standard',
    },
  };
}

export { pickResponseMode };
