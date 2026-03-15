export const workspace = {
  open(project, context = {}) {
    const workspacePanel = document.getElementById("workspace");
    const content = document.getElementById("workspace-content");
    const projectsPanel = document.getElementById("projects");
    const title = document.getElementById("workspace-title");

    if (!workspacePanel || !content || !projectsPanel || !title) {
      console.error("Workspace UI is missing required elements");
      return;
    }

    workspacePanel.style.display = "block";
    projectsPanel.style.display = "none";

    title.textContent = project?.name || "Workspace";

    if (project?.entry) {
      content.innerHTML = `<iframe src="${project.entry}" width="100%" height="600" style="border:0;"></iframe>`;
    } else {
      content.textContent = `Workspace for ${project?.name || "project"}`;
    }

    context?.eventBus?.emit("workspace:opened", project);
  }
};
