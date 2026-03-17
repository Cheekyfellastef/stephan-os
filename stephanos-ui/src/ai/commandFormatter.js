import { RESPONSE_TYPE } from './aiTypes';

export function getResultTone(responseType) {
  if (responseType === RESPONSE_TYPE.ERROR) return 'error';
  if (responseType === RESPONSE_TYPE.MEMORY) return 'memory';
  if (responseType === RESPONSE_TYPE.TOOL || responseType === RESPONSE_TYPE.SIMULATION) return 'tool';
  return 'assistant';
}

export function formatResultTitle(entry) {
  if (!entry.response) return 'Pending response';
  const { type, route, command } = entry.response;
  if (command) return `${command} • ${type}`;
  return `${route} • ${type}`;
}
