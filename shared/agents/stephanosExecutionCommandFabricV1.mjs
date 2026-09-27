import { isAbsolute, relative, resolve, win32 } from 'node:path';

export const STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA = 'stephanos.execution-command-fabric.v1';

export const STEPHANOS_EXECUTION_SURFACE = Object.freeze({
  OPENCLAW_STANDALONE: 'OPENCLAW_STANDALONE',
  OPENCLAW_LOCAL: 'OPENCLAW_LOCAL',
  DESKTOP_COMMANDER: 'DESKTOP_COMMANDER',
  BUILD_LANE: 'BUILD_LANE',
});

export const STEPHANOS_EXECUTION_ADAPTER = Object.freeze({
  [STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE]: 'openclaw-standalone',
  [STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL]: 'openclaw-local',
  [STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER]: 'desktop-commander',
  [STEPHANOS_EXECUTION_SURFACE.BUILD_LANE]: 'build-lane',
});

export const STEPHANOS_EXECUTION_SCOPE = Object.freeze({
  WHOLE_PC: 'WHOLE_PC',
  STEPHANOS_ONLY: 'STEPHANOS_ONLY',
  BOUNDED_WORKTREE: 'BOUNDED_WORKTREE',
});

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function frozen(value) {
  return Object.freeze(value);
}
function isWindowsAbsolutePath(value) {
  return /^[a-z]:[\\/]/i.test(text(value)) || /^\\\\/.test(text(value));
}

function normalizedPath(value) {
  const raw = text(value);
  if (!raw) return '';
  try {
    return (isWindowsAbsolutePath(raw) ? win32.resolve(raw) : resolve(raw))
      .replace(/[\\/]+$/g, '')
      .toLowerCase();
  } catch {
    return '';
  }
}

function isWithin(root, candidate) {
  const normalizedRoot = normalizedPath(root);
  const normalizedCandidate = normalizedPath(candidate);
  if (!normalizedRoot || !normalizedCandidate) return false;
  const rootIsWindows = isWindowsAbsolutePath(normalizedRoot);
  if (rootIsWindows !== isWindowsAbsolutePath(normalizedCandidate)) return false;
  const rel = rootIsWindows
    ? win32.relative(normalizedRoot, normalizedCandidate)
    : relative(normalizedRoot, normalizedCandidate);
  const relIsAbsolute = rootIsWindows ? win32.isAbsolute(rel) : isAbsolute(rel);
  return rel === '' || (!!rel && !rel.startsWith('..') && !relIsAbsolute);
}

function uniqueRoots(values = []) {
  return frozen([...new Set(values.map(normalizedPath).filter(Boolean))]);
}

export function buildStephanosExecutionSurfaceCatalogV1(input = {}) {
  const stephanosRoots = uniqueRoots([
    input.repositoryRoot,
    input.sharedWorkspaceRoot,
    ...list(input.runtimeRoots),
    ...list(input.additionalStephanosRoots),
  ]);
  return frozen({
    schemaVersion: STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA,
    surfaces: frozen({
      [STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE]: frozen({
        surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE,
        adapter: STEPHANOS_EXECUTION_ADAPTER[STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE],
        agentId: 'openclaw-standalone',
        scope: STEPHANOS_EXECUTION_SCOPE.WHOLE_PC,
        allowedRoots: frozen([]),
        canInspectFiles: true,
        canEditFiles: true,
        canRunCommands: true,
        canManageProcesses: true,
        canUseGit: true,
        receiptRequired: true,
      }),
      [STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL]: frozen({
        surface: STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL,
        adapter: STEPHANOS_EXECUTION_ADAPTER[STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL],
        agentId: text(input.openClawLocalAgentId, 'stephanos-scout-coder'),
        scope: STEPHANOS_EXECUTION_SCOPE.STEPHANOS_ONLY,
        allowedRoots: stephanosRoots,
        canInspectFiles: true,
        canEditFiles: true,
        canRunCommands: true,
        canManageProcesses: false,
        canUseGit: true,
        receiptRequired: true,
      }),
      [STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER]: frozen({
        surface: STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER,
        adapter: STEPHANOS_EXECUTION_ADAPTER[STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER],
        agentId: 'desktop-commander',
        scope: STEPHANOS_EXECUTION_SCOPE.WHOLE_PC,
        allowedRoots: frozen([]),
        canInspectFiles: true,
        canEditFiles: true,
        canRunCommands: true,
        canManageProcesses: true,
        canUseGit: true,
        receiptRequired: true,
      }),
      [STEPHANOS_EXECUTION_SURFACE.BUILD_LANE]: frozen({
        surface: STEPHANOS_EXECUTION_SURFACE.BUILD_LANE,
        adapter: STEPHANOS_EXECUTION_ADAPTER[STEPHANOS_EXECUTION_SURFACE.BUILD_LANE],
        agentId: 'bounded-build-lane',
        scope: STEPHANOS_EXECUTION_SCOPE.BOUNDED_WORKTREE,
        allowedRoots: uniqueRoots(list(input.buildLaneRoots)),
        canInspectFiles: true,
        canEditFiles: true,
        canRunCommands: true,
        canManageProcesses: false,
        canUseGit: true,
        receiptRequired: true,
      }),
    }),
  });
}
export function evaluateStephanosExecutionScopeV1(input = {}) {
  const catalog = input.catalog || buildStephanosExecutionSurfaceCatalogV1(input);
  const surfaceId = text(input.surface).toUpperCase();
  const surface = catalog.surfaces?.[surfaceId] || null;
  const targetPaths = list(input.targetPaths);
  if (!surface) {
    return frozen({ ok: false, surface: surfaceId, blockers: frozen(['execution-surface-unknown']) });
  }
  if (surface.scope === STEPHANOS_EXECUTION_SCOPE.WHOLE_PC) {
    return frozen({ ok: true, surface: surfaceId, scope: surface.scope, targetPaths: frozen(targetPaths), blockers: frozen([]) });
  }
  if (!surface.allowedRoots.length) {
    return frozen({ ok: false, surface: surfaceId, scope: surface.scope, targetPaths: frozen(targetPaths), blockers: frozen(['execution-surface-roots-unproven']) });
  }
  const outside = targetPaths.filter((candidate) => !surface.allowedRoots.some((root) => isWithin(root, candidate)));
  return frozen({
    ok: outside.length === 0,
    surface: surfaceId,
    scope: surface.scope,
    targetPaths: frozen(targetPaths),
    outsideScopePaths: frozen(outside),
    blockers: frozen(outside.length ? ['execution-target-outside-surface-scope'] : []),
  });
}

