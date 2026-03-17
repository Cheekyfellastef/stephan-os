import { trajectoryDemoSimulation } from './simulations/trajectoryDemo.js';
import { systemHealthSnapshotSimulation } from './simulations/systemHealthSnapshot.js';
import { SimulationInputError, SIMULATION_STATES } from './simulationTypes.js';

const simulations = [
  systemHealthSnapshotSimulation,
  trajectoryDemoSimulation,
];

function getCallable(simulation) {
  return simulation.state === SIMULATION_STATES.LIVE || simulation.state === SIMULATION_STATES.MOCK;
}

export function listSimulations() {
  return simulations.map((simulation) => ({
    id: simulation.id,
    name: simulation.name,
    description: simulation.description,
    category: simulation.category,
    state: simulation.state,
    input_schema: simulation.input_schema,
    output_schema: simulation.output_schema,
    callable_now: getCallable(simulation),
  }));
}

export function getSimulation(id) {
  return simulations.find((simulation) => simulation.id === id) ?? null;
}

export function validateSimulationInput(id, input) {
  const simulation = getSimulation(id);
  if (!simulation) {
    throw new SimulationInputError(`Unknown simulation '${id}'.`, { simulationId: id });
  }

  if (!getCallable(simulation)) {
    throw new SimulationInputError(
      `Simulation '${id}' is not callable in state '${simulation.state}'.`,
      { simulationId: id, state: simulation.state },
    );
  }

  if (typeof simulation.validateInput === 'function') {
    return simulation.validateInput(input);
  }

  return input ?? {};
}
