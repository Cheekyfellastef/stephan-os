import { createError, ERROR_CODES } from './errors.js';

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
    this.code = ERROR_CODES.SIM_INPUT_INVALID;
    this.status = 400;
  }
}

export class SimulationExecutionError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'SimulationExecutionError';
    this.details = details;
    this.code = ERROR_CODES.SIM_EXECUTION_FAILED;
    this.status = 500;
  }
}

export function requireFiniteNumber(value, field, { min = null, max = null } = {}) {
  if (value === null || value === undefined || value === '') {
    throw createError(ERROR_CODES.SIM_INPUT_INVALID, `'${field}' is required.`, { status: 400, details: { field, value } });
  }
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw createError(ERROR_CODES.SIM_INPUT_INVALID, `'${field}' must be a finite number.`, { status: 400, details: { field, value } });
  }
  if (min !== null && num < min) {
    throw createError(ERROR_CODES.SIM_INPUT_INVALID, `'${field}' must be >= ${min}.`, { status: 400, details: { field, value: num } });
  }
  if (max !== null && num > max) {
    throw createError(ERROR_CODES.SIM_INPUT_INVALID, `'${field}' must be <= ${max}.`, { status: 400, details: { field, value: num } });
  }
  return num;
}

export function assertSimulationResultShape(result, simulationId) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw createError(ERROR_CODES.SIM_EXECUTION_FAILED, `Simulation '${simulationId}' returned malformed output.`, { status: 500, details: { simulationId, outputType: typeof result } });
  }
}
