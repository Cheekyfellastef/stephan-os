import { performance } from 'node:perf_hooks';
import {
  assertSimulationResultShape,
  SimulationExecutionError,
  SimulationInputError,
} from './simulationTypes.js';
import { ERROR_CODES } from './errors.js';
import { getSimulation, listSimulations, validateSimulationInput } from './simulationRegistry.js';

export class SimulationEngine {
  getStatus() {
    const registry = listSimulations();
    return {
      service: 'simulation_core',
      state: 'online',
      simulation_count: registry.length,
      callable_count: registry.filter((entry) => entry.callable_now).length,
      states: registry.reduce((acc, entry) => {
        acc[entry.state] = (acc[entry.state] ?? 0) + 1;
        return acc;
      }, {}),
    };
  }

  runSimulation(id, input = {}, context = {}) {
    const simulation = getSimulation(id);
    if (!simulation) {
      const err = new SimulationInputError(`Unknown simulation '${id}'.`, { simulationId: id });
      err.code = ERROR_CODES.SIM_NOT_FOUND;
      throw err;
    }

    const validatedInput = validateSimulationInput(id, input);
    const startedAt = performance.now();

    try {
      const result = simulation.execute(validatedInput, context);
      assertSimulationResultShape(result, id);
      const timingMs = Math.round(performance.now() - startedAt);

      return {
        simulation,
        validatedInput,
        result,
        timingMs,
      };
    } catch (error) {
      if (error instanceof SimulationInputError || error instanceof SimulationExecutionError) {
        throw error;
      }

      throw new SimulationExecutionError(
        `Simulation '${id}' failed: ${error.message}`,
        { simulationId: id },
      );
    }
  }
}

export const simulationEngine = new SimulationEngine();
