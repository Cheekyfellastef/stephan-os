const agents = [
  {
    name: 'assistant',
    purpose: 'General conversational and planning support',
    state: 'live',
    description: 'Default assistant route for strategy, ideation, and guidance.',
  },
  {
    name: 'system',
    purpose: 'System command execution and diagnostics',
    state: 'live',
    description: 'Executes operational commands like /status and /tools.',
  },
  {
    name: 'memory',
    purpose: 'Memory storage and retrieval workflows',
    state: 'live',
    description: 'Handles /memory command family and contextual memory search.',
  },
  {
    name: 'research',
    purpose: 'Future deep-research toolchains',
    state: 'planned',
    description: 'Reserved for extended research and synthesis orchestration.',
  },
  {
    name: 'simulation',
    purpose: 'Future simulation planning and execution',
    state: 'planned',
    description: 'Reserved for scenario simulation and modeling tasks.',
  },
  {
    name: 'vrlab',
    purpose: 'Future VR Research Lab orchestration',
    state: 'planned',
    description: 'Reserved for VR diagnostic and lab command routing.',
  },
];

export function listRegisteredAgents() {
  return [...agents];
}
