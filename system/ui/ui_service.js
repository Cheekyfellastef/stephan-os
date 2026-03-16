export function createUIRenderer() {

  return {

    createPanel(id, title) {

      let container = document.getElementById("stephanos-panel-stack");

      if (!container) {

        container = document.createElement("div");

        container.id = "stephanos-panel-stack";

        container.style.position = "fixed";
        container.style.top = "80px";
        container.style.right = "20px";

        container.style.display = "flex";
        container.style.flexDirection = "column";

        container.style.gap = "10px";

        container.style.zIndex = "2000";

        document.body.appendChild(container);

      }

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
