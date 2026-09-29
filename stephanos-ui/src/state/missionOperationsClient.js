import { buildApiUrl, getApiRuntimeConfig } from '../ai/apiConfig';

async function requestMissionOperations(path, options = {}) {
  const runtimeConfig = options.runtimeConfig || getApiRuntimeConfig();
  const response = await fetch(buildApiUrl(path, runtimeConfig.baseUrl), {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(
      payload?.errors?.[0]
      || payload?.error
      || `Mission Operations request failed (${response.status}).`,
    );
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Mission Operations returned an invalid payload.');
  }
  return payload;
}

export function fetchMissionOperations({ missionId = '', signal, runtimeConfig } = {}) {
  const query = missionId ? `?missionId=${encodeURIComponent(missionId)}` : '';
  return requestMissionOperations(`/api/mission-operations${query}`, { signal, runtimeConfig });
}

export function approveMissionOperation(missionId, approvalToken, options = {}) {
  return requestMissionOperations(`/api/mission-operations/missions/${encodeURIComponent(missionId)}/approve`, {
    ...options,
    method: 'POST',
    body: { approvalToken, commandId: options.commandId },
  });
}

export function cancelMissionOperation(missionId, reason, options = {}) {
  return requestMissionOperations(`/api/mission-operations/missions/${encodeURIComponent(missionId)}/cancel`, {
    ...options,
    method: 'POST',
    body: { reason, commandId: options.commandId },
  });
}
