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

<h3>Stephanos System</h3>

<label>
Modules
<input type="checkbox"
  onchange="togglePanel('module-manager-panel')">
</label><br><br>

<label>
Agents
<input type="checkbox"
  onchange="togglePanel('agent-console-panel')">
</label><br><br>

<label>
Console
<input type="checkbox"
  onchange="togglePanel('command-console-panel')">
</label><br><br>

<label>
Task Monitor
<input type="checkbox"
  onchange="togglePanel('task-monitor-panel')">
</label><br><br>

<label>
Debug Console
<input type="checkbox"
  onchange="togglePanel('dev-console')">
</label>

<hr>

<button onclick="openSystemPanel()">
Close Panel
</button>

  `;

  document.body.appendChild(panel);

  window.openSystemPanel = function() {
    panel.style.display =
      panel.style.display === "none" ? "block" : "none";
  };
}

export function dispose() {
  const panel = document.getElementById("stephanos-system-panel");

  if (panel) panel.remove();
}
