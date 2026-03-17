import { createError, ERROR_CODES } from './errors.js';
import { activityLogStore } from './activityLogStore.js';
import { makeId, nowIso } from './storageUtils.js';

class ActivityLogService {
  list() {
    return activityLogStore.readEvents().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  }

  recent(limit = 10) {
    return this.list().slice(0, limit);
  }

  record({ type, subsystem, summary, payload = {} }) {
    const events = activityLogStore.readEvents();
    const event = {
      id: makeId('evt'),
      type,
      subsystem,
      summary,
      payload,
      timestamp: nowIso(),
    };
    events.push(event);
    activityLogStore.writeEvents(events);
    return event;
  }

  getById(id) {
    const event = this.list().find((entry) => entry.id === id);
    if (!event) throw createError(ERROR_CODES.ACTIVITY_NOT_FOUND, `Activity event '${id}' was not found.`, { status: 404 });
    return event;
  }

  getStats() {
    const events = this.list();
    const byType = events.reduce((acc, event) => ({ ...acc, [event.type]: (acc[event.type] ?? 0) + 1 }), {});
    return { total: events.length, by_type: byType };
  }

  getStatus() {
    return { state: 'live', ...activityLogStore.getStatus() };
  }
}

export const activityLogService = new ActivityLogService();
