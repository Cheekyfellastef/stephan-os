export function createUIRenderer() {
  return {
    createPanel(id, title) {
      let panel = document.getElementById(id);

      if (!panel) {
        panel = document.createElement("div");
        panel.id = id;

        panel.innerHTML = `<h3>${title}</h3>`;

        document.body.appendChild(panel);
      }

      panel.classList.add("stephanos-panel");

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
