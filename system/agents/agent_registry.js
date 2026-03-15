export function createAgentRegistry() {
  const agents = new Map();

  return {
    registerAgent(id, agent) {
      agents.set(id, agent);
    },

    getAgent(id) {
      return agents.get(id);
    },

    listAgents() {
      return Array.from(agents.keys());
    }
  };
}
