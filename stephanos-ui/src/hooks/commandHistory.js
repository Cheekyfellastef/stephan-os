export const MAX_COMMAND_HISTORY = 120;

export function appendCommandHistory(previous = [], entry) {
  const safePrevious = Array.isArray(previous) ? previous : [];
  return [...safePrevious, entry].slice(-MAX_COMMAND_HISTORY);
}


export function upsertCommandHistoryById(previous = [], entry, targetId = '') {
  const safePrevious = Array.isArray(previous) ? previous : [];
  const normalizedTargetId = String(targetId || entry?.id || '').trim();
  let replaced = false;
  const next = safePrevious.map((existing) => {
    if (!replaced && normalizedTargetId && String(existing?.id || '') === normalizedTargetId) {
      replaced = true;
      return entry;
    }
    return existing;
  });
  return replaced ? next : appendCommandHistory(safePrevious, entry);
}
