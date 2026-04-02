import { getStartupDiagnosticsSnapshot, recordStartupLaunchTrigger } from '../../shared/runtime/startupLaunchDiagnostics.mjs';
import { publishTileContextSnapshot } from '../../shared/runtime/tileContextRegistry.mjs';
import { STEPHANOS_LAW_IDS } from '../../shared/runtime/stephanosLaws.mjs';
import { withCommandDeckDestination } from '../../shared/runtime/commandDeckDestination.mjs';

function normaliseProject(project) {
  if (typeof project === 'string') {
    return {
      name: project,
      icon: '🧩',
      entry: '',
      disabled: false,
      validationIssues: [],
      dependencyState: 'ready',
      runtimeStatusModel: null,
      launchStrategy: 'workspace',
    };
  }

  return {
    name: project?.name || 'Unnamed Project',
    icon: project?.icon || '🧩',
    entry: project?.entry || '',
    disabled: Boolean(project?.disabled),
    validationState: project?.validationState || (project?.disabled ? 'error' : 'healthy'),
    statusMessage: project?.statusMessage || '',
    validationIssues: Array.isArray(project?.validationIssues) ? project.validationIssues : [],
    dependencyState: project?.dependencyState || 'ready',
    runtimeStatusModel: project?.runtimeStatusModel || null,
    launchStrategy: project?.launchStrategy || 'workspace',
    launcherEntry: project?.launcherEntry || '',
    runtimeEntry: project?.runtimeEntry || '',
    launchEntry: project?.launchEntry || '',
    buildStamp: project?.buildStamp || 'unknown',
    buildStampLabel: project?.buildStampLabel || 'Stephanos Build: unknown',
    buildMarker: project?.buildMarker || '',
    capabilities: Array.isArray(project?.capabilities) ? project.capabilities : [],
    eventsPublished: Array.isArray(project?.eventsPublished) ? project.eventsPublished : [],
    eventsConsumed: Array.isArray(project?.eventsConsumed) ? project.eventsConsumed : [],
    memoryUsage: project?.memoryUsage || 'none-declared',
    continuityParticipation: project?.continuityParticipation || 'none-declared',
    aiAddressable: project?.aiAddressable === true,
  };
}

function resolveStephanosLaunchTarget(project) {
  const launchEntry = String(project?.launchEntry || '').trim();
  const runtimeEntry = String(project?.runtimeEntry || '').trim();
  const compatibilityEntry = String(project?.entry || '').trim();
  const launcherEntry = String(project?.launcherEntry || '').trim();

  const resolved = String(
    launchEntry
    || runtimeEntry
    || compatibilityEntry
    || ''
  ).trim();

  if (!launchEntry && (runtimeEntry || compatibilityEntry)) {
    console.warn(`[CommandDeck] [LAW:${STEPHANOS_LAW_IDS.ENTRY_SEPARATION}] Stephanos launchEntry missing; using compatibility fallback order launchEntry -> runtimeEntry -> entry`, {
      runtimeEntry,
      entry: compatibilityEntry,
      launcherEntry,
      resolved,
    });
  }

  return resolved;
}

export function resolveStephanosLaunchTargetForTest(project) {
  return resolveStephanosLaunchTarget(project);
}

function getRuntimeProjects(context) {
  const projects =
    context.systemState.get('projects')?.length
      ? context.systemState.get('projects')
      : context.projects;

  return Array.isArray(projects) ? projects : [];
}

function ensureStatusSurface(containerId, className = '') {
  let node = document.getElementById(containerId);
  if (node) {
    return node;
  }

  const secondaryPanels = document.getElementById('launcher-secondary-panels');
  if (!secondaryPanels) {
    return null;
  }

  node = document.createElement('section');
  node.id = containerId;
  node.className = className;
  secondaryPanels.appendChild(node);
  return node;
}

function hardenProjectRegistryHitTargets(container) {
  if (!container?.children) {
    return;
  }

  Array.from(container.children).forEach((child) => {
    const className = String(child?.className || '').trim();
    const classTokens = className.length > 0 ? className.split(/\s+/) : [];
    const isTile = classTokens.includes('app-tile');
    const isClickableDiv = String(child?.tagName || '').toLowerCase() === 'div' && typeof child?.onclick === 'function';

    if (!isTile && isClickableDiv && child?.classList?.add) {
      child.classList.add('app-tile');
      child.style.pointerEvents = 'auto';
      return;
    }

    if (isTile) {
      child.style.pointerEvents = 'auto';
      return;
    }

    if (child?.style) {
      child.style.pointerEvents = 'none';
      child.dataset.launcherHitShield = 'true';
    }
  });
}

