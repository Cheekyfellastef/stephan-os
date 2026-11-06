import { randomUUID } from 'node:crypto';

export const SOVEREIGN_MCP_SESSION_HISTORY_SCHEMA_V1 = 'stephanos.sovereign-mcp-session-history.v1';
export const SOVEREIGN_MCP_SESSION_HISTORY_TOOLS_V1 = Object.freeze([
  'get_usage_stats', 'get_recent_tool_calls', 'get_tool_result', 'list_remote_tool_calls',
]);
export const SOVEREIGN_MCP_SESSION_HISTORY_LIMITS_V1 = Object.freeze({
  maxEntries: 128, maxTotalBytes: 512 * 1024, maxResultBytes: 64 * 1024,
  maxAgeMs: 30 * 60 * 1000, maxPending: 32,
});
const HARD_LIMITS = Object.freeze({
  maxEntries: 256, maxTotalBytes: 2 * 1024 * 1024, maxResultBytes: 128 * 1024,
  maxAgeMs: 60 * 60 * 1000, maxPending: 64,
});
const KNOWN_TOOLS = new Set([
  'inspect_battle_bridge', 'get_config', 'read_file', 'read_multiple_files', 'get_file_info',
  'write_file', 'edit_file', 'list_directory', 'create_directory', 'search_project',
  'list_processes', 'starfield_vr_telemetry_archive', 'maintenance_action',
  'start_search', 'get_more_search_results', 'stop_search', 'list_searches',
  ...SOVEREIGN_MCP_SESSION_HISTORY_TOOLS_V1,
]);
const HISTORY_TOOLS = new Set(SOVEREIGN_MCP_SESSION_HISTORY_TOOLS_V1);
const TRANSPORTS = new Set(['local-stdio-mcp', 'authenticated-http-jsonrpc']);
const CALL_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const SECRET_KEYS = new Set([
  'authorization', 'auth', 'authtoken', 'token', 'accesstoken', 'refreshtoken',
  'apikey', 'cookie', 'setcookie', 'password', 'passwd', 'pwd', 'secret',
  'clientsecret', 'credentials', 'privatekey', 'environment', 'env',
  'stderr', 'stack', 'exception', 'error', 'errors', '__proto__', 'prototype', 'constructor',
]);
const SECRET_TEXT = /\bBearer\s+\S{6,}|\b(?:sk|ghp|gho|ghu|ghs|github_pat)_[a-zA-Z0-9_]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bAKIA[A-Z0-9]{16}\b/i;
const MAX_NODES = 4096, MAX_DEPTH = 12;
const freeze = value => Object.freeze(value);
const base = () => ({
  schemaVersion: SOVEREIGN_MCP_SESSION_HISTORY_SCHEMA_V1,
  scope: 'THIS_SOVEREIGN_MCP_HANDLER_SESSION',
  advisoryOnly: true, durable: false, executionAuthority: false,
  nativeOutcome: 'UNKNOWN', vendorHistoryIncluded: false,
});
const failure = blocker => freeze({ ok: false, ...base(), blocker });
const result = value => freeze({ ok: true, ...base(), ...value });

function data(value, allowed) {
  try {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const keys = Reflect.ownKeys(value);
  if (keys.some(key => typeof key !== 'string' || !allowed.includes(key))) return null;
  const output = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
    output[key] = descriptor.value;
  }
  return output;
  } catch { return null; }
}

