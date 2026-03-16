export const moduleDefinition = {
  id: "system-panel",
  version: "1.0",
  description: "Stephanos system control panel"
};

export function init(context) {
  let panel = document.getElementById("stephanos-system-panel");

  if (panel) return;

  panel = document.createElement("div");

  panel.id = "stephanos-system-panel";

  panel.style.position = "fixed";
  panel.style.top = "50%";
  panel.style.left = "50%";
  panel.style.transform = "translate(-50%, -50%)";

  panel.style.background = "#111";
  panel.style.border = "1px solid #333";
  panel.style.borderRadius = "8px";

  panel.style.padding = "20px";

  panel.style.width = "320px";

  panel.style.zIndex = "5000";

  panel.style.display = "none";

  panel.innerHTML = `
    <h3 style="margin-top:0">Stephanos System</h3>

    <button id="dev-toggle">Toggle Developer Mode</button><br><br>

    <button id="debug-toggle">Toggle Debug Console</button><br><br>

    <button id="reload-stephanos">Reload Stephanos</button><br><br>

    <button id="exit-stephanos">Exit to Browser</button>
  `;

  document.body.appendChild(panel);

  document.getElementById("dev-toggle").onclick = () => {
    const current = window.isDeveloperModeEnabled?.() ?? false;

    window.toggleDeveloperMode?.(!current);
  };

  document.getElementById("debug-toggle").onclick = () => {
    const debug = document.getElementById("dev-console");

    if (!debug) return;

    debug.style.display =
      debug.style.display === "none" ? "block" : "none";
  };

  document.getElementById("reload-stephanos").onclick = () => {
    location.reload();
  };

  document.getElementById("exit-stephanos").onclick = () => {
    window.location.href = "/";
  };

  window.openSystemPanel = function() {
    panel.style.display =
      panel.style.display === "none" ? "block" : "none";
  };
}

export function dispose() {
  const panel = document.getElementById("stephanos-system-panel");

  if (panel) panel.remove();
}
