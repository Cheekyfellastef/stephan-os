import { requestStephanosBackend } from './backendClient.mjs';

export const WORKSPACE_HYDRATION_SCHEMA_V1 = 'stephanos.workspace-hydration.v1';
export const WORKSPACE_HYDRATION_REQUEST_MESSAGE_V1 = 'stephanos:workspace-hydration:request:v1';
export const WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1 = 'stephanos:workspace-hydration:response:v1';
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
} = {}) {
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

  const handler = async (event) => {
    const message = event?.data;
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

    try {
      const payload = await hydrateWorkspaceFromBackend({
        workspaceId: effectiveWorkspaceId,
        datasets: normalizeDatasets(message.datasets),
        runtimeContext,
        fetchImpl,
        timeoutMs,
      });
      postHydrationResponse({
        targetWindow: event.source,
        targetOrigin: shellOrigin,
        requestId: text(message.requestId),
        workspaceId: effectiveWorkspaceId,
        ok: true,
        payload,
      });
    } catch (error) {
      postHydrationResponse({
        targetWindow: event.source,
        targetOrigin: shellOrigin,
        requestId: text(message.requestId),
        workspaceId: effectiveWorkspaceId,
        ok: false,
        error: text(error?.code || error?.message, 'workspace-hydration-failed'),
      });
    }
  };

  windowRef.addEventListener('message', handler);
  return Object.freeze({
    installed: true,
    dispose() {
      windowRef.removeEventListener?.('message', handler);
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
} = {}) {
  return new Promise((resolve, reject) => {
    const requestId = `hydration-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const origin = text(windowRef?.location?.origin);
    if (!origin || !sameOriginFrame(windowRef)) {
      const error = new Error('same-origin parent hydration bridge is unavailable.');
      error.code = 'workspace-hydration-parent-unavailable';
      reject(error);
      return;
    }

    const timer = windowRef.setTimeout(() => {
      windowRef.removeEventListener('message', onMessage);
      const error = new Error('workspace hydration parent bridge timed out.');
      error.code = 'workspace-hydration-parent-timeout';
      reject(error);
    }, timeoutMs);

    function onMessage(event) {
      const message = event?.data;
      if (event.source !== windowRef.parent || event.origin !== origin) return;
      if (message?.type !== WORKSPACE_HYDRATION_RESPONSE_MESSAGE_V1 || message?.requestId !== requestId) return;
      windowRef.clearTimeout(timer);
      windowRef.removeEventListener('message', onMessage);
      if (message.ok) {
        resolve(message.payload);
        return;
      }
      const error = new Error(message.error || 'workspace hydration parent bridge failed.');
      error.code = message.error || 'workspace-hydration-parent-failed';
      reject(error);
    }

    windowRef.addEventListener('message', onMessage);
    windowRef.parent.postMessage({
      type: WORKSPACE_HYDRATION_REQUEST_MESSAGE_V1,
      schemaVersion: WORKSPACE_HYDRATION_SCHEMA_V1,
      requestId,
      workspaceId: normalizeWorkspaceId(workspaceId),
      datasets: normalizeDatasets(datasets),
    }, origin);
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
} = {}) {
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
      });
    } catch (error) {
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
  });
}

if (typeof globalThis !== 'undefined') {
  globalThis.StephanosWorkspaceHydration = {
    requestWorkspaceHydration,
    hydrateWorkspaceFromBackend,
  };
}
