const DEFAULT_ENDPOINT = 'http://127.0.0.1:8787/api/ai/chat';
const DEFAULT_TIMEOUT_MS = 90000;
const MAX_MESSAGE_LENGTH = 4000;

export const STEPHANOS_AWARENESS_VERSION = 'stephanos-whatsapp-awareness-pack-v1';

const FRESHNESS_PATTERNS = [
  /\b(current|currently|latest|today|tonight|now|recent|recently|up[- ]to[- ]date)\b/i,
  /\b(has|have|did|does|is|are|was|were)\b.{0,40}\b(resign(?:ed)?|quit|leave|left|appointed|elected|fired|sacked|died|closed|launched|released)\b/i,
  /\b(who is|who's|still (?:the|in|serving)|what happened|breaking news)\b/i,
];

const PROJECT_STATE_PATTERNS = [
  /\b(where are we|project status|current state|mission status|status)\b/i,
  /\b(what changed|what's changed|what did we unlock|unlocked today|recent changes)\b/i,
  /\b(blocked|blocker|blockers|proof gap|needs proof|what is blocked)\b/i,
  /\b(what should i do next|next move|next action|smallest action|what now)\b/i,
];

const NEXT_MOVE_PATTERNS = [
  /\b(what should i do next|next move|next action|smallest action|what now)\b/i,
  /\b(blocked|blocker|blockers|proof gap|needs proof|acceptance)\b/i,
];

export function normalizeCommandInput(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function parseStephanosCommand(value) {
  const message = normalizeCommandInput(value);
  if (!message) {
    return {
      ok: false,
      error: 'Usage: /stephanos <message>',
    };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      ok: false,
      error: `Stephanos messages are limited to ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }
  return { ok: true, message };
}

export function resolveFreshnessContext(message) {
  const freshnessRequired = FRESHNESS_PATTERNS.some((pattern) => pattern.test(message));
  if (!freshnessRequired) {
    return {
      freshnessNeed: 'normal',
      freshnessReason: 'whatsapp-command-no-explicit-freshness-signal',
      staleRisk: 'normal',
      staleFallbackPermitted: true,
    };
  }
  return {
    freshnessNeed: 'high',
    freshnessReason: 'whatsapp-command-current-or-changing-fact',
    staleRisk: 'high',
    staleFallbackPermitted: false,
  };
}

export function classifyStephanosIntent(message) {
  const normalized = normalizeCommandInput(message);
  const wantsProjectState = PROJECT_STATE_PATTERNS.some((pattern) => pattern.test(normalized));
  const wantsNextMove = NEXT_MOVE_PATTERNS.some((pattern) => pattern.test(normalized));
  if (wantsNextMove) {
    return 'project-next-move';
  }
  if (wantsProjectState) {
    return 'project-awareness';
  }
  return 'general-stephanos-question';
}

export function buildAwarenessPack(message) {
  const intent = classifyStephanosIntent(message);
  const projectAware = intent === 'project-awareness' || intent === 'project-next-move';
  return {
    version: STEPHANOS_AWARENESS_VERSION,
    issue: 1280,
    intent,
    mode: projectAware ? 'bounded-project-awareness' : 'bounded-general-awareness',
    responseContract: [
      'missionSummary',
      'currentState',
      'recentChanges',
      'activeBlockers',
      'recommendedNextAction',
      'proofFreshness',
      'approvalRequired',
    ],
    freshnessLabels: ['LIVE', 'RECENT', 'STALE', 'UNKNOWN'],
    readOnlySources: [
      'canonical-github-issues-prs',
      'accepted-proof-packets',
      'openclaw-runtime-status-when-available',
      'operator-approved-mission-context',
    ],
    preservation: {
      stephanosPr1275: true,
      standalone: true,
      scoutCoderDash: true,
      scoutCoderUnderscore: true,
      plainChatClean: true,
    },
    guardrails: {
      mutationAuthority: 'approval-gated',
      noInventedRuntimeState: true,
      compactWhatsAppReply: true,
      exposeMissingProof: true,
    },
  };
}

export function buildNextMoveAdvisor(message) {
  const intent = classifyStephanosIntent(message);
  return {
    version: 'stephanos-next-move-advisor-v1',
    enabled: intent === 'project-awareness' || intent === 'project-next-move',
    issue: 1280,
    rules: [
      'recommend-smallest-safe-action',
      'prefer-evidence-over-assumption',
      'separate-proof-gaps-from-feature-work',
      'route-mutations-through-operator-approval',
      'return-local-windows-or-whatsapp-proof-block-only-when-needed',
    ],
    outputFields: [
      'currentOwner',
      'nextOwner',
      'handoffState',
      'smallestNextOperatorAction',
      'proofBlock',
    ],
    defaultUnknownStateAction: 'Say what evidence is missing instead of inventing live state.',
  };
}

export function validateLoopbackEndpoint(value = DEFAULT_ENDPOINT) {
  let endpoint;
  try {
    endpoint = new URL(String(value || DEFAULT_ENDPOINT));
  } catch {
    throw new Error('Stephanos endpoint is not a valid URL.');
  }
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (endpoint.protocol !== 'http:' || !allowedHosts.has(endpoint.hostname)) {
    throw new Error('Stephanos endpoint must use loopback HTTP.');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Stephanos endpoint must not contain credentials, query parameters, or fragments.');
  }
  if (endpoint.pathname.replace(/\/+$/, '') !== '/api/ai/chat') {
    throw new Error('Stephanos endpoint must target /api/ai/chat.');
  }
  return endpoint.toString();
}

export function buildStephanosRequest(message) {
  const freshnessContext = resolveFreshnessContext(message);
  const awarenessPack = buildAwarenessPack(message);
  return {
    prompt: message,
    provider: 'ollama',
    routeMode: 'auto',
    fallbackEnabled: true,
    freshnessContext,
    staleFallbackPermitted: freshnessContext.staleFallbackPermitted,
    streaming_mode_preference: 'off',
    awarenessPack,
    nextMoveAdvisor: buildNextMoveAdvisor(message),
    runtimeContext: {
      source: 'openclaw-whatsapp-stephanos-command',
      channel: 'whatsapp',
      operatorInitiated: true,
      awarenessPackVersion: awarenessPack.version,
      mutationAuthority: 'approval-gated',
    },
  };
}

export function extractStephanosReply(payload) {
  const text = typeof payload?.output_text === 'string'
    ? payload.output_text.trim()
    : typeof payload?.data?.output_text === 'string'
      ? payload.data.output_text.trim()
      : '';
  if (!text) {
    throw new Error('Stephanos returned no answer text.');
  }
  return text;
}

export async function requestStephanos({
  message,
  endpoint = DEFAULT_ENDPOINT,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchFn = globalThis.fetch,
} = {}) {
  const parsed = parseStephanosCommand(message);
  if (!parsed.ok) throw new Error(parsed.error);
  if (typeof fetchFn !== 'function') throw new Error('Fetch is unavailable.');
  const safeEndpoint = validateLoopbackEndpoint(endpoint);
  const boundedTimeoutMs = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 1000), 120000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), boundedTimeoutMs);
  try {
    const response = await fetchFn(safeEndpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'x-request-source': 'openclaw-whatsapp-stephanos-command',
      },
      body: JSON.stringify(buildStephanosRequest(parsed.message)),
      signal: controller.signal,
    });
    if (!response?.ok) {
      throw new Error(`Stephanos request failed with HTTP ${response?.status || 'unknown'}.`);
    }
    return {
      text: extractStephanosReply(await response.json()),
      endpoint: safeEndpoint,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const STEPHANOS_COMMAND_DEFAULTS = Object.freeze({
  endpoint: DEFAULT_ENDPOINT,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxMessageLength: MAX_MESSAGE_LENGTH,
  awarenessPackVersion: STEPHANOS_AWARENESS_VERSION,
});
