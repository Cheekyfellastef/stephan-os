let panelOffset = 0;
const panelOrder = [];

function layoutPanels() {
  panelOffset = 0;

  panelOrder.forEach((id) => {
    const panel = document.getElementById(id);
    if (!panel) {
      return;
    }

    panel.style.top = `${80 + panelOffset}px`;
    panel.style.right = "20px";

    panelOffset += 220;
  });
}

export function createUIRenderer() {
  return {
    createPanel(id, title) {
      let panel = document.getElementById(id);
      let content = null;

      if (!panel) {
        panel = document.createElement("div");
        panel.id = id;

        const heading = document.createElement("h3");
        heading.textContent = title;
        panel.appendChild(heading);

        content = document.createElement("div");
        content.classList.add("stephanos-panel-content");
        panel.appendChild(content);

        document.body.appendChild(panel);
        panelOrder.push(id);
      } else {
        content = panel.querySelector(":scope > .stephanos-panel-content");

        if (!content) {
          content = document.createElement("div");
          content.classList.add("stephanos-panel-content");
          panel.appendChild(content);
        }

        if (!panelOrder.includes(id)) {
          panelOrder.push(id);
        }
      }

      panel.classList.add("stephanos-panel");
      layoutPanels();

      return content;
    },

    removePanel(id) {
      const panel = document.getElementById(id);

      if (panel) {
        panel.remove();
      }

      const index = panelOrder.indexOf(id);
      if (index !== -1) {
        panelOrder.splice(index, 1);
      }

      layoutPanels();
    }
  };
}
