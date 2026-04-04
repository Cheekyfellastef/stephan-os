export const MAX_COMMAND_HISTORY = 120;

export function appendCommandHistory(previous = [], entry) {
  const safePrevious = Array.isArray(previous) ? previous : [];
  return [...safePrevious, entry].slice(-MAX_COMMAND_HISTORY);
}
