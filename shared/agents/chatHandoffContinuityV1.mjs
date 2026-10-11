export const CHAT_HANDOFF_CONTINUITY_SCHEMA = 'stephanos.chat-handoff-continuity.v1';
export const CHAT_HANDOFF_FAST_RELAY_HEARTBEAT_MAX_AGE_MS = 30_000;

const FAST_RELAY_STATES = new Set(['FAST_ACTIVE', 'FAST_BUSY', 'FAST_RECOVERED', 'FAST_CHECKING']);
const DIRECT_ACCEPTED = new Set(['ACCEPTED', 'DIRECT_ACCEPTED', 'WORK_ACCEPTED']);
const DIRECT_FAILED = new Set(['REJECTED', 'DECLINED', 'UNAVAILABLE', 'FAILED', 'BLOCKED']);

function text(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function upper(value, fallback = 'UNKNOWN') {
  return text(value, fallback).toUpperCase();
}

function sovereignRelayHeartbeatAgeMs(heartbeatAtUtc, nowMs) {
  const heartbeatAtMs = Date.parse(text(heartbeatAtUtc));
  if (!Number.isFinite(heartbeatAtMs) || !Number.isFinite(nowMs) || heartbeatAtMs > nowMs) return null;
  return Math.max(0, nowMs - heartbeatAtMs);
}

export function projectChatHandoffContinuity(input = {}, {
  nowMs = Date.now(),
  fastRelayHeartbeatMaxAgeMs = CHAT_HANDOFF_FAST_RELAY_HEARTBEAT_MAX_AGE_MS,
} = {}) {
  const directHandoffStatus = upper(input.directHandoffStatus);
  const relay = input.sovereignRelay && typeof input.sovereignRelay === 'object' && !Array.isArray(input.sovereignRelay)
    ? input.sovereignRelay
    : {};
  const relayDeliveryState = upper(relay.deliveryState);
  const relayHeartbeatAgeMs = sovereignRelayHeartbeatAgeMs(relay.heartbeatAtUtc, nowMs);
  const relayHeartbeatCurrent = Number.isFinite(relayHeartbeatAgeMs)
    && Number.isFinite(fastRelayHeartbeatMaxAgeMs)
    && fastRelayHeartbeatMaxAgeMs >= 0
    && relayHeartbeatAgeMs <= fastRelayHeartbeatMaxAgeMs;
  const localReady = input.localSovereignCommanderAvailable === true;
  const fastRelayReady = relay.daemonHealthy === true
    && relay.carrierHealthy === true
    && relayHeartbeatCurrent
    && FAST_RELAY_STATES.has(relayDeliveryState);
  const scheduledMailboxReady = input.scheduledMailboxAvailable === true
    || (relayHeartbeatCurrent && (
      relay.scheduledMailboxFallbackExpected === true
      || relayDeliveryState === 'FALLBACK_COVERED'
    ));
  const tailscaleReady = input.tailscalePrivateAvailable === true;

  let selectedRoute = 'HOLD_NO_ADMITTED_TRANSPORT';
  let state = 'BLOCKED';
  let reason = 'No admitted handoff carrier has current availability evidence.';

  if (DIRECT_ACCEPTED.has(directHandoffStatus)) {
    selectedRoute = 'CHATGPT_WORK_DIRECT';
    state = 'DIRECT';
    reason = 'The native ChatGPT Work handoff was accepted.';
  } else if (localReady) {
    selectedRoute = 'LOCAL_SOVEREIGN_COMMANDER_MCP';
    state = 'CONTINUITY_ROUTE_SELECTED';
    reason = 'Local Sovereign Commander is available; preserve the same task identity on the sovereign local route.';
  } else if (fastRelayReady) {
    selectedRoute = 'SOVEREIGN_RELAY_FAST_CARRIER';
    state = 'CONTINUITY_ROUTE_SELECTED';
    reason = DIRECT_FAILED.has(directHandoffStatus)
      ? 'The native handoff failed before a durable execution receipt; continue through the live Sovereign Relay fast carrier.'
      : 'Use the live Sovereign Relay fast carrier when the native handoff is not proven accepted.';
  } else if (scheduledMailboxReady) {
    selectedRoute = 'SCHEDULED_GITHUB_MAILBOX';
    state = 'FALLBACK_ROUTE_SELECTED';
    reason = DIRECT_FAILED.has(directHandoffStatus)
      ? 'The native handoff failed before a durable execution receipt; continue through the independently scheduled guarded GitHub mailbox.'
      : 'Use the independently scheduled guarded GitHub mailbox because no faster admitted carrier is proven available.';
  } else if (tailscaleReady) {
    selectedRoute = 'TAILSCALE_PRIVATE';
    state = 'FALLBACK_ROUTE_SELECTED';
    reason = 'Use the authorised private Tailscale route because the preferred handoff carriers are not currently proven available.';
  }

  return Object.freeze({
    schemaVersion: CHAT_HANDOFF_CONTINUITY_SCHEMA,
    directHandoffStatus,
    directHandoffFailedBeforeReceipt: DIRECT_FAILED.has(directHandoffStatus),
    selectedRoute,
    state,
    reason,
    relayDeliveryState,
    relayCarrierHealthy: relay.carrierHealthy === true,
    relayHeartbeatAgeMs,
    relayHeartbeatCurrent,
    sameTaskIdentityRequired: true,
    duplicateDispatchAllowed: false,
    authorityWideningAllowed: false,
    arbitraryShellAllowed: false,
    mergeAuthorityAdded: false,
    operatorActionRequired: selectedRoute === 'HOLD_NO_ADMITTED_TRANSPORT',
    exactNextAction: selectedRoute === 'HOLD_NO_ADMITTED_TRANSPORT'
      ? 'Refresh admitted sovereign transport evidence; do not retry a known-broken handoff surface or invent execution success.'
      : 'Continue the same bounded handoff through the selected route and require its own durable receipt before claiming execution.',
  });
}
