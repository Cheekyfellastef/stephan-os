export const RESPONSE_TYPE = {
  ASSISTANT: 'assistant_response',
  TOOL: 'tool_result',
  MEMORY: 'memory_result',
  ERROR: 'error_result',
};

export const ROUTE_TYPE = {
  ASSISTANT: 'assistant',
  SYSTEM: 'system',
  MEMORY: 'memory',
  KG: 'kg',
};

export const EMPTY_RESPONSE = {
  success: false,
  type: RESPONSE_TYPE.ERROR,
  route: ROUTE_TYPE.ASSISTANT,
  command: null,
  output_text: '',
  data: {},
  tools_used: [],
  memory_hits: [],
  timing_ms: 0,
  error: 'No response payload',
  debug: {},
};
