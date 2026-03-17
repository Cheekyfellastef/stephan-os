import crypto from 'node:crypto';

function buildDebug(debug = {}) {
  return {
    parsed_command: debug.parsed_command ?? null,
    route_reason: debug.route_reason ?? '',
    backend_timestamp: new Date().toISOString(),
    request_id: debug.request_id ?? crypto.randomUUID(),
    selected_tool: debug.selected_tool ?? null,
    tool_state: debug.tool_state ?? null,
    memory_actions: debug.memory_actions ?? [],
    ...debug,
  };
}

export function buildSuccessResponse({
  type = 'assistant_response',
  route = 'assistant',
  command = null,
  output_text = '',
  data = {},
  tools_used = [],
  memory_hits = [],
  timing_ms = 0,
  debug = {},
}) {
  return {
    success: true,
    type,
    route,
    command,
    output_text,
    data,
    tools_used,
    memory_hits,
    timing_ms,
    error: null,
    debug: buildDebug(debug),
  };
}

export function buildErrorResponse({
  route = 'assistant',
  command = null,
  output_text = 'Request failed.',
  error = 'Unknown error',
  error_code = null,
  data = {},
  tools_used = [],
  memory_hits = [],
  timing_ms = 0,
  debug = {},
}) {
  return {
    success: false,
    type: 'error_result',
    route,
    command,
    output_text,
    data,
    tools_used,
    memory_hits,
    timing_ms,
    error,
    error_code,
    debug: buildDebug(debug),
  };
}
