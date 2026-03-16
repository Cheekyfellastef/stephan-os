export function createUIRenderer() {

  return {

    createPanel(id, title) {

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

        const leftModules = [
          "command-console-panel",
          "task-monitor-panel"
        ];

        const left = document.getElementById("left-column");
        const right = document.getElementById("right-column");

        if (leftModules.includes(id)) {
          left.appendChild(panel);
        } else {
          right.appendChild(panel);
        }

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
