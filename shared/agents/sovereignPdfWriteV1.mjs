import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

export const SOVEREIGN_PDF_WRITE_SCHEMA_V1 = 'stephanos.sovereign-pdf-write.v1';
export const SOVEREIGN_PDF_WRITE_LIMITS_V1 = Object.freeze({
  pathCharacters: 240, pages: 8, linesPerPage: 60, charactersPerLine: 80, textCharacters: 16_384,
  pdfBytes: 65_536, requestBytes: 131_072, nativeMs: 5000, processMs: 20_000,
  terminationGraceMs: 2000, outputBytes: 16_384, nativeConcurrency: 1,
});
const SCRIPT = fileURLToPath(new URL('../../scripts/windows/sovereign-write-pdf.ps1', import.meta.url));
const NATIVE = fileURLToPath(new URL('../../scripts/windows/SovereignPdfWriteV1.cs', import.meta.url));
const SCRIPT_SHA256 = 'c3e5697ab8a266ee522bd0206b115a148cbbcd12e0ca240eb077264f72456937';
const NATIVE_SHA256 = 'fc92e762ab7d8d326b9d87f584200104bb314f9ed1ced37b2f7751c01a131aa9';
const POWERSHELL = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const IDENTITY = /^[a-f0-9]{8}:[a-f0-9]{16}$/;
const EXCLUDED_DIRECTORIES = new Set([
  '.git', '.ssh', '.aws', '.azure', '.gnupg', '.kube', '.docker', '.config',
  '.codex', '.openclaw', '.claude', '.gemini', '.pki', '.password-store',
  'secrets', '.secrets', 'credentials', '.credentials', 'openai-secure-mcp-tunnel',
  'appdata', 'programdata', 'windows', 'program files', 'program files (x86)',
  '$recycle.bin', 'system volume information', 'recovery',
  'node_modules', 'dist', 'build', 'coverage', '.next', '.cache',
]);
const SENSITIVE_FILE = /^(?:\.env(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|authorized_keys|known_hosts|credentials(?:\..+)?|secrets?(?:\..+)?|auth\.json|tokens?(?:\..+)?|Cookies|Login Data|Web Data)$|\.(?:key|pem|pfx|p12|kdbx|dpapi)$/i;
const digest = value => createHash('sha256').update(value).digest('hex');
const integer = (value, maximum) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;
const metadata = (args, bytes) => Object.freeze({
  sha256: digest(bytes), bytes: bytes.length, pageCount: args.pages.length,
  targetSha256: digest(Buffer.from(args.path, 'utf8')),
});
// Admission only: no queue, retry worker, task owner or persistent service.
// A process whose exit is unproven continues to occupy its slot.
let activeNativeWrites = 0;
function blocked(blocker, mutationState = 'NOT_STARTED', evidence = {}) {
  return Object.freeze({ ok: false, schemaVersion: SOVEREIGN_PDF_WRITE_SCHEMA_V1, blocker,
    mutationState, mutationAttempted: mutationState === 'NOT_STARTED' ? false : null,
    stage: mutationState === 'NOT_STARTED' ? 'PRECONDITION' : 'PROCESS_TERMINAL_UNPROVEN',
    retryAllowed: false, atomicDocumentPublication: false, identity: null, parentIdentity: null,
    ...evidence });
}
function captureRecord(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || !own.every(key => typeof key === 'string' && keys.includes(key))) return null;
  const copy = {};
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !Object.hasOwn(property, 'value')) return null;
    copy[key] = property.value;
  }
  return copy;
}
function captureArray(value, minimum, maximum) {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) return null;
  const count = Object.getOwnPropertyDescriptor(value, 'length')?.value;
  if (!Number.isSafeInteger(count) || count < minimum || count > maximum
    || Reflect.ownKeys(value).length !== count + 1) return null;
  const copy = [];
  for (let index = 0; index < count; index++) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property || !Object.hasOwn(property, 'value')) return null;
    copy.push(property.value);
  }
  return copy;
}
function validPart(part) {
  return part.length > 0 && part.length <= 255 && part !== '.' && part !== '..'
    && part.isWellFormed() && !/[ .]$/.test(part) && !/[\x00-\x1f<>:"/\\|?*~]/.test(part)
    && !/^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part);
}
function validatePath(path) {
  if (typeof path !== 'string' || path !== path.trim() || path.length > SOVEREIGN_PDF_WRITE_LIMITS_V1.pathCharacters
    || !/^[a-z]:\\[^\\]/i.test(path) || !/\.pdf$/i.test(path)) return 'SOVEREIGN_PDF_PATH_INVALID';
  const parts = path.slice(3).split('\\');
  if (parts.length > 64 || parts.some(part => !validPart(part))) return 'SOVEREIGN_PDF_PATH_INVALID';
  if (parts.some(part => EXCLUDED_DIRECTORIES.has(part.toLowerCase()) || SENSITIVE_FILE.test(part)))
    return 'SOVEREIGN_PDF_PATH_EXCLUDED';
  return '';
}

