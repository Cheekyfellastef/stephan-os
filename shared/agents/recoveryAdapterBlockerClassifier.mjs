const RECOVERY_MESH_FALLBACK = 'RECOVERY_MESH_WAKE_ADAPTER_FAILED';
const RECOVERY_MESH_CONTEXTUAL_SAFE_BLOCKERS = Object.freeze([
  'RECOVERY_CANONICAL_MAILBOX_AUTHORITY_INVALID',
]);

const RECOVERY_MESH_SAFE_RUNTIME_CLASSES = Object.freeze(new Map([
  ['UNAUTHORIZEDACCESS', 'RECOVERY_MESH_WAKE_PERMISSION_DENIED'],
  ['PATHNOTFOUND', 'RECOVERY_MESH_WAKE_PATH_NOT_FOUND'],
  ['ITEMNOTFOUND', 'RECOVERY_MESH_WAKE_PATH_NOT_FOUND'],
  ['METHODINVOCATIONEXCEPTION', 'RECOVERY_MESH_WAKE_METHOD_INVOCATION_FAILED'],
  ['PROPERTYNOTFOUNDSTRICT', 'RECOVERY_MESH_WAKE_STRICT_PROPERTY_FAILED'],
  ['PARAMETERBINDINGVALIDATIONEXCEPTION', 'RECOVERY_MESH_WAKE_PARAMETER_VALIDATION_FAILED'],
  ['MOVEFILEINFOITEMIOERROR', 'RECOVERY_MESH_WAKE_MOVE_FAILED'],
  ['IOEXCEPTION', 'RECOVERY_MESH_WAKE_IO_FAILED'],
]));

function normalizedAllowlist(values = []) {
  return new Set([...values].map((value) => String(value || '').trim().toUpperCase()).filter(Boolean));
}

function recoveryMeshSafeRuntimeClass(line = '') {
  const match = /^\+?\s*FullyQualifiedErrorId\s*:\s*([A-Z][A-Z0-9_]*)(?:,[A-Za-z0-9_.-]+)?\s*$/i.exec(String(line || '').trim());
  if (!match) return '';
  return RECOVERY_MESH_SAFE_RUNTIME_CLASSES.get(String(match[1] || '').toUpperCase()) || '';
}

export function classifyAllowlistedRecoveryAdapterBlocker({
  stdout = '',
  stderr = '',
  allowlist = [],
  fallback = '',
} = {}) {
  const contextualAllowlist = fallback === RECOVERY_MESH_FALLBACK
    ? [...allowlist, ...RECOVERY_MESH_CONTEXTUAL_SAFE_BLOCKERS]
    : allowlist;
  const allowed = normalizedAllowlist(contextualAllowlist);
  const emitted = new Set();
  const runtimeClasses = new Set();
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
      const scriptPrefixed = /^[A-Za-z0-9._-]+\.ps1\s*:\s*([A-Z][A-Z0-9_]+)\s*$/i.exec(line);
      const code = String(qualified?.[1] || scriptPrefixed?.[1] || '').toUpperCase();
      if (code && allowed.has(code)) emitted.add(code);
      if (fallback === RECOVERY_MESH_FALLBACK) {
        const runtimeClass = recoveryMeshSafeRuntimeClass(line);
        if (runtimeClass) runtimeClasses.add(runtimeClass);
      }
    }
  }
  if (emitted.size === 1) return [...emitted][0];
  if (emitted.size > 1) return fallback;
  return runtimeClasses.size === 1 ? [...runtimeClasses][0] : fallback;
}
