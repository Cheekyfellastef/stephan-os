import { readFileSync, readdirSync, statSync } from 'node:fs';
import { win32 } from 'node:path';

const MAX_BACKEND_START_LOG_BYTES = 256 * 1024;
const MAX_BACKEND_START_LOGS = 6;
const RECENT_ATTEMPT_SLOP_MS = 5_000;
const SAFE_BACKEND_START_LOG = /^backend-start-\d{8}-\d{6}(?:\.stderr)?\.log$/;
const SAFE_BLOCKER = /^[A-Z0-9_:-]{3,120}$/;

const FIXED_TEXT_CLASSIFIERS = Object.freeze([
  [/Backend startup requires source-tracked files to be unmodified at exact head\./i, 'BACKEND_START_SOURCE_DIRTY'],
  [/Backend startup requires synchronized main:/i, 'BACKEND_START_SOURCE_NOT_SYNCHRONIZED'],
  [/Backend startup requires canonical upstream origin\/main/i, 'BACKEND_START_UPSTREAM_MISMATCH'],
  [/Required canonical executable is missing:/i, 'BACKEND_START_EXECUTABLE_MISSING'],
  [/ERR_MODULE_NOT_FOUND/i, 'BACKEND_START_MODULE_NOT_FOUND'],
  [/ERR_UNSUPPORTED_ESM_URL_SCHEME/i, 'BACKEND_START_ESM_URL_SCHEME_UNSUPPORTED'],
  [/\bEADDRINUSE\b/i, 'BACKEND_START_PORT_IN_USE'],
  [/\bSyntaxError\b/i, 'BACKEND_START_SYNTAX_ERROR'],
]);

export function classifyBackendStartupFailureText(value = '') {
  const text = String(value || '');
  const exactToken = text.match(/\b(BACKEND_(?:CHILD|EXPECTED_HEAD_HANDOFF|START|EXACT_HEAD)_[A-Z0-9_:-]{3,100})\b/);
  if (exactToken && SAFE_BLOCKER.test(exactToken[1])) return exactToken[1];
  for (const [pattern, blocker] of FIXED_TEXT_CLASSIFIERS) {
    if (pattern.test(text)) return blocker;
  }
  return '';
}

export function classifyLatestBackendStartupFailure(repoRoot, {
  attemptStartedAtMs = 0,
  nowMs = Date.now(),
  readdirSyncFn = readdirSync,
  statSyncFn = statSync,
  readFileSyncFn = readFileSync,
} = {}) {
  const root = win32.resolve(String(repoRoot || ''), 'logs', 'battle-bridge');
  const minimumMtime = Math.max(0, Number(attemptStartedAtMs || 0) - RECENT_ATTEMPT_SLOP_MS);
  let names = [];
  try {
    names = readdirSyncFn(root).filter((name) => SAFE_BACKEND_START_LOG.test(String(name)));
  } catch {
    return Object.freeze({ blocker: '', classified: false, rawEvidencePublished: false });
  }

  const candidates = [];
  for (const name of names) {
    const file = win32.resolve(root, name);
    if (!file.toLowerCase().startsWith(`${root.toLowerCase()}\\`)) continue;
    try {
      const info = statSyncFn(file);
      const mtimeMs = Number(info?.mtimeMs || 0);
      const size = Number(info?.size || 0);
      if (!info?.isFile?.() || size <= 0 || size > MAX_BACKEND_START_LOG_BYTES) continue;
      if (minimumMtime && mtimeMs < minimumMtime) continue;
      if (mtimeMs > nowMs + RECENT_ATTEMPT_SLOP_MS) continue;
      candidates.push({ file, mtimeMs });
    } catch {}
  }

  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
  for (const candidate of candidates.slice(0, MAX_BACKEND_START_LOGS)) {
    try {
      const blocker = classifyBackendStartupFailureText(readFileSyncFn(candidate.file, 'utf8'));
      if (blocker) {
        return Object.freeze({
          blocker,
          classified: true,
          evidenceClass: 'CANONICAL_BACKEND_START_LOG_CLASSIFICATION',
          rawEvidencePublished: false,
        });
      }
    } catch {}
  }

  return Object.freeze({ blocker: '', classified: false, rawEvidencePublished: false });
}
