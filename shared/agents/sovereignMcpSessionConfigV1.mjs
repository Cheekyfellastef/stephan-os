export const SOVEREIGN_MCP_SESSION_CONFIG_SCHEMA_V1 = 'stephanos.sovereign-mcp-session-config.v1';
export const SOVEREIGN_MCP_SESSION_CONFIG_SCOPE_V1 = 'THIS_PRIVATE_MCP_SESSION';
export const SOVEREIGN_MCP_SESSION_CONFIG_DEFAULTS_V1 = Object.freeze({
  fileReadLineLimit: 1000,
  // null preserves the existing byte-bounded write/edit behavior.
  fileWriteLineLimit: null,
});
export const SOVEREIGN_MCP_SESSION_CONFIG_LIMITS_V1 = Object.freeze({
  fileReadLineLimit: 1000, fileWriteLineLimit: 10_000,
  batchReadLineLimit: 200, batchFiles: 8, resultTextCharacters: 16 * 1024,
  writePayloadBytes: 1024 * 1024,
});
export const SOVEREIGN_MCP_SESSION_CONFIG_SEMANTICS_V1 = Object.freeze({
  fileReadLineLimit: 'Maximum returned LF/CRLF-delimited lines per file for read_file and read_multiple_files. Existing parsing is preserved: a bare CR is not a read-line delimiter. Requested defaults, batch limits and text budgets still apply.',
  fileWriteLineLimit: 'Maximum logical lines in each submitted write_file rewrite/append payload or edit_file replacement. This is not a total-file line limit. CRLF, LF and CR delimit lines; a final delimiter does not add an extra line. null restores the original byte-only limit.',
  persistence: 'Private handler memory only; closing the session discards these settings.',
  rollback: 'Set the prior value using the current revision. No other session or authority policy changes.',
});
const KEYS = Object.freeze(['fileReadLineLimit', 'fileWriteLineLimit']);
const SET_FIELDS = Object.freeze(['key', 'value', 'expectedRevision']);
const freeze = value => Object.freeze(value);
const failure = (blocker, extra = {}) => freeze({ ok: false,
  schemaVersion: SOVEREIGN_MCP_SESSION_CONFIG_SCHEMA_V1,
  scope: SOVEREIGN_MCP_SESSION_CONFIG_SCOPE_V1, persistent: false, blocker, ...extra });

function captureData(raw, fields, exact = true) {
  try {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || Object.getPrototypeOf(raw) !== Object.prototype) return null;
    const keys = Reflect.ownKeys(raw);
    if ((exact && keys.length !== fields.length)
      || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return null;
    const result = {};
    for (const key of keys) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      result[key] = descriptor.value;
    }
    return result;
  } catch { return null; }
}
function validValue(key, value) {
  if (key === 'fileWriteLineLimit' && value === null) return true;
  return KEYS.includes(key) && Number.isSafeInteger(value) && value >= 1
    && value <= SOVEREIGN_MCP_SESSION_CONFIG_LIMITS_V1[key];
}

// Capture before the command fabric can coerce values or inspect accessors.
// No path, executable, authority, environment or caller service is a setting.
export function captureSovereignMcpSessionConfigArgumentsV1(raw) {
  const args = captureData(raw, SET_FIELDS);
  if (!args || !KEYS.includes(args.key) || !validValue(args.key, args.value)
    || !Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) return null;
  return freeze(args);
}

// An executor captures a detached snapshot synchronously at admission. Invalid
// supplied state fails closed; an absent service preserves non-MCP behavior.
export function captureSovereignMcpSessionConfigSnapshotV1(raw) {
  const snapshot = captureData(raw, ['schemaVersion', 'scope', 'persistent', 'revision', 'values']);
  if (!snapshot || snapshot.schemaVersion !== SOVEREIGN_MCP_SESSION_CONFIG_SCHEMA_V1
    || snapshot.scope !== SOVEREIGN_MCP_SESSION_CONFIG_SCOPE_V1 || snapshot.persistent !== false
    || !Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return null;
  const values = captureData(snapshot.values, KEYS);
  if (!values || KEYS.some(key => !validValue(key, values[key]))) return null;
  return freeze({ ...snapshot, values: freeze(values) });
}

export function countSovereignSubmittedLinesV1(content, stopAfter = Number.MAX_SAFE_INTEGER) {
  if (typeof content !== 'string') throw new TypeError('SOVEREIGN_CONFIG_TEXT_REQUIRED');
  let lines = 0, start = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== '\r' && content[i] !== '\n') continue;
    if (content[i] === '\r' && content[i + 1] === '\n') i++;
    start = i + 1;
    if (++lines > stopAfter) return lines;
  }
  return start < content.length ? lines + 1 : lines;
}

// Construct once per existing private MCP handler. This adds no persistent
// settings file, scheduler, process owner, source lease or cross-session store.
export function createSovereignMcpSessionConfigV1() {
  let values = { ...SOVEREIGN_MCP_SESSION_CONFIG_DEFAULTS_V1 };
  let revision = 0, closed = false;
  const snapshot = () => freeze({
    schemaVersion: SOVEREIGN_MCP_SESSION_CONFIG_SCHEMA_V1,
    scope: SOVEREIGN_MCP_SESSION_CONFIG_SCOPE_V1, persistent: false,
    revision, values: freeze({ ...values }),
  });
  return freeze({
    getSnapshot() {
      if (closed) return failure('SOVEREIGN_SESSION_CONFIG_CLOSED');
      return snapshot();
    },
    execute(operation, raw) {
      if (closed) return failure('SOVEREIGN_SESSION_CONFIG_CLOSED');
      if (operation !== 'SET_CONFIG_VALUE') return failure('SOVEREIGN_SESSION_CONFIG_OPERATION_INVALID');
      const args = captureSovereignMcpSessionConfigArgumentsV1(raw);
      if (!args) return failure('SOVEREIGN_SESSION_CONFIG_ARGUMENTS_INVALID');
      // No await precedes this comparison and mutation: simultaneous requests
      // cannot both commit against the same revision.
      if (args.expectedRevision !== revision) return failure('SOVEREIGN_SESSION_CONFIG_REVISION_CONFLICT', { currentRevision: revision });
      const previousValue = values[args.key], previousRevision = revision;
      const changed = previousValue !== args.value;
      if (changed && revision === Number.MAX_SAFE_INTEGER) return failure('SOVEREIGN_SESSION_CONFIG_REVISION_EXHAUSTED');
      if (changed) { values = { ...values, [args.key]: args.value }; revision++; }
      return freeze({ ok: true, ...snapshot(),
        change: freeze({ key: args.key, previousValue, value: args.value, previousRevision, changed }) });
    },
    dispose() {
      if (closed) return;
      closed = true; values = null;
    },
  });
}