function ownBoolean(value, key) {
  try {
  if (!value || typeof value !== 'object') return null;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'boolean'
    ? descriptor.value : null;
  } catch { return null; }
}

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// Only a successful result returned on a trusted private request may reach this
// copier. No getters, prototypes, functions, cycles, secret-shaped values or
// unbounded data are retained. The cache owns a JSON snapshot, never the executor's
// mutable object, native proof token, Error or caller arguments.
function privateSnapshot(value, maximum) {
  let nodes = 0, approximateBytes = 0;
  const ancestors = new WeakSet();
  const refuse = code => { throw new Error(code); };
  const reserve = amount => {
    approximateBytes += amount;
    if (approximateBytes > maximum) refuse('RESULT_BYTE_LIMIT');
  };
  const copy = (item, depth) => {
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) refuse('RESULT_STRUCTURE_LIMIT');
    if (item === null || typeof item === 'boolean') { reserve(5); return item; }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) refuse('RESULT_SHAPE_UNSAFE');
      reserve(24); return item;
    }
    if (typeof item === 'string') {
      const bytes = Buffer.byteLength(item);
      if (bytes > maximum) refuse('RESULT_BYTE_LIMIT');
      if (SECRET_TEXT.test(item)) refuse('RESULT_SENSITIVE_VALUE');
      reserve(Buffer.byteLength(JSON.stringify(item)));
      return item;
    }
    if (!item || typeof item !== 'object') refuse('RESULT_SHAPE_UNSAFE');
    if (ancestors.has(item)) refuse('RESULT_SHAPE_UNSAFE');
    const isArray = Array.isArray(item), prototype = Object.getPrototypeOf(item);
    if (isArray ? prototype !== Array.prototype
      : prototype !== Object.prototype && prototype !== null) refuse('RESULT_SHAPE_UNSAFE');
    if (isArray && item.length > MAX_NODES) refuse('RESULT_STRUCTURE_LIMIT');
    const keys = Reflect.ownKeys(item);
    if (keys.length > MAX_NODES) refuse('RESULT_STRUCTURE_LIMIT');
    if (isArray && keys.length !== item.length + 1) refuse('RESULT_SHAPE_UNSAFE');
    ancestors.add(item);
    const output = isArray ? [] : Object.create(null);
    reserve(2);
    for (const key of keys) {
      if (isArray && key === 'length') continue;
      if (typeof key !== 'string' || Buffer.byteLength(key) > 160) refuse('RESULT_SHAPE_UNSAFE');
      if (isArray && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= item.length))
        refuse('RESULT_SHAPE_UNSAFE');
      const normalized = key.toLowerCase().replace(/[._-]/g, '');
      if (SECRET_KEYS.has(key.toLowerCase()) || SECRET_KEYS.has(normalized)) refuse('RESULT_SENSITIVE_KEY');
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) refuse('RESULT_SHAPE_UNSAFE');
      reserve(Buffer.byteLength(JSON.stringify(key)) + 2);
      output[key] = copy(descriptor.value, depth + 1);
    }
    ancestors.delete(item);
    return output;
  };
  try {
    const json = JSON.stringify(copy(value, 0)), bytes = Buffer.byteLength(json);
    return bytes <= maximum ? { json, bytes, reason: 'RETAINED_PRIVATE_SNAPSHOT' }
      : { json: null, bytes: 0, reason: 'RESULT_BYTE_LIMIT' };
  } catch (error) {
    const allowed = ['RESULT_BYTE_LIMIT', 'RESULT_STRUCTURE_LIMIT', 'RESULT_SHAPE_UNSAFE',
      'RESULT_SENSITIVE_KEY', 'RESULT_SENSITIVE_VALUE'];
    return { json: null, bytes: 0,
      reason: allowed.includes(error?.message) ? error.message : 'RESULT_SHAPE_UNSAFE' };
  }
}

/**
 * One ephemeral service per existing MCP handler; never share it between sessions.
 * The host must gate execute() as an actual request on its trusted local-stdio
 * or authenticated private HTTP transport, and inject this object through trusted
 * executor options, never JSON arguments. callId comes from the existing random
 * command envelope, not a JSON-RPC/client ID, and must not be reused.
 *
 * privateResultAllowed is a trusted per-call transport decision, false by default.
 * This module has no transport, filesystem, timer, persistence or custody action.
 */
