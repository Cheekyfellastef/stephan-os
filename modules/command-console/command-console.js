let cleanupConsoleList = null;

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

      console.log("Console command:", command);

      // Send command to assistant agent
      context.eventBus.emit("console:command", {
        text: command
      });

      // Run built-in command parser as fallback
      executeCommand(command, context, output);

      input.value = "";
    }
  });

  cleanupConsoleList = context.eventBus.on("console:list", (target) => {
    executeCommand(`list ${target}`, context, output);
  });
}

async function executeCommand(command, context, output) {
  const parts = command.split(" ");

  const cmd = parts[0];

  if (cmd === "help") {
    log(output, "Commands:");
    log(output, "list modules");
    log(output, "list agents");
    log(output, "list services");
    log(output, "repair apps");
    log(output, "repair modules");
    log(output, "repair system");

    return;
  }

  if (cmd === "list") {
    const target = parts[1];

    if (target === "modules") {
      const modules = Object.values(context.activeModules || {});

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

  if (cmd === "repair") {
    const target = parts[1];

    if (target === "apps") {
      for (const app of context.projects || []) {
        context.eventBus.emit("app:validation_failed", {
          name: app.name,
          entry: app.entry
        });
      }

      log(output, "Repair apps: runtime registry revalidated.");
      return;
    }

    if (target === "modules") {
      if (context.moduleLoader?.reloadModules) {
        await context.moduleLoader.reloadModules();
        log(output, "Repair modules: reload requested.");
      } else {
        log(output, "Repair modules unavailable.");
      }
      return;
    }

    if (target === "system") {
      if (typeof window.reloadStephanos === "function") {
        await window.reloadStephanos();
      } else {
        window.location.reload();
      }
      log(output, "Repair system: reload requested.");
      return;
    }

    log(output, "Usage: repair <apps|modules|system>");
    return;
  }

  if (cmd === "start" || cmd === "run") {
    const simulation = parts.slice(1).join(" ").trim();

    if (!simulation) {
      log(output, "Usage: run <simulation-name>");
      return;
    }

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
  if (typeof cleanupConsoleList === "function") {
    cleanupConsoleList();
    cleanupConsoleList = null;
  }

  ui.removePanel("command-console-panel");
}
