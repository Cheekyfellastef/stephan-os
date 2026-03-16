export const assistantAgent = {
  id: "assistant-agent",

  subscribeEvents: ["console:command"],

  async handleEvent(payload, context) {
    const userInput = payload.text;

    console.log("Assistant received:", userInput);

    const command = await interpretCommand(userInput);

    executeStephanosCommand(command, context);
  }
};

async function interpretCommand(text) {
  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      message: text
    })
  });

  const data = await response.json();

  return data.command;
}

function executeStephanosCommand(command, context) {
  if (!command) return;

  const eventBus = context.eventBus;
  const parts = command.split(" ");
  const cmd = parts[0];

  if (cmd === "start") {
    eventBus.emit("simulation:start", parts[1]);
  }

  if (cmd === "list") {
    eventBus.emit("console:list", parts[1]);
  }

  if (cmd === "run") {
    eventBus.emit("experiment:run", parts.slice(1).join(" "));
  }
}
