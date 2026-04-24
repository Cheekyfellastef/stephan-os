import { buildAgentRuntimeModel } from './agentRuntimeModel.mjs';
import { buildAgentMissionModel } from './agentMissionModel.mjs';
import { buildAgentTaskGraph } from './agentTaskGraph.mjs';
import { buildApprovalQueue } from './agentApprovalPolicy.mjs';
import { buildAgentContinuityProjection } from './agentContinuityProjection.mjs';

const AUTO_LEVELS = new Set(['guarded-auto', 'full-auto']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toText(value = '') {
  return String(value || '').trim();
}

function buildGate({ passed = false, reason = '' } = {}) {
  return {
    passed: passed === true,
    reason: toText(reason || 'Not reported.') || 'Not reported.',
  };
}

function modeAllowsAgent({ effectiveAutonomy = 'manual', safeMode = false, agentAutonomyLevel = 'manual' } = {}) {
  const normalizedAutonomy = toText(agentAutonomyLevel).toLowerCase() || 'manual';
  const globalAutonomy = toText(effectiveAutonomy).toLowerCase() || 'manual';
  if (safeMode && AUTO_LEVELS.has(normalizedAutonomy)) {
    return { allowed: false, reason: 'Suppressed by safe mode for higher-autonomy behavior.' };
  }
  if (globalAutonomy === 'manual' && normalizedAutonomy !== 'manual') {
    return { allowed: false, reason: 'Global autonomy is manual.' };
  }
  if (globalAutonomy === 'assisted' && normalizedAutonomy === 'full-auto') {
    return { allowed: false, reason: 'Global autonomy is assisted; full-auto is disallowed.' };
  }
  return { allowed: true, reason: 'Autonomy policy allows this agent.' };
}

export function adjudicateAgents({ registry = [], eventLog = [], orchestrationState = {}, context = {}, operatorControls = {} } = {}) {
  const runtimeEntries = buildAgentRuntimeModel({ registry, eventLog });
  const nowIso = new Date().toISOString();
  const enabledMap = operatorControls.agentEnabledMap && typeof operatorControls.agentEnabledMap === 'object'
    ? operatorControls.agentEnabledMap
    : {};
  const sessionKind = toText(context.sessionKind || 'local-dev');
  const surface = toText(context.surface || 'mission-control');
  const dependencyReadyMap = context.dependencyReadyMap && typeof context.dependencyReadyMap === 'object'
    ? context.dependencyReadyMap
    : {};
  const memoryCapability = context.memoryCapability && typeof context.memoryCapability === 'object'
    ? context.memoryCapability
    : {};
  const masterEnabled = operatorControls.autonomyMasterToggle !== false;
  const safeMode = operatorControls.safeMode === true;
  const effectiveAutonomy = masterEnabled ? toText(operatorControls.globalAutonomy || 'assisted') : 'manual';
  const memoryCapabilityState = toText(memoryCapability.state || 'unavailable');
  const memoryCapabilityReason = toText(memoryCapability.reason || 'Memory capability state unavailable.');
  const providerRouteTruth = context.providerRouteTruth && typeof context.providerRouteTruth === 'object'
    ? context.providerRouteTruth
    : null;
  const currentIntentState = toText(context.currentIntentState || '');
  const currentIntentReason = toText(context.currentIntentReason || '');
  const hasFreshIntent = context.hasFreshIntent === true;
  const hasAssignedTask = context.hasAssignedTask === true;
  const hasTaskIntent = context.hasTaskIntent === true;

  const missionModel = buildAgentMissionModel({ orchestrationState });
  const taskGraph = buildAgentTaskGraph({ missionModel });
  const approvalQueue = buildApprovalQueue({ missionModel, context });
  const continuityProjection = buildAgentContinuityProjection({ missionModel, context });

  const entries = runtimeEntries.map((runtimeEntry) => {
    const registryEntry = registry.find((entry) => entry.agentId === runtimeEntry.agentId) || {};
    const enabled = enabledMap[runtimeEntry.agentId] == null
      ? registryEntry.enabledByDefault === true
      : enabledMap[runtimeEntry.agentId] === true;
    const blockers = [];

    const surfaceAllowed = asArray(registryEntry.allowedSurfaces).includes(surface);
    if (!surfaceAllowed) blockers.push(`Surface ${surface} is not allowed.`);

    const sessionAllowed = asArray(registryEntry.allowedSessionKinds).includes(sessionKind);
    if (!sessionAllowed) blockers.push(`Session kind ${sessionKind} is not allowed.`);

    const unmetDependencies = asArray(registryEntry.dependencies)
      .filter((dependencyId) => dependencyReadyMap[dependencyId] === false);
    if (unmetDependencies.length) blockers.push(`Dependencies blocked: ${unmetDependencies.join(', ')}.`);

    const autonomyGate = modeAllowsAgent({
      effectiveAutonomy,
      safeMode,
      agentAutonomyLevel: registryEntry.autonomyLevel,
    });
    if (!autonomyGate.allowed) blockers.push(autonomyGate.reason);

    if (!enabled) blockers.push('Disabled by operator control.');
    if (!masterEnabled) blockers.push('Autonomy master toggle is off.');

    const isMemoryAgent = runtimeEntry.agentId === 'memory-agent';
    const memoryState = memoryCapabilityState;
    const memoryReason = memoryCapabilityReason;
    const memoryReady = memoryCapability.ready === true;
    const eligible = surfaceAllowed && sessionAllowed;
    const readyBase = eligible && unmetDependencies.length === 0;
    const ready = isMemoryAgent ? (readyBase && memoryReady) : readyBase;
    const active = enabled && ready && blockers.length === 0;
    const acting = active && runtimeEntry.state === 'acting';
    const providerRouteGate = providerRouteTruth
      ? buildGate({
        passed: providerRouteTruth.passed === true,
        reason: providerRouteTruth.reason || 'Provider/route viability not reported.',
      })
      : buildGate({
        passed: true,
        reason: 'Provider/route viability not reported.',
      });
    const taskIntentReady = hasTaskIntent || hasAssignedTask || hasFreshIntent;
    const taskIntentReason = hasAssignedTask
      ? 'Task assignment is present.'
      : hasFreshIntent
        ? 'Fresh intent classification is available.'
        : currentIntentState
          ? `Waiting for intent/task adjudication (${currentIntentState}).`
          : 'No current task assigned.';
    const adjudicationGates = {
      surfaceGate: buildGate({
        passed: surfaceAllowed,
        reason: surfaceAllowed ? `Surface ${surface} allowed.` : `Surface ${surface} is not allowed.`,
      }),
      sessionGate: buildGate({
        passed: sessionAllowed,
        reason: sessionAllowed ? `Session kind ${sessionKind} allowed.` : `Session kind ${sessionKind} is not allowed.`,
      }),
      dependencyGate: buildGate({
        passed: unmetDependencies.length === 0,
        reason: unmetDependencies.length === 0
          ? 'Dependencies are satisfied.'
          : `Dependencies blocked: ${unmetDependencies.join(', ')}.`,
      }),
      autonomyGate: buildGate({
        passed: autonomyGate.allowed,
        reason: autonomyGate.reason,
      }),
      operatorEnableGate: buildGate({
        passed: enabled,
        reason: enabled ? 'Agent is enabled by operator control.' : 'Disabled by operator control.',
      }),
      masterToggleGate: buildGate({
        passed: masterEnabled,
        reason: masterEnabled ? 'Autonomy master toggle is on.' : 'Autonomy master toggle is off.',
      }),
      safeModeGate: buildGate({
        passed: !(safeMode && AUTO_LEVELS.has(toText(registryEntry.autonomyLevel).toLowerCase())),
        reason: safeMode ? 'Safe mode is active.' : 'Safe mode is not active.',
      }),
      taskIntentGate: buildGate({
        passed: taskIntentReady,
        reason: taskIntentReason,
      }),
      providerRouteGate,
    };

    let stateReason = blockers[0]
      || runtimeEntry.stateReason
      || (acting ? 'Acting on current task.' : active ? 'Active and waiting for work.' : 'Not active.');

    let nextState = blockers.length > 0
      ? 'blocked'
      : runtimeEntry.state === 'offline'
        ? 'watching'
        : runtimeEntry.state;
    if (isMemoryAgent) {
      if (memoryState === 'backend') {
        nextState = runtimeEntry.state === 'acting' ? 'acting' : 'watching';
        stateReason = memoryReason || 'Shared backend durable memory is hydrated and ready.';
      } else if (memoryState === 'degraded-local') {
        nextState = 'degraded';
        stateReason = memoryReason || 'Watching continuity with degraded local memory fallback.';
      } else if (memoryState === 'hydrating') {
        nextState = 'preparing';
        stateReason = memoryReason || 'Memory hydration is still in progress.';
      } else {
        nextState = 'blocked';
        stateReason = memoryReason || 'Shared durable memory unavailable.';
      }
    }
    if (runtimeEntry.agentId === 'research-agent' && active && !acting && !hasFreshIntent && !runtimeEntry.currentTaskSummary) {
      nextState = 'waiting';
      stateReason = currentIntentReason || 'Waiting for intent classification.';
    }
    if (runtimeEntry.state === 'waiting') {
      if (!taskIntentReady) {
        stateReason = currentIntentState === 'classifying'
          ? 'Waiting for intent classification.'
          : 'No current task assigned.';
      } else if (providerRouteGate.passed !== true) {
        stateReason = 'Waiting for route/provider viability.';
      } else if (enabled !== true) {
        stateReason = 'Waiting for operator approval.';
      }
    }

    const ownedTaskIds = Array.from(taskGraph.taskById?.keys?.() || [])
      .filter((taskId) => taskGraph.taskById.get(taskId)?.assignedAgentId === runtimeEntry.agentId);
    const delegatedTaskIds = missionModel.handoffs
      .filter((handoff) => handoff.fromAgentId === runtimeEntry.agentId)
      .map((handoff) => handoff.taskId)
      .filter(Boolean);
    const pendingApprovalCount = approvalQueue.filter((entry) => entry.assignedAgentId === runtimeEntry.agentId && entry.approvalState === 'pending').length;
    const blockedTaskCount = continuityProjection.blockedQueue.filter((entry) => entry.taskId && ownedTaskIds.includes(entry.taskId)).length;
    const resumableTaskCount = continuityProjection.resumableQueue.filter((entry) => entry.taskId && ownedTaskIds.includes(entry.taskId)).length;

    return {
      ...runtimeEntry,
      registered: true,
      enabled,
      eligible,
      ready,
      active,
      acting,
      state: nextState,
      stateReason,
      blockers: Array.from(new Set([...(runtimeEntry.blockers || []), ...blockers])),
      adjudicationGates,
      adjudicatedAt: nowIso,
      autonomyLevel: registryEntry.autonomyLevel,
      displayName: registryEntry.displayName,
      visibility: registryEntry.visibility,
      description: registryEntry.description,
      capabilities: registryEntry.capabilities || [],
      dependencies: registryEntry.dependencies || [],
      allowedSurfaces: registryEntry.allowedSurfaces || [],
      allowedSessionKinds: registryEntry.allowedSessionKinds || [],
      kind: registryEntry.kind || 'specialist',
      ownedTaskIds,
      delegatedTaskIds,
      pendingApprovalCount,
      blockedTaskCount,
      resumableTaskCount,
      currentGoalId: missionModel.tasks.find((task) => task.assignedAgentId === runtimeEntry.agentId && ['active', 'ready', 'waiting', 'blocked'].includes(task.status))?.parentGoalId || '',
    };
  });

  return {
    missionModel,
    taskGraph: {
      goals: taskGraph.goals,
      tasksByGoal: taskGraph.tasksByGoal,
      childrenByTask: taskGraph.childrenByTask,
      handoffChains: taskGraph.handoffChains,
      ownership: taskGraph.ownership,
    },
    approvalQueue,
    continuityProjection,
    global: {
      safeMode,
      masterEnabled,
      globalAutonomy: effectiveAutonomy,
      surface,
      sessionKind,
      adjudicatedAt: nowIso,
    },
    memoryCapability: {
      state: memoryCapabilityState || 'unavailable',
      ready: memoryCapability.ready === true,
      canonical: memoryCapability.canonical === true,
      reason: memoryCapabilityReason,
    },
    agents: entries,
  };
}
