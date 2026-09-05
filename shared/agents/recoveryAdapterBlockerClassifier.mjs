function normalizedAllowlist(values = []) {
  return new Set([...values].map((value) => String(value || '').trim().toUpperCase()).filter(Boolean));
}

export function classifyAllowlistedRecoveryAdapterBlocker({
  stdout = '',
  stderr = '',
  allowlist = [],
  fallback = '',
} = {}) {
  const allowed = normalizedAllowlist(allowlist);
  const emitted = new Set();
  for (const stream of [stderr, stdout]) {
    for (const rawLine of String(stream || '').split(/\r\n|\n/)) {
      if (rawLine.includes('\r')) return fallback;
      const line = rawLine.trim();
      if (!line) continue;
      const wholeLine = line.toUpperCase();
      if (allowed.has(wholeLine)) {
        emitted.add(wholeLine);
        continue;
      }
      const qualified = /^\+?\s*FullyQualifiedErrorId\s*:\s*([A-Z][A-Z0-9_]+)\s*$/i.exec(line);
      const code = String(qualified?.[1] || '').toUpperCase();
      if (code && allowed.has(code)) emitted.add(code);
    }
  }
  return emitted.size === 1 ? [...emitted][0] : fallback;
}