export function createSovereignMcpSessionHistoryV1({
  nowMs = () => Date.now(), limits: suppliedLimits = {},
} = {}) {
  if (typeof nowMs !== 'function') throw new Error('SOVEREIGN_HISTORY_CLOCK_INVALID');
  const provided = data(suppliedLimits, Object.keys(HARD_LIMITS));
  if (!provided) throw new Error('SOVEREIGN_HISTORY_LIMITS_INVALID');
  const limits = { ...SOVEREIGN_MCP_SESSION_HISTORY_LIMITS_V1, ...provided };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1 || value > HARD_LIMITS[key])
      throw new Error('SOVEREIGN_HISTORY_LIMITS_INVALID');
  }
  if (limits.maxResultBytes > limits.maxTotalBytes || limits.maxPending > limits.maxEntries)
    throw new Error('SOVEREIGN_HISTORY_LIMITS_INVALID');
  Object.freeze(limits);

  const records = new Map();
  let retainedBytes = 0, sequence = 0, lastNow = 0, disposed = false;
  const counts = {
    observedToolCalls: 0, recordedToolCalls: 0, unrecordedToolCalls: 0,
    returnedResponses: 0, unsuccessfulResponses: 0, thrownResponses: 0,
    unknownResponses: 0, expiredRecords: 0, capacityEvictions: 0,
    expiredPendingResponses: 0,
  };
  let countersSaturated = false;
  const increment = key => {
    if (counts[key] < Number.MAX_SAFE_INTEGER) counts[key]++;
    else countersSaturated = true;
  };
  const clock = () => {
    let current;
    try { current = nowMs(); } catch { return null; }
    if (!Number.isFinite(current) || current < 0 || current > 8640000000000000) return null;
    lastNow = Math.max(lastNow, Math.floor(current));
    return lastNow;
  };
  const metadata = entry => freeze({
    callId: entry.callId, sequence: entry.sequence, tool: entry.tool,
    transportKind: entry.transportKind, startedAtUtc: new Date(entry.startedAtMs).toISOString(),
    responseAtUtc: entry.responseAtMs === null ? null : new Date(entry.responseAtMs).toISOString(),
    durationMs: entry.responseAtMs === null ? null : entry.responseAtMs - entry.startedAtMs,
    responseState: entry.responseState, responseOk: entry.responseOk,
    nativeOutcome: 'UNKNOWN', executionAuthority: false,
    resultAvailable: entry.resultJson !== null, resultBytes: entry.resultBytes,
    retentionReason: entry.retentionReason,
  });
  const size = entry => Buffer.byteLength(JSON.stringify(metadata(entry))) + entry.resultBytes;
  const remove = (entry, reason) => {
    records.delete(entry.callId);
    retainedBytes -= entry.bytes;
    increment(reason === 'AGE' ? 'expiredRecords' : 'capacityEvictions');
    if (reason === 'AGE' && entry.responseState === 'PENDING') increment('expiredPendingResponses');
  };
  const prune = current => {
    for (const entry of records.values()) {
      if (current - entry.startedAtMs >= limits.maxAgeMs) remove(entry, 'AGE');
    }
  };
  const evictReturned = protectedId => {
    for (const entry of records.values()) {
      if (entry.callId !== protectedId && entry.responseState !== 'PENDING') {
        remove(entry, 'CAPACITY'); return true;
      }
    }
    return false;
  };
  const room = (bytes, protectedId) => {
    while (retainedBytes + bytes > limits.maxTotalBytes) {
      if (!evictReturned(protectedId)) return false;
    }
    return true;
  };
  const notRecorded = reason => freeze({ recorded: false, reason });

  function begin(input) {
    if (disposed) return notRecorded('SESSION_CLOSED');
    const row = data(input, ['callId', 'tool', 'transportKind', 'privateResultAllowed']);
    if (!row || typeof row.tool !== 'string') return notRecorded('CALL_METADATA_INVALID');
    if (HISTORY_TOOLS.has(row.tool)) return notRecorded('HISTORY_QUERY_EXCLUDED');
    if (row.callId !== undefined && (typeof row.callId !== 'string' || !CALL_ID.test(row.callId)))
      return notRecorded('CALL_ID_INVALID');
    if (row.privateResultAllowed !== undefined && typeof row.privateResultAllowed !== 'boolean')
      return notRecorded('CALL_METADATA_INVALID');
    const current = clock();
    if (current === null) return notRecorded('CLOCK_UNPROVEN');
    prune(current);
    const callId = row.callId ?? randomUUID();
    if (records.has(callId)) return notRecorded('DUPLICATE_CALL_ID');
    increment('observedToolCalls');
    const pending = [...records.values()].filter(entry => entry.responseState === 'PENDING').length;
    if (pending >= limits.maxPending || sequence >= Number.MAX_SAFE_INTEGER) {
      increment('unrecordedToolCalls'); return notRecorded('HISTORY_CAPACITY');
    }
    while (records.size >= limits.maxEntries) {
      if (!evictReturned()) {
        increment('unrecordedToolCalls'); return notRecorded('HISTORY_CAPACITY');
      }
    }
    const entry = {
      callId, sequence: ++sequence,
      tool: KNOWN_TOOLS.has(row.tool) ? row.tool : 'unknown_tool',
      transportKind: TRANSPORTS.has(row.transportKind) ? row.transportKind : 'unknown',
      startedAtMs: current, responseAtMs: null, responseState: 'PENDING', responseOk: null,
      privateResultAllowed: row.privateResultAllowed === true && TRANSPORTS.has(row.transportKind),
      resultJson: null, resultBytes: 0, retentionReason: 'RESPONSE_PENDING', bytes: 0,
    };
    entry.bytes = size(entry);
    if (!room(entry.bytes)) {
      increment('unrecordedToolCalls'); return notRecorded('HISTORY_CAPACITY');
    }
    records.set(callId, entry); retainedBytes += entry.bytes;
    increment('recordedToolCalls');
    return freeze({ recorded: true, callId });
  }

  function finish(callId, value, options = {}) {
    if (disposed) return notRecorded('SESSION_CLOSED');
    const flags = data(options, ['threw']);
    if (!flags || (flags.threw !== undefined && typeof flags.threw !== 'boolean'))
      return notRecorded('CALL_METADATA_INVALID');
    const current = clock();
    if (current === null) return notRecorded('CLOCK_UNPROVEN');
    prune(current);
    const entry = typeof callId === 'string' ? records.get(callId) : null;
    if (!entry) return notRecorded('CALL_NOT_RETAINED');
    if (entry.responseState !== 'PENDING') return notRecorded('RESPONSE_ALREADY_RECORDED');
    retainedBytes -= entry.bytes;
    entry.responseAtMs = current;
    entry.responseState = flags.threw === true ? 'THREW' : 'RETURNED';
    const ok = ownBoolean(value, 'ok'), isError = ownBoolean(value, 'isError');
    entry.responseOk = flags.threw === true || (ok === true && isError === true) ? null : ok;
    if (flags.threw === true) increment('thrownResponses');
    else {
      increment('returnedResponses');
      if (ok === false || isError === true) increment('unsuccessfulResponses');
      else if (entry.responseOk === null) increment('unknownResponses');
    }
    entry.retentionReason = !entry.privateResultAllowed ? 'PRIVATE_RETENTION_NOT_ALLOWED'
      : flags.threw === true || entry.responseOk !== true || isError === true ? 'RESPONSE_NOT_SUCCESSFUL'
      : 'RETAINED_PRIVATE_SNAPSHOT';
    if (entry.retentionReason === 'RETAINED_PRIVATE_SNAPSHOT') {
      const snapshot = privateSnapshot(value, limits.maxResultBytes);
      entry.resultJson = snapshot.json; entry.resultBytes = snapshot.bytes;
      entry.retentionReason = snapshot.reason;
    }
    entry.bytes = size(entry);
    if (!room(entry.bytes, callId) && entry.resultJson !== null) {
      entry.resultJson = null; entry.resultBytes = 0; entry.retentionReason = 'TOTAL_BYTE_LIMIT';
      entry.bytes = size(entry);
    }
    if (!room(entry.bytes, callId)) {
      records.delete(callId); increment('capacityEvictions');
      return notRecorded('HISTORY_CAPACITY');
    }
    retainedBytes += entry.bytes;
    return freeze({ recorded: true, callId, responseState: entry.responseState,
      resultAvailable: entry.resultJson !== null });
  }

  function execute(tool, args = {}) {
    if (disposed) return failure('SOVEREIGN_HISTORY_SESSION_CLOSED');
    if (!HISTORY_TOOLS.has(tool)) return failure('SOVEREIGN_HISTORY_TOOL_UNKNOWN');
    const allowed = tool === 'get_usage_stats' ? [] : tool === 'get_tool_result'
      ? ['callId'] : ['offset', 'limit'];
    const input = data(args, allowed);
    if (!input) return failure('SOVEREIGN_HISTORY_ARGUMENTS_INVALID');
    const current = clock();
    if (current === null) return failure('SOVEREIGN_HISTORY_CLOCK_UNPROVEN');
    prune(current);
    if (tool === 'get_usage_stats') return result({
      coverage: 'CALLS_OBSERVED_BY_THIS_HANDLER', historyQueriesIncluded: false,
      vendorMeterUsage: 'NOT_OBSERVED', billingUsage: 'NOT_OBSERVED',
      counters: freeze({ ...counts }), countersSaturated,
      retainedEntries: records.size, retainedSerializedBytes: retainedBytes,
      retainedPendingResponses: [...records.values()].filter(entry => entry.responseState === 'PENDING').length,
      retainedResults: [...records.values()].filter(entry => entry.resultJson !== null).length,
      byteBudgetBasis: 'UTF8_METADATA_PLUS_RETAINED_RESULT_JSON', limits,
    });
    if (tool === 'get_tool_result') {
      if (typeof input.callId !== 'string' || !CALL_ID.test(input.callId))
        return failure('SOVEREIGN_HISTORY_ARGUMENTS_INVALID');
      const entry = records.get(input.callId);
      if (!entry) return failure('SOVEREIGN_HISTORY_CALL_NOT_FOUND_OR_EXPIRED');
      return result({
        call: metadata(entry), resultAvailable: entry.resultJson !== null,
        result: entry.resultJson === null ? null : deepFreeze(JSON.parse(entry.resultJson)),
        resultProvenance: entry.resultJson === null ? 'NOT_RETAINED' : 'COPY_OF_THIS_SESSION_RETURNED_VALUE',
        independentlyVerified: false,
      });
    }
    const offset = input.offset === undefined ? 0 : input.offset;
    const limit = input.limit === undefined ? 20 : input.limit;
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > HARD_LIMITS.maxEntries
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
      return failure('SOVEREIGN_HISTORY_ARGUMENTS_INVALID');
    const remote = tool === 'list_remote_tool_calls';
    const entries = [...records.values()].filter(entry => !remote
      || entry.transportKind === 'authenticated-http-jsonrpc').reverse();
    const calls = freeze(entries.slice(offset, offset + limit).map(metadata));
    return result({
      calls, offset, limit, retainedMatchingCalls: entries.length,
      nextOffset: offset + calls.length < entries.length ? offset + calls.length : null,
      remoteDefinition: remote ? 'THIS_SESSION_AUTHENTICATED_HTTP_JSONRPC_CALLS' : null,
    });
  }

  function dispose() {
    records.clear(); retainedBytes = 0; disposed = true;
    return freeze({ disposed: true, executionAuthority: false, nativeOutcome: 'UNKNOWN' });
  }

  return freeze({ begin, finish, execute, dispose });
}
