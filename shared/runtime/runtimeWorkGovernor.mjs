const LEASE_KEY = 'stephanos.runtimeWorkGovernor.lease.v1';
const CHANNEL_NAME = 'stephanos-runtime-work-governor';
const HEARTBEAT_MS = 2000;
const LEASE_TTL_MS = 7000;

function nowMs(now = () => Date.now()) { return Number(now()) || Date.now(); }

function safeParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function readLease(storage) {
  try { return safeParse(storage?.getItem?.(LEASE_KEY)); } catch { return null; }
}

function writeLease(storage, lease) {
  try { storage?.setItem?.(LEASE_KEY, JSON.stringify(lease)); } catch { /* noop */ }
}

function removeLease(storage) {
  try { storage?.removeItem?.(LEASE_KEY); } catch { /* noop */ }
}

export function createRuntimeWorkGovernor({ tabId = `tab-${Math.random().toString(36).slice(2)}`, documentImpl = globalThis.document, storage = globalThis.localStorage, now = () => Date.now(), heartbeatMs = HEARTBEAT_MS, leaseTtlMs = LEASE_TTL_MS, setIntervalImpl = globalThis.setInterval?.bind(globalThis), clearIntervalImpl = globalThis.clearInterval?.bind(globalThis), BroadcastChannelImpl = globalThis.BroadcastChannel, onStateChange = null } = {}) {
  let channel = null;
  let timerId = null;
  let destroyed = false;
  let state = { mode: 'passive', leader: false, reason: 'initializing', hidden: documentImpl?.visibilityState === 'hidden', duplicateTabDetected: false, lastGovernorHeartbeat: '' };

  const emit = () => onStateChange?.({ ...state });

  function computeMode(leader, hidden) {
    if (hidden) return 'hidden';
    return leader ? 'active' : 'standby';
  }

  function heartbeat(reason = 'heartbeat') {
    if (destroyed) return;
    const ts = nowMs(now);
    const hidden = documentImpl?.visibilityState === 'hidden';
    const currentLease = readLease(storage);
    const leaseExpired = !currentLease || (ts - Number(currentLease.heartbeatAt || 0)) > leaseTtlMs;
    const sameLeader = currentLease?.tabId === tabId;
    const shouldLead = !hidden && (leaseExpired || sameLeader);
    const leader = shouldLead;

    if (leader) {
      writeLease(storage, { tabId, heartbeatAt: ts });
    }

    const duplicateTabDetected = !leader && Boolean(currentLease?.tabId && currentLease.tabId !== tabId);
    state = {
      ...state,
      hidden,
      leader,
      mode: computeMode(leader, hidden),
      reason: hidden ? 'document-hidden' : (leader ? reason : (duplicateTabDetected ? 'leader-exists' : 'passive')),
      duplicateTabDetected,
      lastGovernorHeartbeat: new Date(ts).toISOString(),
    };
    emit();
    channel?.postMessage?.({ type: 'heartbeat', tabId, ts, leader });
  }

  function start() {
    if (destroyed) return;
    if (BroadcastChannelImpl) {
      channel = new BroadcastChannelImpl(CHANNEL_NAME);
      channel.onmessage = () => heartbeat('channel-sync');
    }
    documentImpl?.addEventListener?.('visibilitychange', () => heartbeat('visibility-change'));
    globalThis.addEventListener?.('storage', (event) => {
      if (event?.key === LEASE_KEY) heartbeat('storage-sync');
    });
    heartbeat('startup');
    timerId = setIntervalImpl?.(() => heartbeat('interval'), heartbeatMs) ?? null;
  }

  function stop() {
    destroyed = true;
    if (timerId != null) clearIntervalImpl?.(timerId);
    const current = readLease(storage);
    if (current?.tabId === tabId) removeLease(storage);
    if (channel) channel.close();
  }

  return { start, stop, getState: () => ({ ...state }), heartbeat };
}
