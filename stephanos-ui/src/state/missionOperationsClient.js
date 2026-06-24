import { buildApiUrl, getApiRuntimeConfig } from '../ai/apiConfig';

export async function fetchMissionOperations({
  missionId = '',
  signal,
  runtimeConfig = getApiRuntimeConfig(),
} = {}) {
  const query = missionId ? `?missionId=${encodeURIComponent(missionId)}` : '';
  const response = await fetch(buildApiUrl(`/api/mission-operations${query}`, runtimeConfig.baseUrl), {
    headers: {
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
    },
    signal,
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

  return payload && typeof payload === 'object'
    ? payload
    : {
      status: 'error',
      missions: [],
      errors: ['Mission Operations returned an invalid payload.'],
    };
}
