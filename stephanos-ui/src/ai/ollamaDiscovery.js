const OLLAMA_DEFAULT_PORT = '11434';
const DEFAULT_TIMEOUT_MS = 1800;

function parseUrl(value = '') {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizeHostname(value = '') {
  return String(value || '').trim().replace(/^\[(.*)\]$/, '$1').toLowerCase();
}

export function isLoopbackHostname(hostname = '') {
  const normalized = normalizeHostname(hostname);
  return normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
}

export function isPrivateIpv4(hostname = '') {
  const normalized = normalizeHostname(hostname);
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return false;
  const [a, b] = normalized.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

export function isLikelyLocalHostname(hostname = '') {
  const normalized = normalizeHostname(hostname);
  return normalized.endsWith('.local') || (!normalized.includes('.') && /[a-z]/i.test(normalized));
}

export function isPrivateOrLocalHostname(hostname = '') {
  const normalized = normalizeHostname(hostname);
  return isLoopbackHostname(normalized) || isPrivateIpv4(normalized) || isLikelyLocalHostname(normalized);
}

export function normalizeOllamaBaseUrl(value = '') {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';

  const rawUrl = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const parsed = parseUrl(rawUrl);
  if (!parsed || !parsed.hostname) return '';

  const protocol = parsed.protocol === 'https:' ? 'http:' : (parsed.protocol || 'http:');
  const auth = parsed.username || parsed.password ? `${parsed.username}${parsed.password ? `:${parsed.password}` : ''}@` : '';
  const host = parsed.hostname.includes(':') ? `[${parsed.hostname}]` : parsed.hostname;
  const port = parsed.port || OLLAMA_DEFAULT_PORT;
  return `${protocol}//${auth}${host}:${port}`;
}

function buildEndpoint(baseURL, path) {
  return `${baseURL.replace(/\/$/, '')}${path}`;
}

function classifyProbeError(error, responseStatus = null) {
  if (error?.invalidJson) {
    return {
      bucket: 'reachable_but_invalid_response',
      reason: 'That address answered, but it did not return the kind of response Ollama should return.',
    };
  }

  if (responseStatus && responseStatus !== 200) {
    return {
      bucket: 'reachable_but_invalid_response',
      reason: `That address responded, but not like Ollama (HTTP ${responseStatus}).`,
    };
  }

  if (error?.name === 'AbortError') {
    return { bucket: 'not_running', reason: 'Ollama did not respond in time.' };
  }

  const message = String(error?.message || '').toLowerCase();
  if (message.includes('failed to fetch') || message.includes('load failed') || message.includes('networkerror')) {
    return {
      bucket: 'browser_network_blocked',
      reason: 'The browser could not reach that address directly. This can happen because of network or browser access limits.',
    };
  }

  return {
    bucket: 'wrong_address',
    reason: 'Stephanos could not reach an Ollama server at that address.',
  };
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    const text = await response.text();
    let json = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (error) {
        if (!response.ok) {
          throw Object.assign(error, { responseStatus: response.status });
        }
        throw Object.assign(error, { responseStatus: response.status, invalidJson: true });
      }
    }

    return { ok: response.ok, status: response.status, json, text };
  } finally {
    clearTimeout(timeout);
  }
}

