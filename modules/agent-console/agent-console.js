export const moduleDefinition = {
  id: "agent-console",
  version: "1.0",
  description: "Stephanos Agent Console"
};

export function init(context) {
  const ui = context.services.getService("ui");

  const panel = ui.createPanel(
    "agent-console-panel",
    "Stephanos Agents"
  );

  const registry = context.services.getService("agentRegistry");

  const list = document.createElement("div");

  registry.listAgents().forEach((agent) => {
    const entry = document.createElement("div");
    entry.textContent = agent;

    list.appendChild(entry);
  });

  panel.appendChild(list);
}

export function dispose(context) {
  const ui = context.services.getService("ui");
  ui.removePanel("agent-console-panel");
}
