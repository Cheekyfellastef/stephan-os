import { buildOpenClawCodexReviewResult } from './openClawCodexReviewResult.mjs';

export const OPENCLAW_CODEX_REVIEW_RESULT_STORAGE_KEY = 'stephanos.openclaw.codexReviewResults.v1';

function getStorage(storage) {
  if (storage && typeof storage.getItem === 'function') return storage;
  if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  return null;
}

export function loadOpenClawCodexReviewResults({ storage } = {}) {
  const s = getStorage(storage);
  if (!s) return {};
  try { return JSON.parse(s.getItem(OPENCLAW_CODEX_REVIEW_RESULT_STORAGE_KEY) || '{}') || {}; } catch { return {}; }
}

export function saveOpenClawCodexReviewResult({ result = {}, storage } = {}) {
  const s = getStorage(storage);
  const normalized = buildOpenClawCodexReviewResult(result, { packetId: result?.packetId || 'none' });
  if (!s) return normalized;
  const all = loadOpenClawCodexReviewResults({ storage: s });
  all[normalized.packetId] = normalized;
  s.setItem(OPENCLAW_CODEX_REVIEW_RESULT_STORAGE_KEY, JSON.stringify(all));
  return normalized;
}

export function clearOpenClawCodexReviewResult({ packetId = 'none', storage } = {}) {
  const s = getStorage(storage);
  if (!s) return;
  const all = loadOpenClawCodexReviewResults({ storage: s });
  delete all[packetId];
  s.setItem(OPENCLAW_CODEX_REVIEW_RESULT_STORAGE_KEY, JSON.stringify(all));
}
