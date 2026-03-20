function normaliseProject(project) {
  if (typeof project === "string") {
    return {
      name: project,
      icon: "🧩",
      entry: "",
      disabled: false,
      validationIssues: [],
      dependencyState: "ready",
      runtimeStatusModel: null,
    };
  }

  return {
    name: project?.name || "Unnamed Project",
    icon: project?.icon || "🧩",
    entry: project?.entry || "",
    disabled: Boolean(project?.disabled),
    validationState: project?.validationState || (project?.disabled ? "error" : "healthy"),
    statusMessage: project?.statusMessage || "",
    validationIssues: Array.isArray(project?.validationIssues) ? project.validationIssues : [],
    dependencyState: project?.dependencyState || "ready",
    runtimeStatusModel: project?.runtimeStatusModel || null,
  };
}

function getRuntimeProjects(context) {
  const projects =
    context.systemState.get("projects")?.length
      ? context.systemState.get("projects")
      : context.projects;

  return Array.isArray(projects) ? projects : [];
}

function ensureStatusSurface(containerId, className = "") {
  let node = document.getElementById(containerId);
  if (node) {
    return node;
  }

  const projectsSection = document.getElementById("projects");
  if (!projectsSection) {
    return null;
  }

  node = document.createElement("section");
  node.id = containerId;
  node.className = className;
  projectsSection.insertBefore(node, projectsSection.querySelector("#project-registry"));
  return node;
}

function renderLauncherStatusStrip(projects, context) {
  const strip = ensureStatusSurface("launcher-runtime-strip", "launcher-runtime-strip");
  if (!strip) return;

  const stephanos = projects.map(normaliseProject).find((project) => String(project.name || "").toLowerCase().includes("stephanos"));
  const runtime = stephanos?.runtimeStatusModel;

  if (!runtime) {
    strip.innerHTML = "";
    return;
  }

  strip.innerHTML = `
    <div class="runtime-strip-card ${runtime.statusTone}">
      <div>
        <div class="runtime-strip-label">System Route</div>
        <strong>${runtime.headline}</strong>
        <div class="runtime-strip-subtext">${runtime.dependencySummary}</div>
      </div>
      <div class="runtime-chip-row">
        <span class="runtime-chip ${runtime.backendAvailable ? 'ready' : 'degraded'}">Backend ${runtime.backendAvailable ? 'Online' : 'Offline'}</span>
        <span class="runtime-chip ${runtime.cloudAvailable ? 'ready' : 'degraded'}">Cloud AI ${runtime.cloudAvailable ? 'Ready' : 'Not Configured'}</span>
        <span class="runtime-chip ${runtime.localAvailable ? 'ready' : 'degraded'}">Local Node ${runtime.localAvailable ? 'Ready' : 'Offline'}</span>
        <span class="runtime-chip neutral">Active ${runtime.activeProvider}</span>
      </div>
    </div>
  `;
}

function renderMobileCompanionDeck(projects, context) {
  const deck = ensureStatusSurface("mobile-companion-deck", "mobile-companion-deck");
  if (!deck) return;

  const safeProjects = projects.map(normaliseProject);
  const stephanos = safeProjects.find((project) => String(project.name || "").toLowerCase().includes("stephanos"));
  const runtime = stephanos?.runtimeStatusModel;

  if (!runtime || runtime.appLaunchState === "unavailable") {
    deck.innerHTML = "";
    return;
  }

  deck.innerHTML = `
    <div class="companion-deck-card ${runtime.statusTone}">
      <div>
        <div class="runtime-strip-label">Companion Deck</div>
        <strong>${runtime.headline}</strong>
        <p>${runtime.dependencySummary}</p>
      </div>
      <div class="runtime-chip-row">
        <span class="runtime-chip neutral">Mode ${runtime.providerMode}</span>
        <span class="runtime-chip neutral">Route ${runtime.activeProvider}</span>
      </div>
      <button type="button" class="companion-launch-button">Open Stephanos</button>
    </div>
  `;

  const button = deck.querySelector(".companion-launch-button");
  if (button && stephanos?.entry) {
    button.onclick = () => context.workspace.open(stephanos, context);
  }
}

