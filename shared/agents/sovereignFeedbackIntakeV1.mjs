import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  createSharedWorkspaceEventRecord,
  resolveSharedWorkspacePath,
  validateSharedWorkspaceRecord,
  validateSharedWorkspaceWriteAncestors,
  writeAtomicJson,
} from './sharedAgentWorkspaceStore.mjs';
import { resolveSharedWorkspaceRuntimeConfig } from './sharedWorkspaceRuntimeConfig.mjs';

export const SOVEREIGN_FEEDBACK_INTAKE_SCHEMA_V1 = 'stephanos.sovereign-feedback-intake.v1';
export const SOVEREIGN_FEEDBACK_CATEGORIES_V1 = Object.freeze(['problem', 'improvement', 'other']);
// These are feedback subjects, never executable operation grants. Keep the
// original vendor outcome identifiable without impersonating its feedback API.
export const SOVEREIGN_FEEDBACK_OPERATION_IDS_V1 = Object.freeze([
  'general', 'read_file', 'read_multiple_files', 'get_file_info', 'write_file',
  'edit_block', 'list_directory', 'list_processes', 'get_config', 'create_directory',
  'start_search', 'get_more_search_results', 'stop_search', 'list_searches',
  'start_process', 'cancel_process_session', 'read_process_output', 'interact_with_process', 'list_sessions',
  'kill_process', 'force_terminate', 'move_file', 'write_pdf', 'set_config_value',
  'get_usage_stats', 'get_recent_tool_calls', 'get_tool_result', 'list_remote_tool_calls',
  'ping', 'list_devices', 'who_am_i', 'shutdown', 'give_feedback_to_desktop_commander',
  'submit_feedback', 'edit_file', 'search_project', 'inspect_battle_bridge',
  'maintenance_action', 'starfield_vr_telemetry_archive',
]);
export const SOVEREIGN_FEEDBACK_LIMITS_V1 = Object.freeze({
  messageBytes: 1024,
  submissions: 16,
  recordBytes: 8192,
});

const freeze = Object.freeze;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const MARKER = '[redacted]';
const plainObject = value => value && typeof value === 'object'
  && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const sameFile = (left, right) => left.dev === right.dev && left.ino === right.ino;
const regularFile = value => value.isFile() && !value.isSymbolicLink() && value.nlink === 1;
const boundary = () => ({
  schemaVersion: SOVEREIGN_FEEDBACK_INTAKE_SCHEMA_V1,
  canonicalOwnerGoal: '#2573',
  advisoryOnly: true,
  evidenceVerified: false,
  operatorIdentityVerified: false,
  automaticAdmissionAllowed: false,
  executionAuthority: false,
  runtimeParityProven: false,
  externalSubmission: false,
});
const refused = (blocker, feedbackState = 'NOT_STARTED', eventId) => freeze({
  ok: false, ...boundary(), feedbackState, blocker, retryAllowed: false,
  ...(eventId ? { eventId } : {}),
});

function redactCredentialAssignments(value) {
  // Classify the complete assignment name, not a word-boundary suffix: `_`
  // is a word character, so matching only `api_key` misses OPENAI_API_KEY.
  // Normalize identifier separators/casing and retain prefix/suffix coverage.
  // Quoted JSON names use their decoded name, never their value.
  const credentialName = name => /authorization|apikey|accesskey|token|password|passwd|pwd|secret|credential|cookie|privatekey/i
    .test(name.replace(/[^a-z0-9]/gi, ''));
  // Bare names are identifier tokens. Only these finite multiword spellings
  // may cross spaces; credential classification must never extend a name
  // backwards through an ordinary explanatory sentence.
  const assignments = /("(?:[^"\\\n]|\\.)+"|'[^'\n]+'|(?:proxy +authorization|api +key|(?:access|refresh|session) +token|access +key|client +secret|private +key|set +cookie)|[A-Za-z_][A-Za-z0-9_.-]*)\s*(?::|=|\bis\b)/gi;
  return value.split('\n').map(line => {
    for (const match of line.matchAll(assignments)) {
      let name = match[1];
      if (name.startsWith('"')) {
        try { name = JSON.parse(name); } catch { /* Use the bounded literal name. */ }
      }
      if (credentialName(name)) return line.slice(0, match.index) + MARKER;
    }
    return line;
  }).join('\n');
}

