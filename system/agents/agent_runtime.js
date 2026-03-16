export function createAgentRuntime(context) {
  const registry = context.services.getService("agentRegistry");

  function startAgent(agentDefinition) {
    registry.registerAgent(agentDefinition.id, agentDefinition);

    if (typeof agentDefinition.init === "function") {
      agentDefinition.init(context);
    }

    if (agentDefinition.subscribeEvents) {
      agentDefinition.subscribeEvents.forEach((eventName) => {
        context.eventBus.on(eventName, (payload) => {
          agentDefinition.handleEvent(payload, context);
        });
      });
    }
  }

  return {
    startAgent
  };
}
