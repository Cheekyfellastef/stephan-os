const DEFAULT_OPENCLAW_HEALTH_ENDPOINT = 'http://127.0.0.1:8790/health';
const DEFAULT_STEPHANOS_HEALTH_ENDPOINT = 'http://127.0.0.1:8787/api/health';
const DEFAULT_TIMEOUT_MS = 2500;
const MAX_COMMAND_LENGTH = 64;

const COMMANDS = Object.freeze({
  HELP: 'help',
  OPENCLAW_STATUS: 'openclaw-status',
  STATUS: 'status',
});

const HELP_TEXT = [
  'Stephanos Ignite V1A (read-only):',
  '/stephanos-ignite help',
  '/stephanos-ignite openclaw-status',
  '/stephanos-ignite status',
  'Mutation commands are not available in V1A.',
].join('\n');

export function normalizeCommandInput(value) {
  return typeof value === 'string' ? value.trim().replace(/^\/stephanos-ignite\b/i, '').trim() : '';
}

export function parseStephanosIgniteCommand(value) {
  const input = normalizeCommandInput(value);
  if (!input) return { ok: true, command: COMMANDS.HELP };
  if (input.length > MAX_COMMAND_LENGTH) return { ok: false, command: COMMANDS.HELP, reason: 'Command is too long for V1A.' };
  if (/\s/.test(input)) return { ok: false, command: COMMANDS.HELP, reason: 'Arguments are not accepted in V1A.' };
  if (Object.values(COMMANDS).includes(input)) return { ok: true, command: input };
  return { ok: false, command: COMMANDS.HELP, reason: `Unknown /stephanos-ignite command: ${input}` };
}

export function buildHelpReply(reason = '') {
  return reason ? `${reason}\n\n${HELP_TEXT}` : HELP_TEXT;
}

export function validateLoopbackHealthEndpoint(value, allowedPath) {
  let endpoint;
  try {
    endpoint = new URL(String(value || ''));
  } catch {
    throw new Error('Health endpoint is not a valid URL.');
  }
  const allowedHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
  if (endpoint.protocol !== 'http:' || !allowedHosts.has(endpoint.hostname)) {
    throw new Error('Health endpoint must use loopback HTTP.');
  }
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Health endpoint must not contain credentials, query parameters, or fragments.');
  }
  if (endpoint.pathname.replace(/\/+$/, '') !== allowedPath) {
    throw new Error(`Health endpoint must target ${allowedPath}.`);
  }
  return endpoint.toString();
}

function safeStatusToken(value, fallback = 'unknown') {
  const token = String(value || fallback).trim().toLowerCase().replace(/[^a-z0-9._-]/g, '-').slice(0, 40);
  return token || fallback;
}

async function fetchJson({ endpoint, timeoutMs, fetchFn }) {
  if (typeof fetchFn !== 'function') throw new Error('Fetch is unavailable.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, 500), 10000));
  try {
    const response = await fetchFn(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json', 'cache-control': 'no-cache' },
      signal: controller.signal,
    });
    const payload = response?.ok ? await response.json() : null;
    return { ok: response?.ok === true, status: response?.status || 'unknown', payload };
  } finally {
    clearTimeout(timer);
  }
}

export async function getOpenClawStatusProof({ endpoint = DEFAULT_OPENCLAW_HEALTH_ENDPOINT, timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = globalThis.fetch } = {}) {
  const safeEndpoint = validateLoopbackHealthEndpoint(endpoint, '/health');
  try {
    const result = await fetchJson({ endpoint: safeEndpoint, timeoutMs, fetchFn });
    const available = result.ok && result.payload?.state === 'available';
    const executionAllowed = result.payload?.executionAllowed === true;
    return `OpenClaw: ${available ? 'available' : 'unavailable'}; endpoint=/health; http=${result.status}; executionAllowed=${executionAllowed ? 'true' : 'false'}; mutation=blocked.`;
  } catch {
    return 'OpenClaw: unavailable; endpoint=/health; http=unreachable; executionAllowed=false; mutation=blocked.';
  }
}

export async function getStephanosStatusProof({ endpoint = DEFAULT_STEPHANOS_HEALTH_ENDPOINT, timeoutMs = DEFAULT_TIMEOUT_MS, fetchFn = globalThis.fetch } = {}) {
  const safeEndpoint = validateLoopbackHealthEndpoint(endpoint, '/api/health');
  try {
    const result = await fetchJson({ endpoint: safeEndpoint, timeoutMs, fetchFn });
    const health = safeStatusToken(result.payload?.status || result.payload?.health || (result.ok ? 'reachable' : 'unhealthy'));
    return `Stephanos: ${result.ok ? 'reachable' : 'unreachable'}; endpoint=/api/health; http=${result.status}; health=${health}; mutation=blocked.`;
  } catch {
    return 'Stephanos: unreachable; endpoint=/api/health; http=unreachable; health=unknown; mutation=blocked.';
  }
}

export async function routeStephanosIgniteCommand(value, options = {}) {
  const parsed = parseStephanosIgniteCommand(value);
  if (!parsed.ok || parsed.command === COMMANDS.HELP) return { text: buildHelpReply(parsed.reason) };
  if (parsed.command === COMMANDS.OPENCLAW_STATUS) return { text: await getOpenClawStatusProof(options.openclaw || options) };
  if (parsed.command === COMMANDS.STATUS) return { text: await getStephanosStatusProof(options.stephanos || options) };
  return { text: buildHelpReply('Command is not available in V1A.') };
}

export const STEPHANOS_IGNITE_COMMAND_DEFAULTS = Object.freeze({
  openclawHealthEndpoint: DEFAULT_OPENCLAW_HEALTH_ENDPOINT,
  stephanosHealthEndpoint: DEFAULT_STEPHANOS_HEALTH_ENDPOINT,
  timeoutMs: DEFAULT_TIMEOUT_MS,
  maxCommandLength: MAX_COMMAND_LENGTH,
});