function renderProjectRegistry(projects, context) {
  const container = document.getElementById("project-registry");
  if (!container) {
    console.error("Command Deck: #project-registry not found");
    return;
  }

  container.innerHTML = "";
  renderLauncherStatusStrip(projects, context);
  renderMobileCompanionDeck(projects, context);

  projects.forEach((project) => {
    const safeProject = normaliseProject(project);
    const tile = document.createElement("div");

    tile.className = "app-tile";

    if (safeProject.validationState === "error") {
      tile.classList.add("app-tile-error");
    } else if (safeProject.validationState === "launching") {
      tile.classList.add("app-tile-pending");
    } else if (safeProject.dependencyState === "degraded") {
      tile.classList.add("app-tile-degraded");
    }

    const runtimeSummary = safeProject.runtimeStatusModel?.dependencySummary;
    const issueLabel = safeProject.validationState === "error" || safeProject.validationState === "launching"
      ? `<div class="app-tile-issue">${safeProject.statusMessage || safeProject.validationIssues[0] || "App status unavailable"}</div>`
      : runtimeSummary
        ? `<div class="app-tile-detail">${runtimeSummary}</div>`
        : "";

    tile.innerHTML = `
      <div style="font-size:36px;">${safeProject.icon}</div>
      <div style="margin-top:8px;">${safeProject.name}</div>
      ${issueLabel}
    `;

    if (safeProject.validationState === "error" || safeProject.validationState === "launching") {
      tile.title = safeProject.statusMessage || safeProject.validationIssues.join("\n") || "App status unavailable";
      tile.setAttribute("aria-disabled", "true");
    } else {
      tile.title = runtimeSummary || safeProject.statusMessage || safeProject.name;
      tile.onclick = () => context.workspace.open(safeProject, context);
    }

    container.appendChild(tile);
  });
}

export const moduleDefinition = {
  id: "command-deck",
  version: "1.0",
  description: "Renders project tiles and routes launches into the workspace runtime."
};

let cleanupSimulationStart = null;
let cleanupAppInstalled = null;
let cleanupStatusChanged = null;
let cleanupValidationPassed = null;
let cleanupValidationFailed = null;
let cleanupAppRepaired = null;

export function init(context) {
  renderProjectRegistry(getRuntimeProjects(context), context);

  cleanupSimulationStart = context.eventBus.on("simulation:start", (simulationName) => {
    const normalized = String(simulationName || "").trim().toLowerCase();
    const projects = getRuntimeProjects(context);

    const project = projects.find((projectItem) => {
      const name = String(projectItem?.name || "").trim().toLowerCase();
      return (
        name === normalized ||
        name.replace(/\s+/g, "") === normalized.replace(/\s+/g, "")
      );
    });

    if (!project && normalized === "wealth") {
      const wealthProject = projects.find((projectItem) =>
        String(projectItem?.name || "").trim().toLowerCase() === "wealth app"
      );

      if (wealthProject && !wealthProject?.disabled) {
        context.workspace.open(normaliseProject(wealthProject), context);
      }

      return;
    }

    if (project && !project?.disabled) {
      context.workspace.open(normaliseProject(project), context);
    }
  });

  cleanupAppInstalled = context.eventBus.on("app:installed", () => {
    renderProjectRegistry(
      context.systemState.get("projects") || context.projects,
      context
    );
  });

  cleanupStatusChanged = context.eventBus.on("app:status_changed", () => {
    renderProjectRegistry(getRuntimeProjects(context), context);
  });

  cleanupValidationPassed = context.eventBus.on("app:validation_passed", () => {
    renderProjectRegistry(getRuntimeProjects(context), context);
  });

  cleanupValidationFailed = context.eventBus.on("app:validation_failed", () => {
    renderProjectRegistry(getRuntimeProjects(context), context);
  });

  cleanupAppRepaired = context.eventBus.on("app:repaired", () => {
    renderProjectRegistry(getRuntimeProjects(context), context);
  });
}

export function dispose() {
  if (typeof cleanupSimulationStart === "function") {
    cleanupSimulationStart();
    cleanupSimulationStart = null;
  }

  if (typeof cleanupAppInstalled === "function") {
    cleanupAppInstalled();
    cleanupAppInstalled = null;
  }

  if (typeof cleanupStatusChanged === "function") {
    cleanupStatusChanged();
    cleanupStatusChanged = null;
  }

  if (typeof cleanupValidationPassed === "function") {
    cleanupValidationPassed();
    cleanupValidationPassed = null;
  }

  if (typeof cleanupValidationFailed === "function") {
    cleanupValidationFailed();
    cleanupValidationFailed = null;
  }

  if (typeof cleanupAppRepaired === "function") {
    cleanupAppRepaired();
    cleanupAppRepaired = null;
  }
}
