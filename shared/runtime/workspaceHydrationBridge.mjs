import { requestStephanosBackend } from './backendClient.mjs';
import { throwIfWorkspaceReadAborted } from './workspaceReadCancellation.mjs';

export const WORKSPACE_HYDRATION_SCHEMA_V1 = 'stephanos.workspace-hydration.v1';
export const WORKSPACE_HYDRATION_REQUEST_MESSAGE_V1 = 'stephanos:workspace-hydration:request:v1';
export const WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1 = 'stephanos:workspace-hydration:response:v1';
export const WORKSPACE_HYDRATION_CANCEL_MESSAGE_V1 = 'stephanos:workspace-hydration:cancel:v1';
export const WORKSPACE_HYDRATION_AVAILABLE_MESSAGE_V1 = 'stephanos:workspace-hydration:available:v1';

const DEFAULT_TIMEOUT_MS = 10000;

function text(value = '') {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeWorkspaceId(value = '') {
  return text(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
}

function normalizeDatasets(input = []) {
  const raw = Array.isArray(input) ? input : text(input).split(',');
  return [...new Set(raw.map((value) => text(value).toLowerCase()).filter(Boolean))];
}

function hydrationPath(workspaceId, datasets = []) {
  const params = new URLSearchParams({ workspace: normalizeWorkspaceId(workspaceId) });
  const selected = normalizeDatasets(datasets);
  if (selected.length) params.set('datasets', selected.join(','));
  return `/api/shared-workspace/hydrate?${params.toString()}`;
}

function sameOriginFrame(windowRef) {
  if (!windowRef?.parent || windowRef.parent === windowRef) return false;
  try {
    return windowRef.parent.location?.origin === windowRef.location?.origin;
  } catch {
    return false;
  }
}

export async function hydrateWorkspaceFromBackend({
  workspaceId,
  datasets = [],
  runtimeContext = {},
  fetchImpl = globalThis?.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  diagnostics,
  signal,
} = {}) {
  throwIfWorkspaceReadAborted(signal);
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (!normalizedWorkspaceId) {
    const error = new Error('workspaceId is required for workspace hydration.');
    error.code = 'workspace-hydration-workspace-id-required';
    throw error;
  }

  const result = await requestStephanosBackend({
    path: hydrationPath(normalizedWorkspaceId, datasets),
    method: 'GET',
    runtimeContext,
    fetchImpl,
    timeoutMs,
    diagnostics,
    signal,
  });

  return result.json;
}

function postHydrationResponse({
  targetWindow,
  targetOrigin,
  requestId,
  workspaceId,
  ok,
  payload = null,
  error = '',
} = {}) {
  if (!targetWindow?.postMessage) return;
  targetWindow.postMessage({
    type: WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1,
    schemaVersion: WORKSPACE_HYDRATION_SCHEMA_V1,
    requestId,
    workspaceId,
    ok,
    payload,
    error,
  }, targetOrigin);
}

export function installWorkspaceHydrationParentBridge({
  windowRef = globalThis?.window,
  getActiveIframe = () => null,
  getActiveWorkspaceId = () => '',
  runtimeContext = {},
  fetchImpl = globalThis?.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (!windowRef?.addEventListener) {
    return Object.freeze({ installed: false, dispose() {} });
  }

  const pending = new Map();
  const handler = async (event) => {
    const message = event?.data;
    if (message?.type === WORKSPACE_HYDRATION_CANCEL_MESSAGE_V1) {
      const owned = pending.get(text(message.requestId));
      // An unmounted frame may cancel only its own previously admitted request.
      if (event.origin === text(windowRef.location?.origin) && owned?.source === event.source) owned.controller.abort();
      return;
    }
    if (!message || message.type !== WORKSPACE_HYDRATION_REQUEST_MESSAGE_V1) return;

    const iframe = getActiveIframe?.();
    if (!iframe?.contentWindow || event.source !== iframe.contentWindow) return;

    const shellOrigin = text(windowRef.location?.origin);
    if (!shellOrigin || event.origin !== shellOrigin) {
      postHydrationResponse({
        targetWindow: event.source,
        targetOrigin: event.origin || '*',
        requestId: text(message.requestId),
        workspaceId: normalizeWorkspaceId(message.workspaceId),
        ok: false,
        error: 'workspace-hydration-origin-rejected',
      });
      return;
    }

    const activeWorkspaceId = normalizeWorkspaceId(getActiveWorkspaceId?.());
    const requestedWorkspaceId = normalizeWorkspaceId(message.workspaceId);
    const effectiveWorkspaceId = activeWorkspaceId || requestedWorkspaceId;
    if (!effectiveWorkspaceId || (activeWorkspaceId && requestedWorkspaceId && activeWorkspaceId !== requestedWorkspaceId)) {
      postHydrationResponse({
        targetWindow: event.source,
        targetOrigin: shellOrigin,
        requestId: text(message.requestId),
        workspaceId: effectiveWorkspaceId,
        ok: false,
        error: 'workspace-hydration-workspace-mismatch',
      });
      return;
    }

    const requestId = text(message.requestId);
    if (!requestId || pending.has(requestId)) return;
    const owned = { source: event.source, controller: new AbortController() };
    pending.set(requestId, owned);
    try {
      const payload = await hydrateWorkspaceFromBackend({
        workspaceId: effectiveWorkspaceId,
        datasets: normalizeDatasets(message.datasets),
        runtimeContext,
        fetchImpl,
        timeoutMs,
        signal: owned.controller.signal,
      });
      throwIfWorkspaceReadAborted(owned.controller.signal);
      postHydrationResponse({
        targetWindow: event.source,
        targetOrigin: shellOrigin,
        requestId: text(message.requestId),
        workspaceId: effectiveWorkspaceId,
        ok: true,
        payload,
      });
    } catch (error) {
      if (owned.controller.signal.aborted) return;
      postHydrationResponse({
        targetWindow: event.source,
        targetOrigin: shellOrigin,
        requestId: text(message.requestId),
        workspaceId: effectiveWorkspaceId,
        ok: false,
        error: text(error?.code || error?.message, 'workspace-hydration-failed'),
      });
    } finally { if (pending.get(requestId) === owned) pending.delete(requestId); }
  };

  windowRef.addEventListener('message', handler);
  return Object.freeze({
    installed: true,
    dispose() {
      windowRef.removeEventListener?.('message', handler);
      for (const owned of pending.values()) owned.controller.abort();
      pending.clear();
    },
  });
}

export function announceWorkspaceHydrationBridgeToFrame({
  iframe,
  workspaceId,
  windowRef = globalThis?.window,
} = {}) {
  if (!iframe?.contentWindow || !windowRef?.location?.origin) return false;

  let frameOrigin = '';
  try {
    frameOrigin = new URL(iframe.src, windowRef.location.href).origin;
  } catch {
    return false;
  }

  if (frameOrigin !== windowRef.location.origin) return false;
  iframe.contentWindow.postMessage({
    type: WORKSPACE_HYDRATION_AVAILABLE_MESSAGE_V1,
    schemaVersion: WORKSPACE_HYDRATION_SCHEMA_V1,
    workspaceId: normalizeWorkspaceId(workspaceId),
    onDemand: true,
    backendTopologyHidden: true,
  }, frameOrigin);
  return true;
}

function requestViaParent({
  workspaceId,
  datasets = [],
  windowRef,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal,
} = {}) {
  return new Promise((resolve, reject) => {
    throwIfWorkspaceReadAborted(signal);
    const requestId = `hydration-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const origin = text(windowRef?.location?.origin);
    if (!origin || !sameOriginFrame(windowRef)) {
      const error = new Error('same-origin parent hydration bridge is unavailable.');
      error.code = 'workspace-hydration-parent-unavailable';
      reject(error);
      return;
    }

    let timer;
    function cleanup() {
      windowRef.clearTimeout(timer);
      windowRef.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    }
    function cancel(error) {
      cleanup();
      windowRef.parent.postMessage({ type: WORKSPACE_HYDRATION_CANCEL_MESSAGE_V1, requestId }, origin);
      reject(error);
    }
    function onAbort() { cancel(signal.reason ?? new DOMException('Workspace read cancelled', 'AbortError')); }
    timer = windowRef.setTimeout(() => {
      const error = new Error('workspace hydration parent bridge timed out.');
      error.code = 'workspace-hydration-parent-timeout';
      cancel(error);
    }, timeoutMs);

    function onMessage(event) {
      const message = event?.data;
      if (event.source !== windowRef.parent || event.origin !== origin) return;
      if (message?.type !== WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1 || message?.requestId !== requestId) return;
      cleanup();
      if (message.ok) {
        resolve(message.payload);
        return;
      }
      const error = new Error(message.error || 'workspace hydration parent bridge failed.');
      error.code = message.error || 'workspace-hydration-parent-failed';
      reject(error);
    }

    windowRef.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort, { once: true });
    windowRef.parent.postMessage({
      type: WORKSPACE_HYDRATION_REQUEST_MESSAGE_V1,
      schemaVersion: WORKSPACE_HYDRATION_SCHEMA_V1,
      requestId,
      workspaceId: normalizeWorkspaceId(workspaceId),
      datasets: normalizeDatasets(datasets),
    }, origin);
    if (signal?.aborted) onAbort();
  });
}

export async function requestWorkspaceHydration({
  workspaceId,
  datasets = [],
  runtimeContext = {},
  fetchImpl = globalThis?.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  windowRef = globalThis?.window,
  preferParentBridge = true,
  diagnostics,
  signal,
} = {}) {
  throwIfWorkspaceReadAborted(signal);
  const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
  if (!normalizedWorkspaceId) {
    const error = new Error('workspaceId is required for workspace hydration.');
    error.code = 'workspace-hydration-workspace-id-required';
    throw error;
  }

  if (preferParentBridge && sameOriginFrame(windowRef)) {
    try {
      return await requestViaParent({
        workspaceId: normalizedWorkspaceId,
        datasets,
        windowRef,
        timeoutMs,
        signal,
      });
    } catch (error) {
      throwIfWorkspaceReadAborted(signal);
      diagnostics?.({
        ok: false,
        transport: 'parent-bridge',
        workspaceId: normalizedWorkspaceId,
        error: error?.code || error?.message || 'unknown-error',
      });
    }
  }

  return hydrateWorkspaceFromBackend({
    workspaceId: normalizedWorkspaceId,
    datasets,
    runtimeContext,
    fetchImpl,
    timeoutMs,
    diagnostics,
    signal,
  });
}

if (typeof globalThis !== 'undefined') {
  globalThis.StephanosWorkspaceHydration = {
    requestWorkspaceHydration,
    hydrateWorkspaceFromBackend,
  };
}