// Copies every admitted nested value. Getters, sparse arrays, extra fields and
// prototype variants never become content, native source or execution options.
export function validateSovereignPdfWriteArgumentsV1(raw) {
  try {
    const request = captureRecord(raw, ['path', 'pages']);
    if (!request) return blocked('SOVEREIGN_PDF_ARGUMENTS_INVALID');
    const invalidPath = validatePath(request.path);
    if (invalidPath) return blocked(invalidPath);
    const sourcePages = captureArray(request.pages, 1, SOVEREIGN_PDF_WRITE_LIMITS_V1.pages);
    if (!sourcePages) return blocked('SOVEREIGN_PDF_PAGES_INVALID');
    const pages = []; let characters = 0;
    for (const sourcePage of sourcePages) {
      const page = captureRecord(sourcePage, ['lines']);
      const lines = page && captureArray(page.lines, 0, SOVEREIGN_PDF_WRITE_LIMITS_V1.linesPerPage);
      if (!lines) return blocked('SOVEREIGN_PDF_LINES_INVALID');
      for (const line of lines) {
        if (typeof line !== 'string' || line.length > SOVEREIGN_PDF_WRITE_LIMITS_V1.charactersPerLine
          || /[^\x20-\x7e]/.test(line)) return blocked('SOVEREIGN_PDF_TEXT_INVALID');
        characters += line.length;
        if (characters > SOVEREIGN_PDF_WRITE_LIMITS_V1.textCharacters) return blocked('SOVEREIGN_PDF_TEXT_LIMIT');
      }
      pages.push(Object.freeze({ lines: Object.freeze(lines) }));
    }
    return Object.freeze({ ok: true, args: Object.freeze({ path: request.path, pages: Object.freeze(pages) }) });
  } catch { return blocked('SOVEREIGN_PDF_ARGUMENTS_INVALID'); }
}

