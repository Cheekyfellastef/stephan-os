import { normalizeOpenClawReviewDecision } from './openClawReviewDecision.mjs';

export const OPENCLAW_REVIEW_DECISION_STORAGE_KEY = 'stephanos.openclaw.reviewDecisions.v1';

function readRaw(storage) {
  if (!storage?.getItem) return {};
  try {
    const raw = storage.getItem(OPENCLAW_REVIEW_DECISION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function loadOpenClawReviewDecisions({ storage = globalThis?.localStorage } = {}) {
  return readRaw(storage);
}

export function saveOpenClawReviewDecision({ decision, storage = globalThis?.localStorage } = {}) {
  if (!decision) return null;
  const normalized = normalizeOpenClawReviewDecision(decision, { packetId: decision.packetId });
  const all = readRaw(storage);
  all[normalized.packetId] = normalized;
  try { storage?.setItem?.(OPENCLAW_REVIEW_DECISION_STORAGE_KEY, JSON.stringify(all)); } catch {}
  return normalized;
}

export function clearOpenClawReviewDecision({ packetId, storage = globalThis?.localStorage } = {}) {
  if (!packetId) return;
  const all = readRaw(storage);
  delete all[packetId];
  try { storage?.setItem?.(OPENCLAW_REVIEW_DECISION_STORAGE_KEY, JSON.stringify(all)); } catch {}
}

export function listOpenClawReviewDecisionsByPacketId({ packetId, storage = globalThis?.localStorage } = {}) {
  const all = readRaw(storage);
  if (!packetId) return Object.values(all);
  return all[packetId] ? [all[packetId]] : [];
}