export function buildStephanosExecutionCommandEnvelopeV1(input = {}) {
  const catalog = input.catalog || buildStephanosExecutionSurfaceCatalogV1(input);
  const surfaceId = text(input.surface).toUpperCase();
  const surface = catalog.surfaces?.[surfaceId] || null;
  const actionId = text(input.actionId);
  const missionId = text(input.missionId);
  const operation = text(input.operation).toUpperCase();
  const targetPaths = list(input.targetPaths);
  const scope = evaluateStephanosExecutionScopeV1({ catalog, surface: surfaceId, targetPaths });
  const blockers = [...scope.blockers];
  if (!actionId) blockers.push('execution-action-id-missing');
  if (!missionId) blockers.push('execution-mission-id-missing');
  if (!operation) blockers.push('execution-operation-missing');
  if (!surface) blockers.push('execution-surface-unavailable');
  const ok = blockers.length === 0;
  return frozen({
    schemaVersion: STEPHANOS_EXECUTION_COMMAND_FABRIC_SCHEMA,
    commandId: actionId,
    missionId,
    relatedIssue: text(input.relatedIssue),
    relatedPr: text(input.relatedPr),
    surface: surfaceId,
    adapter: surface?.adapter || '',
    agentId: surface?.agentId || '',
    operation,
    targetPaths: frozen(targetPaths),
    scope: surface?.scope || '',
    allowedRoots: surface?.allowedRoots || frozen([]),
    payload: input.payload && typeof input.payload === 'object' ? frozen({ ...input.payload }) : frozen({}),
    proofRefs: frozen(list(input.proofRefs)),
    dispatchAllowed: ok,
    blockers: frozen([...new Set(blockers)]),
    receiptRequired: true,
    mergeAuthority: false,
    leaseSeizureAllowed: false,
    duplicateDispatchAllowed: false,
    pcRestartAuthority: false,
    arbitraryUnboundedCommandAllowed: false,
    finalVerdict: ok
      ? 'STEPHANOS_EXECUTION_COMMAND_READY'
      : 'STEPHANOS_EXECUTION_COMMAND_BLOCKED',
  });
}

export function selectStephanosExecutionSurfaceV1(input = {}) {
  const requested = text(input.requestedSurface).toUpperCase();
  const targetPaths = list(input.targetPaths);
  const catalog = input.catalog || buildStephanosExecutionSurfaceCatalogV1(input);
  if (requested) {
    const scope = evaluateStephanosExecutionScopeV1({ catalog, surface: requested, targetPaths });
    return frozen({
      surface: requested,
      selected: scope.ok,
      blockers: scope.blockers,
      finalVerdict: scope.ok ? 'STEPHANOS_EXECUTION_SURFACE_SELECTED' : 'STEPHANOS_EXECUTION_SURFACE_BLOCKED',
    });
  }
  const preferred = input.requiresHostControl === true
    ? STEPHANOS_EXECUTION_SURFACE.DESKTOP_COMMANDER
    : input.requiresWholePc === true
      ? STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE
      : STEPHANOS_EXECUTION_SURFACE.OPENCLAW_LOCAL;
  const scope = evaluateStephanosExecutionScopeV1({ catalog, surface: preferred, targetPaths });
  return frozen({
    surface: scope.ok ? preferred : STEPHANOS_EXECUTION_SURFACE.OPENCLAW_STANDALONE,
    selected: scope.ok,
    blockers: scope.blockers,
    finalVerdict: scope.ok ? 'STEPHANOS_EXECUTION_SURFACE_SELECTED' : 'STEPHANOS_EXECUTION_SURFACE_REQUIRES_BROADER_AGENT',
  });
}
