function normaliseProject(project) {
  if (typeof project === "string") {
    return {
      name: project,
      icon: "🧩",
      entry: ""
    };
  }

  return {
    name: project?.name || "Unnamed Project",
    icon: project?.icon || "🧩",
    entry: project?.entry || ""
  };
}

export function init(context) {
  const container = document.getElementById("project-registry");
  if (!container) {
    console.error("Command Deck: #project-registry not found");
    return;
  }

  container.innerHTML = "";

  const projects = Array.isArray(context?.projects) ? context.projects : [];

  projects.forEach((project) => {
    const safeProject = normaliseProject(project);
    const tile = document.createElement("div");

    tile.className = "app-tile";
    tile.innerHTML = `
      <div style="font-size:36px;">${safeProject.icon}</div>
      <div style="margin-top:8px;">${safeProject.name}</div>
    `;

    tile.onclick = () => context.workspace.open(safeProject);
    container.appendChild(tile);
  });
}
