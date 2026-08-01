const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 8000;

let tokenCache = { accessToken: '', expiresAt: 0, status: 'not requested', lastError: null };

function readCredentials(env = process.env) {
  const clientId = String(env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = String(env.SPOTIFY_CLIENT_SECRET || '').trim();
  const missing = [];
  if (!clientId) missing.push('client id');
  if (!clientSecret) missing.push('client secret');
  return { clientId, clientSecret, missing, configured: missing.length === 0 };
}

export function getSpotifyConfigDiagnostics(env = process.env) {
  const { configured, missing } = readCredentials(env);
  return { configured, missing, tokenStatus: tokenCache.status, lastError: tokenCache.lastError };
}

function createBoundedRequest({ timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS, signal } = {}) {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(signal?.reason);
  if (signal?.aborted) abortFromParent();
  else signal?.addEventListener?.('abort', abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', abortFromParent);
    },
  };
}

function classifySpotifyFetchError(error, fallbackCode) {
  if (error?.name === 'AbortError') {
    const timeoutError = new Error('Spotify catalogue request timed out');
    timeoutError.code = 'spotify_timeout';
    return timeoutError;
  }
  if (!error?.code) error.code = fallbackCode;
  return error;
}

export async function getSpotifyAccessToken(env = process.env, {
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  signal,
} = {}) {
  const creds = readCredentials(env);
  if (!creds.configured) {
    tokenCache = { ...tokenCache, status: 'failed', lastError: `Missing Spotify credentials: ${creds.missing.join(', ')}` };
    const error = new Error('Spotify catalog search not configured');
    error.code = 'spotify_missing_credentials';
    error.missing = creds.missing;
    throw error;
  }

  if (tokenCache.accessToken && Date.now() < tokenCache.expiresAt - 5000) {
    tokenCache.status = 'valid';
    return tokenCache.accessToken;
  }

  const auth = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64');
  const request = createBoundedRequest({ timeoutMs, signal });
  try {
    const response = await fetchImpl(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      signal: request.signal,
    });

    if (!response.ok) {
      const payload = await response.text();
      tokenCache = { ...tokenCache, status: 'failed', lastError: `Spotify auth failure (${response.status})` };
      const error = new Error(response.status === 401 || response.status === 403 ? 'Spotify catalog search denied or restricted' : 'Spotify auth failure');
      error.code = response.status === 401 || response.status === 403 ? 'spotify_denied' : 'spotify_auth_failure';
      error.status = response.status;
      error.details = payload;
      throw error;
    }

    const payload = await response.json();
    const expiresInMs = Number(payload.expires_in || 0) * 1000;
    tokenCache = {
      accessToken: payload.access_token || '',
      expiresAt: Date.now() + expiresInMs,
      status: 'valid',
      lastError: null,
    };
    return tokenCache.accessToken;
  } catch (error) {
    const classifiedError = classifySpotifyFetchError(error, 'spotify_network_failure');
    if (classifiedError.code === 'spotify_network_failure') {
      classifiedError.message = 'Spotify network failure';
    }
    tokenCache = { ...tokenCache, status: 'failed', lastError: String(classifiedError.message || classifiedError) };
    throw classifiedError;
  } finally {
    request.cleanup();
  }
}

export async function searchSpotifyCatalog({
  query,
  type = 'track',
  limit = 10,
  env = process.env,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  signal,
}) {
  const token = await getSpotifyAccessToken(env, { fetchImpl, timeoutMs, signal });
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('type', type || 'track');
  url.searchParams.set('limit', String(limit || 10));
  const request = createBoundedRequest({ timeoutMs, signal });
  try {
    const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}` }, signal: request.signal });
    if (!response.ok) {
      const error = new Error(response.status === 401 || response.status === 403 ? 'Spotify catalog search denied or restricted' : 'Spotify catalog search failed');
      error.code = response.status === 401 || response.status === 403 ? 'spotify_denied' : 'spotify_search_failed';
      error.status = response.status;
      throw error;
    }
    return response.json();
  } catch (error) {
    throw classifySpotifyFetchError(error, 'spotify_network_failure');
  } finally {
    request.cleanup();
  }
}