function launchProject(project, context, trigger = {}) {
  const projectId = String(project?.folder || project?.id || project?.name || '').trim().toLowerCase();
  const isStephanos = projectId === 'stephanos' || projectId === 'stephanos os';
  const chosenTarget = isStephanos ? resolveStephanosLaunchTarget(project) : String(project?.entry || '').trim();
  const launcherEntry = String(project?.launcherEntry || '').trim();
  const runtimeEntry = String(project?.runtimeEntry || '').trim();
  const launchEntry = String(project?.launchEntry || '').trim();

  if (!chosenTarget) {
    return;
  }

  const resolvedEntry = (() => {
    try {
      return new URL(chosenTarget, window.location.href).href;
    } catch {
      return chosenTarget;
    }
  })();

  console.info('[CommandDeck] Launch requested', {
    project: project?.name || projectId || 'unknown',
    launchStrategy: project.launchStrategy || 'workspace',
    isStephanos,
    rawEntry: chosenTarget,
    resolvedEntry,
    trigger,
  });
  context?.eventBus?.emit('tile.action', {
    tileId: projectId,
    tileTitle: project?.name || projectId || 'unknown',
    action: 'launch-requested',
    triggerType: trigger?.type || 'unknown',
    source: 'command-deck',
    summary: `Launch requested for ${project?.name || projectId || 'tile'}`,
  });

  recordStartupLaunchTrigger({
    sourceModule: 'modules/command-deck/command-deck.js',
    sourceFunction: 'launchProject',
    triggerType: trigger.type || 'unknown',
    triggerPayload: trigger,
    rawTarget: chosenTarget,
    resolvedTarget: resolvedEntry,
  });

  const startupDiagnostics = getStartupDiagnosticsSnapshot();
  if (isStephanos && trigger?.type === 'event-bus' && startupDiagnostics.userInteraction?.interacted !== true) {
    console.warn('[CommandDeck] Suppressed non-interactive Stephanos auto-launch event during landing-page runtime', {
      trigger,
      startupDiagnostics,
      rawEntry: chosenTarget,
      resolvedEntry,
    });
    return;
  }

  if (isStephanos) {
    if (trigger?.type === 'user-click' && launcherEntry && runtimeEntry && launcherEntry !== runtimeEntry && chosenTarget === launcherEntry) {
      console.warn(`[CommandDeck] [LAW:${STEPHANOS_LAW_IDS.RUNTIME_TARGET_DISTINCT}] Stephanos tile click resolved to launcher shell target; expected runtime launch target.`, {
        launcherEntry,
        runtimeEntry,
        launchEntry,
        chosenTarget,
      });
    }

    if (launchEntry && runtimeEntry && launchEntry !== runtimeEntry && chosenTarget === String(project?.entry || '').trim()) {
      console.warn(`[CommandDeck] [LAW:${STEPHANOS_LAW_IDS.ENTRY_COMPATIBILITY_ONLY}] Stephanos launch used compatibility entry even though separated launch fields exist.`, {
        launchEntry,
        runtimeEntry,
        entry: String(project?.entry || '').trim(),
        chosenTarget,
      });
    }

    console.info('[CommandDeck] Stephanos launch forcing top-level navigation', {
      reason: 'avoid iframe-based local ignition/recovery from invalid frame contexts',
      target: resolvedEntry,
    });
    window.location.assign(withCommandDeckDestination(resolvedEntry, window));
    return;
  }

  if (project.launchStrategy === 'navigate') {
    window.location.assign(withCommandDeckDestination(resolvedEntry, window));
    return;
  }

  context.workspace.open(project, context);
}

function isStephanosProject(project) {
  const projectId = String(project?.folder || project?.id || project?.name || '').trim().toLowerCase();
  return projectId === 'stephanos' || projectId === 'stephanos os';
}

