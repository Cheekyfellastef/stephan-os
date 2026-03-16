export const workspace = {
  async open(project, context = {}) {
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

    if (project?.entry && project.entry.endsWith(".md")) {
      const response = await fetch(project.entry);
      const text = await response.text();
      const container = document.createElement("div");

      container.style.whiteSpace = "pre-wrap";
      container.style.wordWrap = "break-word";
      container.style.maxHeight = "70vh";
      container.style.overflowY = "auto";
      container.style.padding = "20px";
      container.style.background = "#111";
      container.style.color = "#0f0";
      container.style.fontFamily = "monospace";
      container.style.borderRadius = "8px";

      container.textContent = text;
      content.innerHTML = "";

      // TOP LEFT BACK BUTTON
      const backTop = document.createElement("button");
      backTop.textContent = "← Back";
      backTop.style.display = "block";
      backTop.style.marginBottom = "10px";

      backTop.onclick = () => {
        document.getElementById("workspace").style.display = "none";
        document.getElementById("projects").style.display = "block";
      };

      // BOTTOM LEFT BACK BUTTON
      const backBottom = document.createElement("button");
      backBottom.textContent = "← Back";
      backBottom.style.display = "block";
      backBottom.style.marginTop = "15px";

      backBottom.onclick = () => {
        document.getElementById("workspace").style.display = "none";
        document.getElementById("projects").style.display = "block";
      };

      content.appendChild(backTop);
      content.appendChild(container);
      content.appendChild(backBottom);

      return;
    } else if (project?.entry) {
      content.innerHTML = "";

      const backButton = document.createElement("button");
      backButton.textContent = "◀ Return to Command Deck";
      backButton.style.marginBottom = "10px";
      backButton.onclick = () => {
        window.returnToCommandDeck();
      };

      const iframe = document.createElement("iframe");
      iframe.src = project.entry;
      iframe.style.width = "100%";
      iframe.style.height = "700px";
      iframe.style.border = "none";

      content.appendChild(backButton);
      content.appendChild(iframe);
    } else {
      content.textContent = `Workspace for ${project?.name || "project"}`;
    }

    context?.eventBus?.emit("workspace:opened", project);
  },

  close(context = {}) {
    const workspacePanel = document.getElementById("workspace");
    const projectsPanel = document.getElementById("projects");

    if (!workspacePanel || !projectsPanel) {
      console.error("Workspace UI is missing required elements");
      return;
    }

    workspacePanel.style.display = "none";
    projectsPanel.style.display = "block";

    context?.eventBus?.emit("workspace:closed");
  }
};
