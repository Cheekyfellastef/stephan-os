const PROVIDER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;

const requiredMethods = [
  'getSummary',
  'getWarnings',
  'getNextAction',
  'getProofState',
  'getCanonLinks',
  'getSourceRefs',
];

const providers = [];

function normalizeList(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.filter((item) => item !== undefined && item !== null).map((item) => String(item).trim()).filter(Boolean);
}

function isValidProvider(provider) {
  if (!provider || typeof provider !== 'object') return false;
  if (!PROVIDER_ID_PATTERN.test(String(provider.id || '').trim())) return false;
  if (typeof provider.label !== 'string' || !provider.label.trim()) return false;
  if (!Number.isFinite(Number(provider.priority))) return false;
  return requiredMethods.every((method) => typeof provider[method] === 'function');
}

export function registerContextProvider(provider) {
  if (!isValidProvider(provider)) return false;
  if (providers.some((existing) => existing.id === provider.id)) return false;
  providers.push(Object.freeze({ ...provider }));
  providers.sort((left, right) => Number(left.priority) - Number(right.priority));
  return true;
}

export function getRegisteredContextProviders() {
  return providers.slice();
}

export function buildContextProviderSnapshot(input = {}) {
  const usedProviders = [];
  const warnings = [];
  const nextActions = [];
  const proofState = {};
  const canonLinks = new Set();
  const sourceRefs = new Set();
  const providerSummaries = {};

  for (const provider of providers) {
    usedProviders.push(provider.id);
    const summary = provider.getSummary(input) || {};
    providerSummaries[provider.id] = summary;
    normalizeList(provider.getWarnings(input)).forEach((warning) => warnings.push(`${provider.id}: ${warning}`));
    normalizeList(provider.getNextAction(input)).forEach((action) => nextActions.push(action));
    proofState[provider.id] = provider.getProofState(input) || 'unknown';
    normalizeList(provider.getCanonLinks(input)).forEach((link) => canonLinks.add(link));
    normalizeList(provider.getSourceRefs(input)).forEach((ref) => sourceRefs.add(ref));
  }

  return {
    providerSummaries,
    providerWarnings: warnings,
    providerNextActions: nextActions,
    contextProviderIdsUsed: usedProviders,
    contextProviderWarningCount: warnings.length,
    contextProviderProofState: proofState,
    contextProviderCanonLinks: Array.from(canonLinks),
    contextProviderSourceRefs: Array.from(sourceRefs),
  };
}

