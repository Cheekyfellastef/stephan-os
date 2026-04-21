import { buildAgentRuntimeModel } from './agentRuntimeModel.mjs';

const AUTO_LEVELS = new Set(['guarded-auto', 'full-auto']);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toText(value = '') {
  return String(value || '').trim();
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

export function adjudicateAgents({ registry = [], eventLog = [], context = {}, operatorControls = {} } = {}) {
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
  const masterEnabled = operatorControls.autonomyMasterToggle !== false;
  const safeMode = operatorControls.safeMode === true;
  const effectiveAutonomy = masterEnabled ? toText(operatorControls.globalAutonomy || 'assisted') : 'manual';

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

    const eligible = surfaceAllowed && sessionAllowed;
    const ready = eligible && unmetDependencies.length === 0;
    const active = enabled && ready && blockers.length === 0;
    const acting = active && runtimeEntry.state === 'acting';

    const stateReason = blockers[0]
      || runtimeEntry.stateReason
      || (acting ? 'Acting on current task.' : active ? 'Active and waiting for work.' : 'Not active.');

    const nextState = blockers.length > 0
      ? 'blocked'
      : runtimeEntry.state === 'offline'
        ? 'watching'
        : runtimeEntry.state;

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
    };
  });

  return {
    global: {
      safeMode,
      masterEnabled,
      globalAutonomy: effectiveAutonomy,
      surface,
      sessionKind,
      adjudicatedAt: nowIso,
    },
    agents: entries,
  };
}
