export const moduleDefinition = {
  id: "command-console",
  version: "1.0",
  description: "Stephanos Command Console"
};

export function init(context) {
  const ui = context.services.getService("ui");

  const panel = ui.createPanel(
    "command-console-panel",
    "Stephanos Console"
  );

  const output = document.createElement("div");
  output.id = "console-output";

  const input = document.createElement("input");
  input.id = "console-input";
  input.placeholder = "Enter command...";

  panel.appendChild(output);
  panel.appendChild(input);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const command = input.value.trim();

      if (!command) return;

      console.log("Console emitted command:", command);

      context.eventBus.emit("console:command", {
        text: command
      });

      executeCommand(command, context, output);

      input.value = "";
    }
  });
}

function executeCommand(command, context, output) {
  const parts = command.split(" ");

  const cmd = parts[0];

  if (cmd === "help") {
    log(output, "Commands:");
    log(output, "list modules");
    log(output, "list agents");
    log(output, "list services");

    return;
  }

  if (cmd === "list") {
    const target = parts[1];

    if (target === "modules") {
      const modules = context.activeModules || [];

      modules.forEach((m) => {
        log(output, m.moduleDefinition.id);
      });
    }

    if (target === "agents") {
      const registry = context.services.getService("agentRegistry");

      registry.listAgents().forEach((agent) => {
        log(output, agent);
      });
    }

    if (target === "services") {
      const services = context.services.listServices();

      services.forEach((s) => {
        log(output, s);
      });
    }

    return;
  }

  if (cmd === "start") {
    const simulation = parts[1];

    context.eventBus.emit("simulation:start", simulation);

    log(output, "Starting simulation: " + simulation);

    return;
  }

  log(output, "Unknown command: " + command);
}

function log(output, text) {
  const line = document.createElement("div");

  line.textContent = text;

  output.appendChild(line);
}

export function dispose(context) {
  const ui = context.services.getService("ui");

  ui.removePanel("command-console-panel");
}
