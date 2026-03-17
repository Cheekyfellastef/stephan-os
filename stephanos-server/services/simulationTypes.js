export const SIMULATION_STATES = {
  LIVE: 'live',
  MOCK: 'mock',
  DISABLED: 'disabled',
  PLANNED: 'planned',
};

export class SimulationInputError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SimulationInputError';
    this.details = details;
  }
}

export class SimulationExecutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SimulationExecutionError';
    this.details = details;
  }
}

export function requireFiniteNumber(value, field, { min = null, max = null } = {}) {
  if (value === null || value === undefined || value === '') {
    throw new SimulationInputError(`'${field}' is required.`, { field, value });
  }

  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new SimulationInputError(`'${field}' must be a finite number.`, { field, value });
  }

  if (min !== null && num < min) {
    throw new SimulationInputError(`'${field}' must be >= ${min}.`, { field, value: num });
  }

  if (max !== null && num > max) {
    throw new SimulationInputError(`'${field}' must be <= ${max}.`, { field, value: num });
  }

  return num;
}

export function assertSimulationResultShape(result, simulationId) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new SimulationExecutionError(`Simulation '${simulationId}' returned malformed output.`, {
      simulationId,
      outputType: typeof result,
    });
  }
}
