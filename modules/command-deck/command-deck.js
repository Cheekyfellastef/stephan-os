function normaliseProject(project) {
  if (typeof project === "string") {
    return {
      name: project,
      icon: "🧩",
      entry: "",
      disabled: false,
      validationIssues: []
    };
  }

  return {
    name: project?.name || "Unnamed Project",
    icon: project?.icon || "🧩",
    entry: project?.entry || "",
    disabled: Boolean(project?.disabled),
    validationIssues: Array.isArray(project?.validationIssues) ? project.validationIssues : []
  };
}

function getRuntimeProjects(context) {
  const projects =
    context.systemState.get("projects")?.length
      ? context.systemState.get("projects")
      : context.projects;

  return Array.isArray(projects) ? projects : [];
}

function renderProjectRegistry(projects, context) {
  const container = document.getElementById("project-registry");
  if (!container) {
    console.error("Command Deck: #project-registry not found");
    return;
  }

  container.innerHTML = "";

  projects.forEach((project) => {
    const safeProject = normaliseProject(project);
    const tile = document.createElement("div");

    tile.className = "app-tile";

    if (safeProject.disabled) {
      tile.classList.add("app-tile-error");
    }

    const issueLabel = safeProject.disabled
      ? `<div class="app-tile-issue">${safeProject.validationIssues[0] || "App failed validation"}</div>`
      : "";

    tile.innerHTML = `
      <div style="font-size:36px;">${safeProject.icon}</div>
      <div style="margin-top:8px;">${safeProject.name}</div>
      ${issueLabel}
    `;

    if (safeProject.disabled) {
      tile.title = safeProject.validationIssues.join("\n") || "App failed validation";
      tile.setAttribute("aria-disabled", "true");
    } else {
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
}
