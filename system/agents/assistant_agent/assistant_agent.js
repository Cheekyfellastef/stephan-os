export const assistantAgent = {
  id: "assistant-agent",

  init() {
    console.log("Assistant agent started");
  },

  subscribeEvents: ["console:command"],

  async handleEvent(payload, context) {
    const userInput = payload.text;
    context?.eventBus?.emit("ai.intent.received", {
      source: "assistant-agent",
      summary: String(userInput || "").trim() || "intent-received",
      payload: { userInput: String(userInput || "") },
    });

    console.log("Assistant received:", userInput);

    const interpreted = interpretLocally(userInput);
    context?.eventBus?.emit("ai.decision.made", {
      source: "assistant-agent",
      summary: `Interpreted command: ${interpreted}`,
      payload: { interpretedCommand: interpreted },
    });

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

  if (cmd.includes("wealth")) {
    return "start wealth app";
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

    const simulation = parts.slice(1).join(" ").trim();

    if (!simulation) {
      return;
    }

    eventBus.emit("simulation:start", simulation);

  }

}
