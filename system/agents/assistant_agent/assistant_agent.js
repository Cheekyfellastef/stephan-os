export const assistantAgent = {
  id: "assistant-agent",

  subscribeEvents: ["console:command"],

  async handleEvent(payload, context) {
    const userInput = payload.text;

    console.log("Assistant received:", userInput);

    const interpreted = interpretLocally(userInput);

    if (interpreted) {
      executeStephanosCommand(interpreted, context);
    }
  }
};

function interpretLocally(text) {
  const cmd = text.toLowerCase();

  if (cmd.includes("module")) {
    return "list modules";
  }

  if (cmd.includes("agent")) {
    return "list agents";
  }

  if (cmd.includes("service")) {
    return "list services";
  }

  if (cmd.includes("galaxians")) {
    return "start galaxians";
  }

  return text;
}

function executeStephanosCommand(command, context) {
  const parts = command.split(" ");

  const eventBus = context.eventBus;

  if (parts[0] === "list") {
    eventBus.emit("console:list", parts[1]);
  }

  if (parts[0] === "start") {
    eventBus.emit("simulation:start", parts[1]);
  }
}
