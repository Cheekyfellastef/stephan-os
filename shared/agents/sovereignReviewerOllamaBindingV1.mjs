// Compatibility boundary for the existing trusted, loopback-only Ollama daemon.
// Ollama v0.40.0 (0d0720e51fb2fd9aa58781c3d720c06d720c2e7b) resolves a
// full manifest digest and enforces :local before its cloud-proxy branch:
// https://github.com/ollama/ollama/blob/0d0720e51fb2fd9aa58781c3d720c06d720c2e7b/server/model_resolver.go
// https://github.com/ollama/ollama/blob/0d0720e51fb2fd9aa58781c3d720c06d720c2e7b/server/routes.go
// A version declaration and echoed selector are not independent attestation.
// The digest identifies the root manifest, not independently verified weights.
const VERSION_URL = 'http://127.0.0.1:11434/api/version';
const SHA256 = /^[a-f0-9]{64}$/;
const LOCAL_SELECTOR = /^sha256:[a-f0-9]{64}:local$/;
const SUPPORTED_VERSION = /^0\.40\.(?:0|[1-9][0-9]{0,4})$/;
const VERSION_BODY_LIMIT = 4096;
const FAILURE_REASONS = new Set([
  'LOCAL_OLLAMA_MANIFEST_DIGEST_INVALID',
  'LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN',
  'LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED',
]);
const unavailable = () => new Error('LOCAL_OLLAMA_DIGEST_PROTOCOL_UNPROVEN');

export function sovereignLocalOllamaFailureReasonV1(error) {
  try {
    const reason = error?.message;
    return FAILURE_REASONS.has(reason) ? reason : '';
  }
  catch { return ''; }
}

async function readVersionBody(response, signal) {
  if (!response?.body || typeof response.body.getReader !== 'function') throw unavailable();
  const reader = response.body.getReader();
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      if (signal.aborted) throw unavailable();
      let onAbort;
      const aborted = new Promise((_, reject) => {
        onAbort = () => reject(unavailable());
        signal.addEventListener('abort', onAbort, { once: true });
      });
      let part;
      try {
        part = await Promise.race([reader.read(), aborted]);
      } finally {
        signal.removeEventListener('abort', onAbort);
      }
      if (signal.aborted) throw unavailable();
      if (part.done) break;
      if (!(part.value instanceof Uint8Array) || !part.value.byteLength) throw unavailable();
      bytes += part.value.byteLength;
      if (bytes > VERSION_BODY_LIMIT) throw unavailable();
      chunks.push(part.value);
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, bytes));
  } catch {
    // Do not await an untrusted body's cancellation while failing closed.
    Promise.resolve(reader.cancel()).catch(() => {});
    throw unavailable();
  } finally {
    reader.releaseLock();
  }
}

export async function admitSovereignLocalOllamaBindingV1(manifestDigestSha256, {
  fetchImpl = fetch, signal,
} = {}) {
  if (typeof manifestDigestSha256 !== 'string' || !SHA256.test(manifestDigestSha256)
    || typeof fetchImpl !== 'function') {
    throw new Error('LOCAL_OLLAMA_MANIFEST_DIGEST_INVALID');
  }
  let version;
  try {
    const bounded = signal
      ? AbortSignal.any([AbortSignal.timeout(6000), signal])
      : AbortSignal.timeout(6000);
    if (bounded.aborted) throw unavailable();
    const response = await fetchImpl(VERSION_URL, {
      method: 'GET', redirect: 'error', signal: bounded,
    });
    if (!response?.ok || response.redirected === true) throw unavailable();
    const parsed = JSON.parse(await readVersionBody(response, bounded));
    version = parsed?.version;
  } catch {
    throw unavailable();
  }
  // Admit the source-reviewed stable protocol family. Older/unknown releases
  // may interpret a digest-shaped string as a mutable tag; never send a prompt.
  if (typeof version !== 'string' || !SUPPORTED_VERSION.test(version)) {
    throw new Error('LOCAL_OLLAMA_DIGEST_PROTOCOL_UNSUPPORTED');
  }
  return Object.freeze({
    model: 'sha256:' + manifestDigestSha256 + ':local',
    manifestDigestSha256, protocolVersion: version,
  });
}

export function matchesSovereignLocalOllamaCompletionV1(response, binding) {
  return LOCAL_SELECTOR.test(binding?.model ?? '')
    && response?.model === binding.model
    // Official local GenerateResponse omits both fields. Never accept a cloud
    // proxy result, including a purportedly empty remote identity.
    && !Object.hasOwn(response, 'remote_host')
    && !Object.hasOwn(response, 'remote_model');
}
