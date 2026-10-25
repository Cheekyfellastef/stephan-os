import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createBattleBridgeMinimalChildEnvironment } from './battleBridgeExecutionBoundaryV1.mjs';

const SCHEMA = 'stephanos.sovereign-directory-create.v1';
const IDENTITY = /^[a-f0-9]{8}:[a-f0-9]{16}$/;
const SCRIPT = fileURLToPath(new URL('../../scripts/windows/sovereign-create-directory.ps1', import.meta.url));
const NATIVE = fileURLToPath(new URL('../../scripts/windows/SovereignDirectoryCreateV1.cs', import.meta.url));
// Reviewed helper-byte identities. Read once, verify, and execute only the
// captured buffers; a later on-disk replacement cannot alter the launched code.
const SCRIPT_SHA256 = '26b0e50b68df2a3af481366aa74d5a3701d5c32c94e36dd4eb4a742e8b3059d1';
const NATIVE_SHA256 = 'f522113d39222214dfe89c3ff8d9248d25584aecc66e1ce5ff1c83324344526b';

export function validateSovereignDirectoryTargetV1(path) {
  if (typeof path !== 'string' || path.length > 1024 || !/^[a-z]:\\[^\\]/i.test(path)) return false;
  return path.slice(3).split('\\').every(part => part.length > 0 && part.length <= 255
    && part !== '.' && part !== '..' && !/[ .]$/.test(part)
    && !/[\x00-\x1f<>:"/|?*]/.test(part)
    && !/^(?:CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9\u00b9\u00b2\u00b3]|LPT[1-9\u00b9\u00b2\u00b3])(?:\.|$)/i.test(part));
}

export function executeSovereignDirectoryCreateV1(path, options = {}) {
  const blocked = (blocker, mutationState = 'NOT_STARTED') => ({
    ok: false, schemaVersion: SCHEMA, blocker, mutationState,
  });
  if (!validateSovereignDirectoryTargetV1(path)) return blocked('SOVEREIGN_DIRECTORY_TARGET_INVALID');
  if ((options.platform || process.platform) !== 'win32') return blocked('SOVEREIGN_DIRECTORY_WINDOWS_REQUIRED');
  // Exact path is stdin data to one fixed installed script, never shell source.
  let script, nativeSource;
  try {
    const read = options.readFileSyncFn || readFileSync;
    script = read(SCRIPT); nativeSource = read(NATIVE);
    if (createHash('sha256').update(script).digest('hex') !== SCRIPT_SHA256
      || createHash('sha256').update(nativeSource).digest('hex') !== NATIVE_SHA256)
      return blocked('SOVEREIGN_DIRECTORY_SOURCE_MISMATCH');
  } catch { return blocked('SOVEREIGN_DIRECTORY_SOURCE_UNAVAILABLE'); }
  let result;
  try { result = (options.spawnSyncFn || spawnSync)(
    'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand',
      Buffer.from(script.toString('utf8'), 'utf16le').toString('base64')],
    { input: JSON.stringify({ path, nativeSource: nativeSource.toString('utf8') }), encoding: 'utf8', shell: false, windowsHide: true,
      timeout: 15_000, maxBuffer: 16 * 1024,
      env: createBattleBridgeMinimalChildEnvironment(options.environment || process.env) });
  } catch { return blocked('SOVEREIGN_DIRECTORY_TERMINAL_UNPROVEN', 'UNKNOWN'); }
  // Missing terminal output cannot authorize retry or assert that nothing ran.
  if (result?.error || result?.signal || !Number.isInteger(result?.status))
    return blocked('SOVEREIGN_DIRECTORY_TERMINAL_UNPROVEN', 'UNKNOWN');
  let receipt;
  try { receipt = JSON.parse(String(result.stdout || '').trim()); } catch {}
  if (receipt?.schemaVersion !== SCHEMA) return blocked('SOVEREIGN_DIRECTORY_RECEIPT_INVALID', 'UNKNOWN');
  if (result.status !== 0 || receipt.ok !== true) {
    return blocked(/^SOVEREIGN_DIRECTORY_[A-Z_]+$/.test(receipt.blocker || '')
      ? receipt.blocker : 'SOVEREIGN_DIRECTORY_CREATE_FAILED',
    receipt.mutationState === 'NOT_STARTED' ? 'NOT_STARTED' : 'UNKNOWN');
  }
  if (receipt.path !== path || receipt.created !== true || receipt.recursive !== false
    || receipt.mutationState !== 'CREATED' || !IDENTITY.test(receipt.identity || '')
    || !IDENTITY.test(receipt.parentIdentity || ''))
    return blocked('SOVEREIGN_DIRECTORY_RECEIPT_INVALID', 'UNKNOWN');
  return Object.freeze({ ok: true, schemaVersion: SCHEMA, path, created: true, recursive: false,
    identity: receipt.identity, parentIdentity: receipt.parentIdentity, mutationState: 'CREATED' });
}