// Pure create-only text recipe, not a parser or PDF editor. Returns a new Buffer;
// invalid input throws only a bounded SOVEREIGN_PDF_* code. ASCII hex strings
// keep every operator-delimiter-looking character inside an inert text operand.
// Letter 612x792, Courier 10 pt, left=36, first baseline=756, leading=12:
// 80 columns occupy 480 pt and the 60th baseline is 48 pt.
export function renderSovereignTextPdfV1(raw) {
  const validation = validateSovereignPdfWriteArgumentsV1(raw);
  if (!validation.ok) throw new Error(validation.blocker);
  const { pages } = validation.args;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${4 + index * 2} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
  ];
  for (const [index, page] of pages.entries()) {
    const content = 'BT\n/F1 10 Tf\n12 TL\n36 756 Td\n'
      + page.lines.map(line => `<${Buffer.from(line, 'ascii').toString('hex')}> Tj\nT*\n`).join('') + 'ET\n';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5 + index * 2} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(content, 'ascii')} >>\nstream\n${content}endstream`);
  }
  const chunks = [Buffer.from('%PDF-1.4\n', 'ascii')], offsets = [];
  let offset = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(offset);
    const bytes = Buffer.from(`${index + 1} 0 obj\n${object}\nendobj\n`, 'ascii');
    chunks.push(bytes); offset += bytes.length;
  }
  const xref = offset;
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    + offsets.map(value => `${String(value).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`, 'ascii'));
  const bytes = Buffer.concat(chunks);
  if (bytes.length > SOVEREIGN_PDF_WRITE_LIMITS_V1.pdfBytes) throw new Error('SOVEREIGN_PDF_OUTPUT_LIMIT');
  return bytes;
}

function normalizeReceipt(value, status, expected) {
  const common = ['schemaVersion', 'ok', 'sha256', 'bytes', 'pageCount', 'targetSha256', 'identity',
    'parentIdentity', 'mutationState', 'stage', 'mutationAttempted', 'retryAllowed', 'atomicDocumentPublication'];
  const success = ['created', 'overwritten', 'filesystem', 'bytesRead', 'durationMs'];
  let receipt;
  try { receipt = captureRecord(value, [...common, ...(value?.ok === true ? success : ['blocker'])]); } catch { return null; }
  if (!receipt || receipt.schemaVersion !== SOVEREIGN_PDF_WRITE_SCHEMA_V1
    || receipt.sha256 !== expected.sha256 || receipt.bytes !== expected.bytes
    || receipt.pageCount !== expected.pageCount || receipt.targetSha256 !== expected.targetSha256
    || receipt.retryAllowed !== false || receipt.atomicDocumentPublication !== false) return null;
  if (receipt.ok === false && status === 2) {
    if (typeof receipt.blocker !== 'string' || receipt.blocker.length > 96 || !/^SOVEREIGN_PDF_[A-Z_]+$/.test(receipt.blocker)
      || (receipt.identity !== null && !IDENTITY.test(receipt.identity || ''))
      || (receipt.parentIdentity !== null && !IDENTITY.test(receipt.parentIdentity || ''))) return null;
    const before = receipt.mutationState === 'NOT_STARTED' && receipt.mutationAttempted === false && receipt.stage === 'PRECONDITION';
    const uncertain = receipt.mutationState === 'UNKNOWN' && receipt.mutationAttempted === true
      && ['NATIVE_CREATE', 'WRITE', 'POSTCONDITION'].includes(receipt.stage);
    if (!before && !uncertain) return null;
    return Object.freeze(receipt);
  }
  if (receipt.ok !== true || status !== 0 || receipt.created !== true || receipt.overwritten !== false
    || receipt.filesystem !== 'NTFS' || receipt.mutationState !== 'CREATED' || receipt.mutationAttempted !== true
    || receipt.stage !== 'POSTCONDITION' || !IDENTITY.test(receipt.identity || '')
    || !IDENTITY.test(receipt.parentIdentity || '') || receipt.identity.slice(0, 8) !== receipt.parentIdentity.slice(0, 8)
    || receipt.bytesRead !== expected.bytes || !integer(receipt.durationMs, SOVEREIGN_PDF_WRITE_LIMITS_V1.nativeMs)) return null;
  return Object.freeze(receipt);
}

// Only trusted composition can supply dependency/process controls. The JSON
// tool descriptor has no bytes, helper source, executable, shell or environment.
export async function runSovereignPdfWriteV1(raw, options = {}) {
  const validation = validateSovereignPdfWriteArgumentsV1(raw);
  if (!validation.ok) return validation;
  const request = validation.args;
  let pdf;
  try { pdf = renderSovereignTextPdfV1(request); }
  catch { return blocked('SOVEREIGN_PDF_RENDER_FAILED'); }
  const expected = metadata(request, pdf);
  const refuse = blocker => blocked(blocker, 'NOT_STARTED', expected);
  if ((options.platform || process.platform) !== 'win32') return refuse('SOVEREIGN_PDF_WINDOWS_REQUIRED');
  let script, nativeSource;
  try {
    const read = options.readFileSyncFn || readFileSync;
    script = Buffer.from(read(SCRIPT)); nativeSource = Buffer.from(read(NATIVE));
    if (digest(script) !== SCRIPT_SHA256 || digest(nativeSource) !== NATIVE_SHA256) return refuse('SOVEREIGN_PDF_SOURCE_MISMATCH');
  } catch { return refuse('SOVEREIGN_PDF_SOURCE_UNAVAILABLE'); }
  const input = JSON.stringify({ path: request.path, contentBase64: pdf.toString('base64'), sha256: expected.sha256,
    pageCount: expected.pageCount, nativeSource: nativeSource.toString('utf8') });
  if (Buffer.byteLength(input, 'utf8') > SOVEREIGN_PDF_WRITE_LIMITS_V1.requestBytes) return refuse('SOVEREIGN_PDF_REQUEST_LIMIT');
  if (options.signal?.aborted) return refuse('SOVEREIGN_PDF_CANCELLED');
  if (activeNativeWrites >= SOVEREIGN_PDF_WRITE_LIMITS_V1.nativeConcurrency) return refuse('SOVEREIGN_PDF_CAPACITY_HELD');
  activeNativeWrites++;
  const timeBound = (value, maximum) => Number.isInteger(value) && value > 0 ? Math.min(value, maximum) : maximum;
  const processMs = timeBound(options.timeoutMs, SOVEREIGN_PDF_WRITE_LIMITS_V1.processMs);
  const graceMs = timeBound(options.terminationGraceMs, SOVEREIGN_PDF_WRITE_LIMITS_V1.terminationGraceMs);
  return new Promise(resolve => {
    let child, spawned = false, finished = false, released = false, terminationReason = '', missingStreams = false;
    let output = [], outputBytes = 0, deadline, terminationDeadline;
    const release = () => { if (!released) { released = true; activeNativeWrites--; } };
    const finish = receipt => {
      if (finished) return;
      finished = true; clearTimeout(deadline); clearTimeout(terminationDeadline);
      options.signal?.removeEventListener('abort', cancel); output = [];
      resolve(receipt);
    };
    const unknown = blocker => blocked(blocker, 'UNKNOWN', expected);
    const terminate = blocker => {
      if (finished || terminationReason) return;
      terminationReason = blocker;
      try { child.kill(); } catch {}
      if (finished) return;
      // A stop request is not exit or output-state proof. Never release this
      // admission slot until the owned child actually closes.
      terminationDeadline = setTimeout(() => finish(unknown(blocker)), graceMs);
      terminationDeadline.unref?.();
    };
    const cancel = () => terminate('SOVEREIGN_PDF_CANCELLED');
    try {
      child = (options.spawnFn || spawn)(POWERSHELL,
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
          Buffer.from(script.toString('utf8'), 'utf16le').toString('base64')],
        { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...createBattleBridgeMinimalChildEnvironment(options.environment || process.env),
            PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules' } });
    } catch {
      // An opaque launcher throw does not prove no OS process was created.
      finish(unknown('SOVEREIGN_PDF_SPAWN_UNPROVEN')); return;
    }
    const onError = () => {
      if (!spawned && !(Number.isSafeInteger(child.pid) && child.pid > 0)) {
        release(); finish(refuse('SOVEREIGN_PDF_SPAWN_FAILED'));
      } else terminate('SOVEREIGN_PDF_PROCESS_ERROR');
    };
    const onClose = (status, signal) => {
      release();
      if (finished) return;
      if (terminationReason) { finish(unknown(terminationReason)); return; }
      if (signal || !Number.isInteger(status)) { finish(unknown('SOVEREIGN_PDF_TERMINAL_UNPROVEN')); return; }
      let receipt;
      try { receipt = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(output)).trim()); } catch {}
      finish(normalizeReceipt(receipt, status, expected) || unknown('SOVEREIGN_PDF_RECEIPT_INVALID'));
    };
    try {
      spawned = Number.isSafeInteger(child.pid) && child.pid > 0;
      child.on('error', onError);
      child.once('close', onClose);
      child.once('spawn', () => { spawned = true; if (missingStreams) terminate('SOVEREIGN_PDF_PROCESS_SETUP_UNPROVEN'); });
      deadline = setTimeout(() => terminate('SOVEREIGN_PDF_TIME_LIMIT'), processMs);
      deadline.unref?.();
      missingStreams = !child.stdout || typeof child.stdout.on !== 'function'
        || !child.stderr || typeof child.stderr.on !== 'function'
        || !child.stdin || typeof child.stdin.on !== 'function' || typeof child.stdin.end !== 'function';
      if (missingStreams) { if (spawned) terminate('SOVEREIGN_PDF_PROCESS_SETUP_UNPROVEN'); return; }
      child.stdout.on('data', chunk => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > SOVEREIGN_PDF_WRITE_LIMITS_V1.outputBytes) { output = []; terminate('SOVEREIGN_PDF_OUTPUT_LIMIT'); }
        else if (!finished && !terminationReason) output.push(Buffer.from(chunk));
      });
      child.stderr.on('data', chunk => {
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > SOVEREIGN_PDF_WRITE_LIMITS_V1.outputBytes) terminate('SOVEREIGN_PDF_OUTPUT_LIMIT');
      });
      child.stdout.on('error', () => terminate('SOVEREIGN_PDF_OUTPUT_FAILED'));
      child.stderr.on('error', () => terminate('SOVEREIGN_PDF_OUTPUT_FAILED'));
      child.stdin.on('error', () => terminate('SOVEREIGN_PDF_INPUT_FAILED'));
      options.signal?.addEventListener('abort', cancel, { once: true });
      if (options.signal?.aborted) cancel();
      if (!finished && !terminationReason) {
        try { child.stdin.end(input); } catch { terminate('SOVEREIGN_PDF_INPUT_FAILED'); }
      }
    } catch { terminate('SOVEREIGN_PDF_PROCESS_SETUP_UNPROVEN'); }
  });
}
