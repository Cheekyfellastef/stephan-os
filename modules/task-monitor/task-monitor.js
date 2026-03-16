export const moduleDefinition = {
  id: "task-monitor",
  version: "1.0",
  description: "Stephanos Task Monitor"
};

export function init(context) {
  const ui = context.services.getService("ui");

  const panel = ui.createPanel(
    "task-monitor-panel",
    "Stephanos Tasks"
  );

  const log = document.createElement("div");

  panel.appendChild(log);

  context.eventBus.on("task:completed", (taskId) => {
    const entry = document.createElement("div");
    entry.textContent = "Task completed: " + taskId;

    log.prepend(entry);
  });
}

export function dispose(context) {
  const ui = context.services.getService("ui");
  ui.removePanel("task-monitor-panel");
}
