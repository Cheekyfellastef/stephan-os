export const ERROR_CODES = {
  SIM_INPUT_INVALID: 'SIM_INPUT_INVALID',
  SIM_NOT_FOUND: 'SIM_NOT_FOUND',
  SIM_EXECUTION_FAILED: 'SIM_EXECUTION_FAILED',
  SIM_PRESET_NOT_FOUND: 'SIM_PRESET_NOT_FOUND',
  KG_INPUT_INVALID: 'KG_INPUT_INVALID',
  KG_NODE_NOT_FOUND: 'KG_NODE_NOT_FOUND',
  KG_EDGE_INVALID: 'KG_EDGE_INVALID',
  KG_DUPLICATE_NODE: 'KG_DUPLICATE_NODE',
  KG_STORAGE_FAILURE: 'KG_STORAGE_FAILURE',
  CMD_INVALID: 'CMD_INVALID',
  TOOL_EXECUTION_FAILED: 'TOOL_EXECUTION_FAILED',
};

export class AppError extends Error {
  constructor(code, message, { status = 400, details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function createError(code, message, options = {}) {
  return new AppError(code, message, options);
}

export function normalizeError(error) {
  if (error instanceof AppError) return error;
  return new AppError(ERROR_CODES.TOOL_EXECUTION_FAILED, error?.message ?? 'Unknown error.', { status: 500 });
}
