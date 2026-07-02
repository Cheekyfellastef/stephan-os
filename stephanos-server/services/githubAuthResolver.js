import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { providerSecretStore } from './providerSecretStore.js';

const execFileAsync = promisify(execFile);

function asText(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export const GITHUB_AUTH_AUTHORITIES = Object.freeze({
  SECRET_STORE: 'backend-local-secret-store',
  ENVIRONMENT: 'environment',
  GH_CLI: 'gh-cli',
  UNAVAILABLE: 'unavailable',
});

async function readGhCliToken(options = {}) {
  if (typeof options.ghTokenProvider === 'function') return asText(await options.ghTokenProvider(), '');
  try {
    const execImpl = options.execFile || execFileAsync;
    const result = await execImpl('gh', ['auth', 'token'], { timeout: 5000, windowsHide: true });
    return asText(result?.stdout ?? result, '');
  } catch {
    return '';
  }
}

export async function resolveGithubAuth(options = {}) {
  const env = options.env || process.env;
  const secretStoreToken = Object.prototype.hasOwnProperty.call(options, 'secretStoreToken')
    ? options.secretStoreToken
    : providerSecretStore.getSecret('github');
  const secretToken = asText(secretStoreToken, '');
  if (secretToken) return { token: secretToken, configured: true, authority: GITHUB_AUTH_AUTHORITIES.SECRET_STORE, source: GITHUB_AUTH_AUTHORITIES.SECRET_STORE };

  const envToken = asText(env.STEPHANOS_GITHUB_TOKEN || env.GITHUB_TOKEN, '');
  if (envToken) return { token: envToken, configured: true, authority: GITHUB_AUTH_AUTHORITIES.ENVIRONMENT, source: GITHUB_AUTH_AUTHORITIES.ENVIRONMENT };

  const ghToken = await readGhCliToken(options);
  if (ghToken) return { token: ghToken, configured: true, authority: GITHUB_AUTH_AUTHORITIES.GH_CLI, source: GITHUB_AUTH_AUTHORITIES.GH_CLI };

  return { token: '', configured: false, authority: GITHUB_AUTH_AUTHORITIES.UNAVAILABLE, source: GITHUB_AUTH_AUTHORITIES.UNAVAILABLE };
}

export async function resolveGithubGhCliAuth(options = {}) {
  const ghToken = await readGhCliToken(options);
  if (ghToken) return { token: ghToken, configured: true, authority: GITHUB_AUTH_AUTHORITIES.GH_CLI, source: GITHUB_AUTH_AUTHORITIES.GH_CLI };
  return { token: '', configured: false, authority: GITHUB_AUTH_AUTHORITIES.UNAVAILABLE, source: GITHUB_AUTH_AUTHORITIES.UNAVAILABLE };
}

export function maskGithubAuthStatus(auth = {}, secretStatus = null) {
  return {
    configured: auth.configured === true,
    masked: auth.authority === GITHUB_AUTH_AUTHORITIES.SECRET_STORE ? (secretStatus?.masked || '••••••••secret') : (auth.configured ? `••••••••${auth.authority}` : ''),
    updatedAt: auth.authority === GITHUB_AUTH_AUTHORITIES.SECRET_STORE ? (secretStatus?.updatedAt || null) : null,
    authority: auth.authority || GITHUB_AUTH_AUTHORITIES.UNAVAILABLE,
  };
}
