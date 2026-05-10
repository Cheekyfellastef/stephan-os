const TOKEN_ENDPOINT = 'https://accounts.spotify.com/api/token';
const API_BASE = 'https://api.spotify.com/v1';

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

export async function getSpotifyAccessToken(env = process.env) {
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
  try {
    const response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
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
    if (!error.code) {
      tokenCache = { ...tokenCache, status: 'failed', lastError: `Spotify network failure: ${String(error?.message || error)}` };
      error.code = 'spotify_network_failure';
      error.message = 'Spotify network failure';
    }
    throw error;
  }
}

export async function searchSpotifyCatalog({ query, type = 'track', limit = 10, env = process.env }) {
  const token = await getSpotifyAccessToken(env);
  const url = new URL(`${API_BASE}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('type', type || 'track');
  url.searchParams.set('limit', String(limit || 10));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const error = new Error(response.status === 401 || response.status === 403 ? 'Spotify catalog search denied or restricted' : 'Spotify catalog search failed');
    error.code = response.status === 401 || response.status === 403 ? 'spotify_denied' : 'spotify_search_failed';
    error.status = response.status;
    throw error;
  }
  return response.json();
}