async function probeCandidate(candidate, timeoutMs) {
  const versionUrl = buildEndpoint(candidate.baseURL, '/api/version');
  const tagsUrl = buildEndpoint(candidate.baseURL, '/api/tags');

  try {
    const version = await fetchJsonWithTimeout(versionUrl, timeoutMs);
    if (version.ok && version.json && typeof version.json === 'object') {
      let models = [];
      let tagsFailure = null;
      try {
        const tags = await fetchJsonWithTimeout(tagsUrl, timeoutMs);
        if (tags.ok && tags.json && typeof tags.json === 'object') {
          models = Array.isArray(tags.json.models)
            ? tags.json.models.map((item) => item?.name).filter(Boolean)
            : [];
        } else if (!tags.ok) {
          tagsFailure = classifyProbeError(null, tags.status);
        }
      } catch (error) {
        tagsFailure = classifyProbeError(error, error?.responseStatus);
      }

      return {
        success: true,
        candidate,
        baseURL: candidate.baseURL,
        host: candidate.host,
        version: version.json,
        models,
        noModels: models.length === 0,
        warning: tagsFailure?.reason || '',
        badge: isLoopbackHostname(candidate.host) ? 'Local Machine' : 'Network PC',
      };
    }

    const versionFailure = classifyProbeError(null, version.status);
    const tags = await fetchJsonWithTimeout(tagsUrl, timeoutMs);
    if (tags.ok && tags.json && typeof tags.json === 'object') {
      const models = Array.isArray(tags.json.models)
        ? tags.json.models.map((item) => item?.name).filter(Boolean)
        : [];
      return {
        success: true,
        candidate,
        baseURL: candidate.baseURL,
        host: candidate.host,
        version: null,
        models,
        noModels: models.length === 0,
        warning: versionFailure.reason,
        badge: isLoopbackHostname(candidate.host) ? 'Local Machine' : 'Network PC',
      };
    }

    const failure = classifyProbeError(null, tags.status || version.status);
    return { success: false, candidate, bucket: failure.bucket, reason: failure.reason };
  } catch (error) {
    const failure = classifyProbeError(error, error?.responseStatus);
    return { success: false, candidate, bucket: failure.bucket, reason: failure.reason };
  }
}

function pushCandidate(list, seen, baseURL, source) {
  const normalized = normalizeOllamaBaseUrl(baseURL);
  if (!normalized || seen.has(normalized)) return;
  const parsed = parseUrl(normalized);
  if (!parsed?.hostname) return;
  seen.add(normalized);
  list.push({
    baseURL: normalized,
    host: parsed.hostname,
    source,
    badge: isLoopbackHostname(parsed.hostname) ? 'Local Machine' : 'Network PC',
  });
}

export function deriveOllamaCandidates({ frontendOrigin = '', lastSuccessfulBaseURL = '', lastSuccessfulHost = '', pcAddressHint = '', recentHosts = [] } = {}) {
  const list = [];
  const seen = new Set();
  pushCandidate(list, seen, 'http://localhost:11434', 'localhost');
  pushCandidate(list, seen, lastSuccessfulBaseURL, 'last-successful-url');

  const page = parseUrl(frontendOrigin);
  const pageHost = page?.hostname || '';
  if (pageHost && isPrivateOrLocalHostname(pageHost) && !isLoopbackHostname(pageHost)) {
    pushCandidate(list, seen, `http://${pageHost}:11434`, 'current-page-host');
  }

  pushCandidate(list, seen, lastSuccessfulHost, 'last-successful-host');
  pushCandidate(list, seen, pcAddressHint, 'pc-address-hint');
  (Array.isArray(recentHosts) ? recentHosts : []).slice(0, 4).forEach((host) => pushCandidate(list, seen, host, 'recent-host'));
  return list;
}

function summarizeFailedBuckets(attempts = []) {
  const counts = attempts.reduce((acc, attempt) => {
    acc[attempt.bucket] = (acc[attempt.bucket] || 0) + 1;
    return acc;
  }, {});

  if (counts.browser_network_blocked) return 'browser_network_blocked';
  if (counts.reachable_but_invalid_response) return 'reachable_but_invalid_response';
  if (counts.wrong_address) return 'wrong_address';
  if (counts.not_running) return 'not_running';
  return 'not_running';
}

export async function detectOllamaHost(candidateUrls = [], options = {}) {
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const attempts = [];

  for (const candidate of candidateUrls) {
    const result = await probeCandidate(candidate, timeoutMs);
    if (result.success) {
      return {
        success: true,
        baseURL: result.baseURL,
        host: result.host,
        models: result.models,
        noModels: result.noModels,
        badge: result.badge,
        warning: result.warning,
        attempts,
        source: result.candidate.source,
      };
    }

    attempts.push({
      baseURL: result.candidate.baseURL,
      host: result.candidate.host,
      source: result.candidate.source,
      bucket: result.bucket,
      reason: result.reason,
      badge: result.candidate.badge,
    });
  }

  const failureBucket = summarizeFailedBuckets(attempts);
  const failureReasons = attempts.map((attempt) => attempt.reason).filter(Boolean);

  return {
    success: false,
    attempts,
    failureBucket,
    reason: failureReasons[0] || 'Stephanos could not find an Ollama server automatically.',
  };
}
