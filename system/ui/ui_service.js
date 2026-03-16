export function createUIRenderer() {

  return {

    createPanel(id, title) {

      let panel = document.getElementById(id);

      if (!panel) {

        panel = document.createElement("div");

        panel.classList.add("stephanos-panel");

        panel.id = id;

        panel.style.position = "fixed";
        panel.style.right = "20px";
        panel.style.top = "80px";

        const header = document.createElement("div");

        header.textContent = title;

        header.style.fontWeight = "bold";
        header.style.marginBottom = "8px";

        panel.appendChild(header);

        document.body.appendChild(panel);

      }

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
