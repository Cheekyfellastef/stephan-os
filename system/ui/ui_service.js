export function createUIRenderer() {

  function ensurePanelContainer(documentRef = document) {

    let container = documentRef.getElementById("stephanos-panel-stack");

    if (container) {
      return container;
    }

    container = documentRef.createElement("div");

    container.id = "stephanos-panel-stack";
    container.style.display = "none";
    container.style.flexDirection = "column";
    container.style.gap = "10px";

    const workspacePanel = documentRef.getElementById("workspace");
    const layout = documentRef.getElementById("stephanos-layout");

    if (layout?.parentNode) {
      layout.parentNode.insertBefore(container, layout);
    } else if (workspacePanel?.parentNode) {
      workspacePanel.parentNode.insertBefore(container, workspacePanel.nextSibling);
    } else {
      documentRef.body.appendChild(container);
    }

    return container;

  }

  return {

    createPanel(id, title) {

      const container = ensurePanelContainer();

      let panel = document.getElementById(id);

      if (!panel) {

        panel = document.createElement("div");

        panel.classList.add("stephanos-panel");

        panel.id = id;

        const header = document.createElement("div");

        header.textContent = title;

        header.style.fontWeight = "bold";
        header.style.marginBottom = "8px";

        panel.appendChild(header);

        container.appendChild(panel);

      }

      panel.style.display = "none";

      return panel;

    },

    removePanel(id) {

      const panel = document.getElementById(id);

      if (panel) {
        panel.remove();
      }

    }

  };

}