function renderLauncherStatusStrip(projects) {
  const strip = ensureStatusSurface('launcher-runtime-strip', 'launcher-runtime-strip');
  if (!strip) return;

  const stephanos = projects.map(normaliseProject).find((project) => String(project.name || '').toLowerCase().includes('stephanos'));
  const runtime = stephanos?.runtimeStatusModel;
  const buildStampLabel = stephanos?.buildStampLabel || 'Stephanos Build: unknown';
  const runtimeMarker = stephanos?.buildMarker ? `<div class="runtime-strip-subtext">Runtime marker: ${stephanos.buildMarker}</div>` : '';

  if (!stephanos) {
    strip.innerHTML = '';
    return;
  }

  if (!runtime) {
    strip.innerHTML = `
      <div class="runtime-strip-card degraded">
        <div>
          <div class="runtime-strip-label">System Route</div>
          <strong>Stephanos runtime status unavailable</strong>
          <div class="runtime-strip-subtext">${buildStampLabel}</div>
          <div class="runtime-strip-subtext">Route diagnostics are pending or unavailable.</div>
        </div>
      </div>
    `;
    return;
  }

  strip.innerHTML = `
    <div class="runtime-strip-card ${runtime.statusTone}">
      <div>
        <div class="runtime-strip-label">System Route</div>
        <strong>${runtime.headline}</strong>
        <div class="runtime-strip-subtext">${runtime.dependencySummary}</div>
        <div class="runtime-strip-subtext">${buildStampLabel}</div>
        ${runtimeMarker}
        <div class="runtime-strip-subtext">Preferred target: ${runtime.preferredTarget || 'n/a'} · Actual target: ${runtime.actualTargetUsed || 'n/a'}</div>
        ${runtime.routeForensics?.firstBadTransition
    ? `<div class="runtime-strip-subtext">Forensic boundary: ${runtime.routeForensics.firstBadTransition}</div>`
    : ''}
      </div>
      <div class="runtime-chip-row">
        <span class="runtime-chip ${runtime.backendAvailable ? 'ready' : 'degraded'}">Backend ${runtime.backendAvailable ? 'Online' : 'Offline'}</span>
        <span class="runtime-chip ${runtime.cloudRouteReachable ? 'ready' : 'degraded'}">Cloud Route ${runtime.cloudRouteReachable ? 'Ready' : 'Offline'}</span>
        <span class="runtime-chip ${runtime.localNodeReachable ? 'ready' : 'degraded'}">Local Node ${runtime.localNodeReachable ? 'Ready' : 'Offline'}</span>
        <span class="runtime-chip neutral">Route ${runtime.routeKind}</span>
        <span class="runtime-chip neutral">Source ${runtime.nodeAddressSource}</span>
      </div>
    </div>
  `;
}

function renderMobileCompanionDeck(projects, context) {
  const deck = ensureStatusSurface('mobile-companion-deck', 'mobile-companion-deck');
  if (!deck) return;

  const safeProjects = projects.map(normaliseProject);
  const stephanos = safeProjects.find((project) => String(project.name || '').toLowerCase().includes('stephanos'));
  const runtime = stephanos?.runtimeStatusModel;

  if (!runtime || runtime.appLaunchState === 'unavailable') {
    deck.innerHTML = '';
    return;
  }

  deck.innerHTML = `
    <div class="companion-deck-card ${runtime.statusTone}">
      <div>
        <div class="runtime-strip-label">Companion Deck</div>
        <strong>${runtime.headline}</strong>
        <p>${runtime.dependencySummary}</p>
        <p>Preferred target: ${runtime.preferredTarget || 'n/a'}</p>
      </div>
      <div class="runtime-chip-row">
        <span class="runtime-chip neutral">Route ${runtime.routeKind}</span>
        <span class="runtime-chip neutral">Source ${runtime.nodeAddressSource}</span>
      </div>
      <button type="button" class="companion-launch-button">Open Stephanos</button>
    </div>
  `;

  const button = deck.querySelector('.companion-launch-button');
  if (button && stephanos?.entry) {
    button.onclick = () => launchProject(stephanos, context, { type: 'user-click', origin: 'companion-launch-button' });
  }
}


function syncTileRegistrySnapshots(projects) {
  projects
    .map(normaliseProject)
    .forEach((project) => {
      const tileId = String(project?.id || project?.folder || project?.name || '')
        .trim()
        .toLowerCase();

      if (!tileId) {
        return;
      }

      publishTileContextSnapshot(tileId, {
        tileTitle: project.name || 'Unnamed Project',
        projectName: project.name || 'Unnamed Project',
        route: project.entry || '',
        launchStrategy: project.launchStrategy || 'workspace',
        dependencyState: project.dependencyState || 'ready',
        validationState: project.validationState || (project.disabled ? 'error' : 'healthy'),
      });
    });
}