// This is a conservative projection for local advisory records, not a promise
// to identify every possible secret. Never retain the original string or its
// digest. A credential assignment or absolute path consumes the remainder of
// its line, so quoted/spaced values cannot leave a recognizable suffix behind.
function sanitizeMessage(value) {
  let output = value.replace(/\r\n/g, '\n').trim().normalize('NFC');
  if (!output || Buffer.byteLength(output, 'utf8') > SOVEREIGN_FEEDBACK_LIMITS_V1.messageBytes
    || /[\x00-\x09\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(output)) return null;
  output = redactCredentialAssignments(output
    .replace(/-----BEGIN ([A-Z0-9 -]*PRIVATE KEY[A-Z0-9 -]*)-----[\s\S]*?(?:-----END \1-----|$)/gi, MARKER))
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+\/=-]{6,}/gi, MARKER)
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|(?:sk|ghp|gho|ghu|ghs|github_pat)_[A-Za-z0-9_]{8,}|xox[baprs]-[A-Za-z0-9-]{8,}|AKIA[A-Z0-9]{16})\b/g, MARKER)
    .replace(/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\b/g, MARKER)
    .replace(/\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s<>"']+/gi, MARKER)
    .replace(/\bwww\.[^\s<>"']+/gi, MARKER)
    .replace(/\b[A-Z0-9.!#$%&'*+\/=?^_`{|}~-]+@(?:[A-Z0-9-]+\.)+[A-Z]{2,}\b/gi, MARKER)
    .replace(/(?:\b[A-Z]:[\\/]|\\\\[^\\\s]+[\\/])[^\n]*/gi, MARKER)
    .replace(/(^|[\s("'<])(?:~\/|\/)(?!\s)[^\n]*/g, (_match, prefix) => prefix + MARKER)
    .trim();
  if (!output.replaceAll(MARKER, '').trim()
    || Buffer.byteLength(output, 'utf8') > SOVEREIGN_FEEDBACK_LIMITS_V1.messageBytes) return null;
  return output;
}

// Admission must precede envelope construction, so its raw text cannot become
// a command plan, error, advisory history entry or generic executor receipt.
export function captureSovereignFeedbackArgumentsV1(raw) {
  try {
    if (!plainObject(raw)) return null;
    const allowed = ['category', 'operation', 'message'];
    const keys = Reflect.ownKeys(raw);
    if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) return null;
    const captured = {};
    for (const key of allowed) {
      const descriptor = Object.getOwnPropertyDescriptor(raw, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) return null;
      captured[key] = descriptor.value;
    }
    if (!SOVEREIGN_FEEDBACK_CATEGORIES_V1.includes(captured.category)
      || !SOVEREIGN_FEEDBACK_OPERATION_IDS_V1.includes(captured.operation)
      || typeof captured.message !== 'string') return null;
    // Bound the unprocessed input too; trimming/redaction cannot make an
    // unbounded caller string eligible for execution.
    if (Buffer.byteLength(captured.message, 'utf8') > SOVEREIGN_FEEDBACK_LIMITS_V1.messageBytes) return null;
    captured.message = sanitizeMessage(captured.message);
    return captured.message ? freeze(captured) : null;
  } catch { return null; }
}

function privateRoute(route) {
  try {
    if (!plainObject(route)) return null;
    const captured = {};
    for (const key of ['commandPathProven', 'mcpSessionReady', 'transport', 'authenticatedMcp']) {
      const descriptor = Object.getOwnPropertyDescriptor(route, key);
      if (descriptor && !Object.hasOwn(descriptor, 'value')) return null;
      captured[key] = descriptor?.value;
    }
    return captured.commandPathProven === true && captured.mcpSessionReady === true
      && (captured.transport === 'local-stdio-mcp'
        || (captured.transport === 'authenticated-http-jsonrpc' && captured.authenticatedMcp === true))
      ? captured.transport : null;
  } catch { return null; }
}

async function existingDestination(resolved) {
  const ancestors = await validateSharedWorkspaceWriteAncestors(resolved);
  if (!ancestors.ok) return false;
  try { return regularFile(await lstat(resolved.path)); }
  catch (error) { return error?.code === 'ENOENT'; }
}

async function readBack(resolved, expectedBytes) {
  const ancestors = await validateSharedWorkspaceWriteAncestors(resolved);
  if (!ancestors.ok) return null;
  let handle;
  try {
    const observed = await lstat(resolved.path);
    if (!regularFile(observed) || observed.size > SOVEREIGN_FEEDBACK_LIMITS_V1.recordBytes) return null;
    handle = await open(resolved.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const pinned = await handle.stat();
    if (!regularFile(pinned) || !sameFile(observed, pinned)) return null;
    const buffer = Buffer.alloc(SOVEREIGN_FEEDBACK_LIMITS_V1.recordBytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const read = await handle.read(buffer, count, buffer.length - count, count);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
    }
    const after = await handle.stat(), namedAfter = await lstat(resolved.path);
    if (count > SOVEREIGN_FEEDBACK_LIMITS_V1.recordBytes || !regularFile(after)
      || !regularFile(namedAfter) || !sameFile(pinned, after) || !sameFile(pinned, namedAfter)) return null;
    const actual = buffer.subarray(0, count);
    if (!actual.equals(expectedBytes)) return null;
    return { recordBytes: count, recordSha256: sha256(actual) };
  } catch { return null; }
  finally { if (handle) { try { await handle.close(); } catch {} } }
}

/**
 * Host dependencies and the third execute argument are trusted executor inputs,
 * never MCP payload fields. The host owns the existing Shared Workspace. This
 * adapter adds neither a store nor atomic namespace guarantees beyond its
 * canonical writer, and does not call a learning, builder, scheduler or vendor.
 * Identical sanitized feedback uses one content-derived event identity; later
 * submissions may refresh its advisory timestamp. This is not exactly-once or
 * first-submission evidence. A verified readback is not a power-loss guarantee.
 */
export function createSovereignFeedbackIntakeV1({
  repoRoot = process.cwd(), workspaceRoot, env = process.env,
  now = () => new Date().toISOString(), writeEvent = writeAtomicJson,
} = {}) {
  if (typeof now !== 'function' || typeof writeEvent !== 'function')
    throw new Error('SOVEREIGN_FEEDBACK_HOST_OPTIONS_INVALID');
  const config = resolveSharedWorkspaceRuntimeConfig({ root: workspaceRoot, repoRoot, env });
  let closed = false, inFlight = false, submissions = 0;
  const uncertain = new Set();

  async function execute(operation, raw, trustedRouteProof) {
    if (operation !== 'SUBMIT_FEEDBACK') return refused('SOVEREIGN_FEEDBACK_OPERATION_INVALID');
    const transport = privateRoute(trustedRouteProof);
    if (!transport) return refused('SOVEREIGN_FEEDBACK_PRIVATE_ROUTE_REQUIRED');
    if (closed) return refused('SOVEREIGN_FEEDBACK_HANDLER_CLOSED');
    const args = captureSovereignFeedbackArgumentsV1(raw);
    if (!args) return refused('SOVEREIGN_FEEDBACK_ARGUMENTS_INVALID');
    const eventId = `sc-feedback-${sha256(JSON.stringify({ canonicalOwnerGoal: '#2573', ...args }))}`;
    if (uncertain.has(eventId)) return refused('SOVEREIGN_FEEDBACK_PRIOR_WRITE_UNCERTAIN', 'UNKNOWN', eventId);
    if (inFlight) return refused('SOVEREIGN_FEEDBACK_PUBLICATION_IN_FLIGHT');
    if (submissions >= SOVEREIGN_FEEDBACK_LIMITS_V1.submissions)
      return refused('SOVEREIGN_FEEDBACK_SUBMISSION_LIMIT');
    if (!config.ok) return refused('SOVEREIGN_FEEDBACK_WORKSPACE_UNAVAILABLE');
    const resolved = resolveSharedWorkspacePath({ root: config.root, repoRoot,
      segments: ['events', `${eventId}.json`] });
    if (!resolved.ok) return refused('SOVEREIGN_FEEDBACK_WORKSPACE_UNAVAILABLE');
    let timestampUtc;
    try {
      const value = now();
      if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)))
        return refused('SOVEREIGN_FEEDBACK_CLOCK_INVALID');
      timestampUtc = new Date(value).toISOString();
    } catch { return refused('SOVEREIGN_FEEDBACK_CLOCK_INVALID'); }
    const record = freeze({
      ...createSharedWorkspaceEventRecord({ eventId, participantId: 'sovereign-commander',
        timestampUtc, eventKind: 'sovereign-user-feedback',
        summary: `Unverified Sovereign feedback: ${args.category} for ${args.operation}.` }),
      canonicalOwnerGoal: '#2573', feedbackSchemaVersion: SOVEREIGN_FEEDBACK_INTAKE_SCHEMA_V1,
      feedback: freeze({ ...args, provenance: 'CALLER_SUBMITTED_UNVERIFIED', transport }),
      advisoryOnly: true, evidenceVerified: false, operatorIdentityVerified: false,
      automaticAdmissionAllowed: false, executionAuthority: false, runtimeParityProven: false,
      mergeAuthority: false, runtimeMutationAuthority: false, arbitraryShellAllowed: false,
    });
    const expectedBytes = Buffer.from(`${JSON.stringify(record, null, 2)}\n`, 'utf8');
    if (expectedBytes.length > SOVEREIGN_FEEDBACK_LIMITS_V1.recordBytes
      || !validateSharedWorkspaceRecord(record, { nowMs: Date.parse(timestampUtc) }).valid)
      return refused('SOVEREIGN_FEEDBACK_CONTENT_REJECTED');

    inFlight = true;
    let writeStarted = false;
    try {
      if (!await existingDestination(resolved)) return refused('SOVEREIGN_FEEDBACK_WORKSPACE_UNAVAILABLE');
      // Disposal before publication admission is safe. An already-owned write
      // continues to settlement; closing a transport is not cancellation proof.
      if (closed) return refused('SOVEREIGN_FEEDBACK_HANDLER_CLOSED');
      submissions++;
      writeStarted = true;
      const publication = await writeEvent(config.root, ['events', `${eventId}.json`], record,
        { repoRoot, nowMs: Date.parse(timestampUtc), durable: true });
      const observed = publication?.ok === true ? await readBack(resolved, expectedBytes) : null;
      if (!observed) {
        uncertain.add(eventId);
        return refused('SOVEREIGN_FEEDBACK_PERSISTENCE_UNPROVEN', 'UNKNOWN', eventId);
      }
      return freeze({ ok: true, ...boundary(), feedbackState: 'PERSISTED', eventId,
        recordedAtUtc: timestampUtc, ...observed, retryAllowed: false });
    } catch {
      if (writeStarted) uncertain.add(eventId);
      return refused(writeStarted ? 'SOVEREIGN_FEEDBACK_PERSISTENCE_UNPROVEN'
        : 'SOVEREIGN_FEEDBACK_WORKSPACE_UNAVAILABLE', writeStarted ? 'UNKNOWN' : 'NOT_STARTED',
      writeStarted ? eventId : undefined);
    } finally { inFlight = false; }
  }

  return freeze({ execute, dispose() { closed = true; return freeze({ closed: true, inFlight }); } });
}
