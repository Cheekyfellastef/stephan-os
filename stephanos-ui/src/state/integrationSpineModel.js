function asText(value, fallback = 'unknown') {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function asList(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function pickFirstNonUnknown(...values) {
  for (const value of values) {
    const text = asText(value, 'unknown');
    if (!['unknown', 'n/a', 'none'].includes(text.toLowerCase())) return text;
  }
  return 'unknown';
}

function toEvidence(systemId, fields = []) {
  return { systemId, fields: fields.filter(Boolean), authority: 'read-only projection' };
}

function makeDepartment(id, summary, blocker, nextAction, confidence, evidence) {
  return { id, summary, blocker, nextAction, confidence, evidence: asList(evidence) };
}

export function buildStephanosIntegrationSpine(models = {}) {
  const {
    missionConsole = {},
    operatorRelief = {},
    runtimeStatus = {},
    routeAdjudicator = {},
    systemWatcher = {},
    supportSnapshot = {},
    agentTask = {},
    codexHandoff = {},
    openClawPolicy = {},
    capabilityRadar = {},
    skillForge = {},
    memoryLibrarian = {},
    durableMemory = {},
    retrieval = {},
    proofOfDone = {},
    telemetry = {},
    promptBuilder = {},
    paneSystem = {},
    surfaceAwareness = {},
    battleBridge = {},
    missionDashboard = {},
    providerRouter = {},
    workflowRules = {},
    vrLab = {},
  } = models;

  const missionState = pickFirstNonUnknown(
    operatorRelief.status,
    missionConsole.missionState,
    missionDashboard.overallSummary?.projectHealth,
    runtimeStatus.missionState,
  );

  const nextBestAction = pickFirstNonUnknown(
    operatorRelief.nextBestAction?.label,
    missionRoutingNextAction(providerRouter),
    missionDashboard.overallSummary?.missionNote,
    runtimeStatus.operatorNextAction,
  );

  const majorBlockers = [
    asText(operatorRelief.evidenceGaps?.[0]?.label, ''),
    asText(providerRouter.blockerSummary, ''),
    asText(routeAdjudicator.blockedReason, ''),
    asText(battleBridge.statusSummary, ''),
  ].filter(Boolean);

  const departments = [
    makeDepartment(
      'runtime',
      pickFirstNonUnknown(routeAdjudicator.launchState, supportSnapshot.routeStatus, runtimeStatus.routeStatus),
      pickFirstNonUnknown(routeAdjudicator.blockedReason, supportSnapshot.operatorBoundary?.operatorBoundaryAlert),
      pickFirstNonUnknown(routeAdjudicator.suggestedAction, runtimeStatus.operatorNextAction),
      pickFirstNonUnknown(routeAdjudicator.confidence, runtimeStatus.routeConfidence),
      [toEvidence('runtimeAdjudicator', ['launchState', 'blockedReason', 'suggestedAction']), toEvidence('supportSnapshot', ['routeStatus'])],
    ),
    makeDepartment(
      'agents',
      pickFirstNonUnknown(agentTask.layerStatus, codexHandoff.status, openClawPolicy.status),
      pickFirstNonUnknown(agentTask.blocker, openClawPolicy.highestPriorityBlocker),
      pickFirstNonUnknown(agentTask.nextAction, codexHandoff.nextAction),
      pickFirstNonUnknown(agentTask.confidence, 'medium'),
      [toEvidence('agentTaskProjection', ['layerStatus', 'nextAction']), toEvidence('openClawPolicyHarness', ['status', 'highestPriorityBlocker'])],
    ),
    makeDepartment(
      'memory',
      pickFirstNonUnknown(memoryLibrarian.status, durableMemory.status, retrieval.status),
      pickFirstNonUnknown(memoryLibrarian.blocker, retrieval.blocker),
      pickFirstNonUnknown(memoryLibrarian.nextAction, retrieval.nextAction),
      pickFirstNonUnknown(memoryLibrarian.confidence, 'medium'),
      [toEvidence('memoryLibrarianModel', ['status', 'queue']), toEvidence('stephanosMemory', ['status']), toEvidence('continuityRetrieval', ['status'])],
    ),
    makeDepartment(
      'proof',
      pickFirstNonUnknown(proofOfDone.verificationJudge?.proofOfDoneStatus, operatorRelief.mergeSafety?.verdict, supportSnapshot.buildStatus),
      pickFirstNonUnknown(operatorRelief.evidenceGaps?.[0]?.label, proofOfDone.verificationJudge?.judgment),
      pickFirstNonUnknown(operatorRelief.nextBestAction?.label, proofOfDone.nextAction),
      pickFirstNonUnknown(proofOfDone.verificationJudge?.mergeReadyCandidate ? 'high' : 'medium'),
      [toEvidence('proofOfDoneModel', ['verificationJudge']), toEvidence('operatorReliefProjection', ['evidenceGaps', 'nextBestAction']), toEvidence('supportSnapshot', ['buildStatus'])],
    ),
    makeDepartment('vr-lab', pickFirstNonUnknown(vrLab.status, 'research'), pickFirstNonUnknown(vrLab.blocker, 'none'), pickFirstNonUnknown(vrLab.nextAction, 'continue flat-to-vr research track'), pickFirstNonUnknown(vrLab.confidence, 'medium'), [toEvidence('vrLabTrack', ['status', 'nextAction'])]),
    makeDepartment('stability', pickFirstNonUnknown(systemWatcher.status, battleBridge.status, telemetry.health), pickFirstNonUnknown(systemWatcher.blocker, battleBridge.blocker), pickFirstNonUnknown(systemWatcher.nextAction, battleBridge.nextAction), pickFirstNonUnknown(systemWatcher.confidence, 'medium'), [toEvidence('systemWatcherModel', ['status', 'warnings']), toEvidence('battleBridge', ['status', 'blocker'])]),
    makeDepartment('ui', pickFirstNonUnknown(paneSystem.status, surfaceAwareness.surfaceProfile, missionConsole.layoutStatus), pickFirstNonUnknown(paneSystem.blocker, missionConsole.blocker), pickFirstNonUnknown(promptBuilder.nextAction, missionConsole.nextAction), pickFirstNonUnknown(surfaceAwareness.confidence, 'medium'), [toEvidence('paneSystem', ['status', 'collapseState']), toEvidence('surfaceAwareness', ['surfaceProfile']), toEvidence('promptBuilder', ['status'])]),
  ];

  return {
    version: 'integration-spine.v1.readonly',
    readonly: true,
    levels: {
      captainView: {
        overallStatus: missionState,
        majorBlockers,
        nextBestAction,
        activeMissionState: missionState,
        confidenceLevel: pickFirstNonUnknown(operatorRelief.mergeSafety?.verdict, runtimeStatus.routeStatus, 'medium'),
        evidence: [
          toEvidence('operatorReliefProjection', ['status', 'nextBestAction', 'evidenceGaps']),
          toEvidence('missionDashboardModel', ['overallSummary']),
          toEvidence('runtimeAdjudicator', ['launchState', 'blockedReason']),
        ],
      },
      departmentView: departments,
      subsystemView: {
        missionConsole,
        operatorRelief,
        runtimeStatus,
        routeAdjudicator,
        systemWatcher,
        supportSnapshot,
        agentTask,
        codexHandoff,
        openClawPolicy,
        capabilityRadar,
        skillForge,
        memoryLibrarian,
        durableMemory,
        retrieval,
        proofOfDone,
        telemetry,
        promptBuilder,
        paneSystem,
        surfaceAwareness,
        battleBridge,
        missionDashboard,
        providerRouter,
        workflowRules,
        vrLab,
      },
      engineeringView: {
        links: asList(models.engineeringLinks),
        telemetryStreams: asList(telemetry.streams),
        diagnostics: asList(systemWatcher.diagnostics),
      },
    },
  };
}

function missionRoutingNextAction(providerRouter = {}) {
  return providerRouter.missionRoutingNextAction || providerRouter.nextAction || providerRouter.operatorAction;
}