function createProjectRegistryRenderSignature(projects, options = {}) {
  const safeProjects = (Array.isArray(projects) ? projects : []).map(normaliseProject);
  const renderState = safeProjects.map((project) => {
    const isStephanos = isStephanosProject(project);
    const hasLaunchTarget = isStephanos
      ? Boolean(resolveStephanosLaunchTarget(project))
      : Boolean(String(project.entry || '').trim());
    const launchInProgress = project.validationState === 'launching';
    const launchError = project.validationState === 'error';
    const launchableWhilePending = launchInProgress && hasLaunchTarget;
    const launchableWhileErrored = launchError && hasLaunchTarget;
    const blockLaunch = !hasLaunchTarget || (launchInProgress && !launchableWhilePending);

    return {
      id: String(project?.id || project?.folder || project?.name || '').trim().toLowerCase(),
      name: project.name,
      icon: project.icon,
      validationState: project.validationState,
      statusMessage: project.statusMessage,
      validationIssue: project.validationIssues?.[0] || '',
      dependencyState: project.dependencyState,
      runtimeDetail: {
        dependencySummary: project.runtimeStatusModel?.dependencySummary || '',
        preferredTarget: project.runtimeStatusModel?.preferredTarget || '',
        forensicBoundary: project.runtimeStatusModel?.routeForensics?.firstBadTransition || '',
      },
      buildStampLabel: project.buildStampLabel,
      buildMarker: project.buildMarker,
      launchFlags: {
        blockLaunch,
        launchError,
        launchableWhileErrored,
        launchInProgress,
      },
    };
  });

  return JSON.stringify({
    enableSecondaryStatusSurfaces: options?.enableSecondaryStatusSurfaces === true,
    projects: renderState,
  });
}

export function renderProjectRegistry(projects, context, options = {}) {
  const container = document.getElementById('project-registry');
  if (!container) {
    console.error('Command Deck: #project-registry not found');
    return;
  }

  const nextSignature = createProjectRegistryRenderSignature(projects, options);
  if (container.__commandDeckRenderSignature === nextSignature) {
    return;
  }
  container.__commandDeckRenderSignature = nextSignature;
  container.innerHTML = '';
  syncTileRegistrySnapshots(projects);

  const enableSecondaryStatusSurfaces = options?.enableSecondaryStatusSurfaces === true;
  if (enableSecondaryStatusSurfaces) {
    renderLauncherStatusStrip(projects, context);
    renderMobileCompanionDeck(projects, context);
  }

  projects.forEach((project) => {
    const safeProject = normaliseProject(project);
    const tile = document.createElement('div');
    const isStephanos = isStephanosProject(safeProject);
    const hasLaunchTarget = isStephanos
      ? Boolean(resolveStephanosLaunchTarget(safeProject))
      : Boolean(String(safeProject.entry || '').trim());
    const launchInProgress = safeProject.validationState === 'launching';
    const launchError = safeProject.validationState === 'error';
    const launchableWhilePending = launchInProgress && hasLaunchTarget;
    const launchableWhileErrored = launchError && hasLaunchTarget;
    const blockLaunch = !hasLaunchTarget
      || (launchInProgress && !launchableWhilePending);

    tile.className = 'app-tile';

    if (launchError) {
      tile.classList.add('app-tile-error');
      if (launchableWhileErrored) {
        tile.classList.add('app-tile-error-launchable');
      }
    } else if (safeProject.validationState === 'launching') {
      tile.classList.add('app-tile-pending');
    } else if (safeProject.dependencyState === 'degraded') {
      tile.classList.add('app-tile-degraded');
    }

    const runtimeSummary = safeProject.runtimeStatusModel?.dependencySummary;
    const forensicBoundary = safeProject.runtimeStatusModel?.routeForensics?.firstBadTransition;
    const runtimeDetail = safeProject.runtimeStatusModel?.preferredTarget
      ? `${runtimeSummary || ''}${runtimeSummary ? ' · ' : ''}${safeProject.runtimeStatusModel.preferredTarget}${forensicBoundary ? ` · forensic=${forensicBoundary}` : ''}`
      : `${runtimeSummary || ''}${forensicBoundary ? `${runtimeSummary ? ' · ' : ''}forensic=${forensicBoundary}` : ''}`;
    const issueLabel = safeProject.validationState === 'error' || safeProject.validationState === 'launching'
      ? `<div class="app-tile-issue">${safeProject.statusMessage || safeProject.validationIssues[0] || 'App status unavailable'}</div>`
      : runtimeDetail
        ? `<div class="app-tile-detail">${runtimeDetail}</div>`
        : '';

    tile.innerHTML = `
      <div style="font-size:36px;">${safeProject.icon}</div>
      <div style="margin-top:8px;">${safeProject.name}</div>
      ${issueLabel}
    `;

    if (blockLaunch) {
      tile.title = safeProject.statusMessage || safeProject.validationIssues.join('\n') || 'App status unavailable';
      tile.setAttribute('aria-disabled', 'true');
    } else {
      if (launchInProgress) {
        tile.classList.add('app-tile-pending-launchable');
      }
      tile.title = runtimeDetail || safeProject.statusMessage || safeProject.name;
      tile.onclick = () => launchProject(safeProject, context, { type: 'user-click', origin: 'app-tile' });
    }

    container.appendChild(tile);
  });

  hardenProjectRegistryHitTargets(container);
}

