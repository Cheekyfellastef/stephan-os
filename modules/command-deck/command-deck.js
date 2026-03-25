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
    buildStamp: project?.buildStamp || 'unknown',
    buildStampLabel: project?.buildStampLabel || 'Stephanos Build: unknown',
    buildMarker: project?.buildMarker || '',
  };
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

  const projectsSection = document.getElementById('projects');
  if (!projectsSection) {
    return null;
  }

  node = document.createElement('section');
  node.id = containerId;
  node.className = className;
  projectsSection.insertBefore(node, projectsSection.querySelector('#project-registry'));
  return node;
}

function launchProject(project, context) {
  if (!project?.entry) {
    return;
  }

  if (project.launchStrategy === 'navigate') {
    window.location.href = project.entry;
    return;
  }

  context.workspace.open(project, context);
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
    button.onclick = () => launchProject(stephanos, context);
  }
}

function renderProjectRegistry(projects, context) {
  const container = document.getElementById('project-registry');
  if (!container) {
    console.error('Command Deck: #project-registry not found');
    return;
  }

  container.innerHTML = '';
  renderLauncherStatusStrip(projects, context);
  renderMobileCompanionDeck(projects, context);

  projects.forEach((project) => {
    const safeProject = normaliseProject(project);
    const tile = document.createElement('div');

    tile.className = 'app-tile';

    if (safeProject.validationState === 'error') {
      tile.classList.add('app-tile-error');
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

    if (safeProject.validationState === 'error' || safeProject.validationState === 'launching') {
      tile.title = safeProject.statusMessage || safeProject.validationIssues.join('\n') || 'App status unavailable';
      tile.setAttribute('aria-disabled', 'true');
    } else {
      tile.title = runtimeDetail || safeProject.statusMessage || safeProject.name;
      tile.onclick = () => launchProject(safeProject, context);
    }

    container.appendChild(tile);
  });
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
        launchProject(normaliseProject(wealthProject), context);
      }

      return;
    }

    if (project && !project?.disabled) {
      launchProject(normaliseProject(project), context);
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