const builtinProviders = [
  {
    id: 'uiReality', label: 'UI Reality', priority: 10,
    getSummary: (input) => {
      const ui = input.uiRealityStatus || {};
      return {
        status: String(ui.severity || 'UNKNOWN'),
        reason: String(ui.reason || ui.uiRealityReason || 'unknown'),
        missingCollapseControls: String(ui.missingCollapseControls || 'unknown'),
        commandDeckHealth: String(ui.commandDeckHealth || 'unknown'),
        missionConsolePlacement: String(ui.missionConsolePlacement || 'unknown'),
        moveControlStatus: String(ui.moveControlStatus || 'unknown'),
      };
    },
    getWarnings: (input) => String(input.uiRealityStatus?.severity || '').toUpperCase() === 'FAIL' ? ['UI Reality FAIL: visual proof required before merge claims.'] : [],
    getNextAction: () => ['Capture browser/UI Reality proof before asserting visible fix.'],
    getProofState: (input) => String(input.uiRealityStatus?.severity || 'UNKNOWN'),
    getCanonLinks: () => ['canon.ui_reality_proof', 'canon.arrange_mode_controls'],
    getSourceRefs: () => ['uiRealityStatus'],
  },
  {
    id: 'runtimeTruth', label: 'Runtime Truth', priority: 20,
    getSummary: (input) => {
      const route = input.routeTruth || {};
      return {
        launchState: String(input.runtimeTruth?.status || 'unknown'), routeMode: String(route.routeKind || 'unknown'),
        selectedRoute: String(route.selectedRouteKind || route.routeKind || 'unknown'), selectedProvider: String(route.selectedProvider || 'unknown'),
        executableProvider: String(route.executedProvider || input.providerTruth?.executableProvider || 'unknown'),
        backendReachable: String(route.backendReachableState || 'unknown'), routeUsability: String(route.routeUsableState || 'unknown'),
      };
    },
    getWarnings: () => [], getNextAction: () => [], getProofState: () => 'ready',
    getCanonLinks: () => ['canon.source_owns_behavior'], getSourceRefs: () => ['routeTruth', 'runtimeTruth'],
  },
  {
    id: 'providerTruth', label: 'Provider Truth', priority: 30,
    getSummary: (input) => ({
      selectedProvider: String(input.routeTruth?.selectedProvider || 'unknown'),
      actualProvider: String(input.routeTruth?.executedProvider || input.providerTruth?.executableProvider || 'unknown'),
      actualModel: String(input.providerTruth?.actualModel || 'unknown'),
      supportsFreshWeb: String(input.providerTruth?.supportsFreshWeb || 'unknown'), freshnessMode: String(input.providerTruth?.freshnessMode || 'unknown'), fallbackState: String(input.providerTruth?.fallbackState || 'unknown'),
    }),
    getWarnings: () => [], getNextAction: () => [], getProofState: () => 'ready',
    getCanonLinks: () => ['canon.source_owns_behavior'], getSourceRefs: () => ['providerTruth', 'routeTruth'],
  },
  {
    id: 'missionState', label: 'Mission State', priority: 40,
    getSummary: (input) => ({
      canonicalMissionPhase: String(input.missionState?.mode || input.missionState?.status || 'unknown'),
      missionBlockedState: String(input.missionState?.blocked || 'unknown'), missionNextAction: String(input.missionState?.nextAction || 'unknown'),
      approvalRequired: String(input.missionState?.approvalRequired || 'unknown'), codexHandoffReadiness: String(input.missionState?.codexHandoffReadiness || 'unknown'),
    }),
    getWarnings: () => [], getNextAction: (input) => [String(input.missionState?.nextAction || '').trim()].filter(Boolean), getProofState: () => 'ready',
    getCanonLinks: () => ['canon.prefer_pr_amend_open'], getSourceRefs: () => ['missionState'],
  },
  {
    id: 'proofState', label: 'Proof State', priority: 50,
    getSummary: (input) => ({
      uiRealityStatus: String(input.uiRealityStatus?.severity || 'UNKNOWN'), missionVerificationReadiness: String(input.missionState?.verificationStatus || 'unknown'),
      prEvidenceState: String(input.supportSnapshot?.prEvidenceState || 'unknown'), requiredProofStatus: String(input.supportSnapshot?.requiredProofStatus || 'unknown'),
    }),
    getWarnings: () => [], getNextAction: () => ['Collect build/verify/UI proof and amend the open PR before deciding merge.'], getProofState: (input) => String(input.uiRealityStatus?.severity || 'UNKNOWN'),
    getCanonLinks: () => ['canon.merge_block_failed_checks', 'canon.tests_not_ui_proof'], getSourceRefs: () => ['uiRealityStatus', 'missionState', 'supportSnapshot'],
  },
  {
    id: 'canonRules', label: 'Canon Rules', priority: 60,
    getSummary: () => ({ mode: 'intent-sensitive-canon' }),
    getWarnings: () => [], getNextAction: () => [], getProofState: () => 'ready',
    getCanonLinks: () => [
      'canon.dist_not_truth', 'canon.ui_reality_proof', 'canon.merge_block_failed_checks', 'canon.no_broad_refactor',
      'canon.arrange_mode_controls', 'canon.copy_green_confirmed', 'canon.multi_surface_allowed',
    ],
    getSourceRefs: () => ['chatContextOrchestrator.CANON_RULES'],
  },
  {
    id: 'memoryContinuity', label: 'Memory Continuity', priority: 70,
    getSummary: (input) => ({
      memoryCapabilityState: String(input.memoryState?.capabilityState || 'unknown'), continuityConfidence: String(input.memoryState?.continuityConfidence || 'unknown'),
      relevantMemoryCount: Number(input.memoryState?.candidates?.length || 0), memoryWarnings: normalizeList(input.memoryState?.warnings), lessonCanonCandidatePending: String(input.memoryState?.lessonCanonCandidatePending || 'unknown'),
    }),
    getWarnings: (input) => normalizeList(input.memoryState?.warnings), getNextAction: () => [], getProofState: () => 'ready',
    getCanonLinks: () => ['canon.source_owns_behavior'], getSourceRefs: () => ['memoryState'],
  },
  {
    id: 'agentState', label: 'Agent State', priority: 80,
    getSummary: (input) => ({
      selectedAgent: String(input.agentState?.selectedAgentId || 'unknown'), activeAgents: Number(input.agentState?.activeAgentIds?.length || 0),
      blockedAgents: Number(input.agentState?.blockedAgentIds?.length || 0), agentAssignmentCounts: Number(input.agentState?.assignments?.length || 0),
      approvalRequired: String(input.agentState?.approvalRequired || 'unknown'), openClawCodexAssignmentStatus: String(input.agentState?.openClawCodexAssignmentStatus || 'unknown'),
    }),
    getWarnings: () => [], getNextAction: () => [], getProofState: () => 'ready',
    getCanonLinks: () => ['canon.no_junk_drawer'], getSourceRefs: () => ['agentState'],
  },
];

builtinProviders.forEach((provider) => registerContextProvider(provider));