export const moduleDefinition = {
  id: 'command-deck',
  version: '1.0',
  description: 'Renders project tiles and routes launches into the workspace runtime.',
};

let cleanupSimulationStart = null;
let cleanupAppInstalled = null;
let cleanupStatusChanged = null;
let cleanupValidationPassed = null;
let cleanupValidationFailed = null;
let cleanupAppRepaired = null;
let lastLoggedBuildStamp = null;

export function init(context) {
  const initialProjects = getRuntimeProjects(context);
  renderProjectRegistry(initialProjects, context);
  const stephanos = initialProjects.map(normaliseProject).find((project) => String(project.name || '').toLowerCase().includes('stephanos'));
  const currentBuildStamp = stephanos?.buildStamp || 'unknown';
  if (lastLoggedBuildStamp !== currentBuildStamp) {
    console.info(`[Stephanos] Build stamp: ${currentBuildStamp}`);
    lastLoggedBuildStamp = currentBuildStamp;
  }

  cleanupSimulationStart = context.eventBus.on('simulation:start', (simulationName) => {
    const normalized = String(simulationName || '').trim().toLowerCase();
    const projects = getRuntimeProjects(context);

    const project = projects.find((projectItem) => {
      const name = String(projectItem?.name || '').trim().toLowerCase();
      return (
        name === normalized ||
        name.replace(/\s+/g, '') === normalized.replace(/\s+/g, '')
      );
    });

    if (!project && normalized === 'wealth') {
      const wealthProject = projects.find((projectItem) =>
        String(projectItem?.name || '').trim().toLowerCase() === 'wealth app'
      );

      if (wealthProject && !wealthProject?.disabled) {
        launchProject(normaliseProject(wealthProject), context, { type: 'event-bus', origin: 'simulation:start', simulationName });
      }

      return;
    }

    if (project && !project?.disabled) {
      launchProject(normaliseProject(project), context, { type: 'event-bus', origin: 'simulation:start', simulationName });
    }
  });

  cleanupAppInstalled = context.eventBus.on('app:installed', () => {
    renderProjectRegistry(
      context.systemState.get('projects') || context.projects,
      context,
    );
  });

  cleanupStatusChanged = context.eventBus.on('app:status_changed', () => {
    const projects = getRuntimeProjects(context);
    renderProjectRegistry(projects, context);
    const stephanos = projects.map(normaliseProject).find((project) => String(project.name || '').toLowerCase().includes('stephanos'));
    const currentBuildStamp = stephanos?.buildStamp || 'unknown';
    if (lastLoggedBuildStamp !== currentBuildStamp) {
      console.info(`[Stephanos] Build stamp: ${currentBuildStamp}`);
      lastLoggedBuildStamp = currentBuildStamp;
    }
  });

  cleanupValidationPassed = context.eventBus.on('app:validation_passed', () => {
    renderProjectRegistry(getRuntimeProjects(context), context);
  });

  cleanupValidationFailed = context.eventBus.on('app:validation_failed', () => {
    renderProjectRegistry(getRuntimeProjects(context), context);
  });

  cleanupAppRepaired = context.eventBus.on('app:repaired', () => {
    renderProjectRegistry(getRuntimeProjects(context), context);
  });
}

export function dispose() {
  if (typeof cleanupSimulationStart === 'function') {
    cleanupSimulationStart();
    cleanupSimulationStart = null;
  }

  if (typeof cleanupAppInstalled === 'function') {
    cleanupAppInstalled();
    cleanupAppInstalled = null;
  }

  if (typeof cleanupStatusChanged === 'function') {
    cleanupStatusChanged();
    cleanupStatusChanged = null;
  }

  if (typeof cleanupValidationPassed === 'function') {
    cleanupValidationPassed();
    cleanupValidationPassed = null;
  }

  if (typeof cleanupValidationFailed === 'function') {
    cleanupValidationFailed();
    cleanupValidationFailed = null;
  }

  if (typeof cleanupAppRepaired === 'function') {
    cleanupAppRepaired();
    cleanupAppRepaired = null;
  }
}
