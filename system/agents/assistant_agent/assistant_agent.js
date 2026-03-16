export const assistantAgent = {
  id: "assistant-agent",

  init() {
    console.log("Assistant agent started");
  },

  subscribeEvents: ["console:command"],

  async handleEvent(payload, context) {
    const userInput = payload.text;

    console.log("Assistant received:", userInput);

    const interpreted = interpretLocally(userInput);

    executeStephanosCommand(interpreted, context);
  }
};

function interpretLocally(text) {

  const cmd = text.toLowerCase();

  if (cmd.includes("module")) return "list modules";

  if (cmd.includes("agent")) return "list agents";

  if (cmd.includes("service")) return "list services";

  if (cmd.includes("galaxians")) {

    if (cmd.includes("run")) return "start galaxians";

    if (cmd.includes("start")) return "start galaxians";

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

  if (parts[0] === "start" || parts[0] === "run") {

    eventBus.emit("simulation:start", parts[1]);

  }

}
