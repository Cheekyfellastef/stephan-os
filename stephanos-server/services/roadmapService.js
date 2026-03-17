import { createError, ERROR_CODES } from './errors.js';
import { makeId, nowIso } from './storageUtils.js';
import { roadmapStore } from './roadmapStore.js';
import { activityLogService } from './activityLogService.js';

class RoadmapService {
  list() {
    return roadmapStore.readItems().sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  add(text) {
    const value = String(text ?? '').trim();
    if (!value) throw createError(ERROR_CODES.CMD_INVALID, 'Usage: /roadmap add <text>');
    const items = roadmapStore.readItems();
    const now = nowIso();
    const item = { id: makeId('roadmap'), text: value, status: 'open', created_at: now, updated_at: now, completed_at: null };
    items.push(item);
    roadmapStore.writeItems(items);
    activityLogService.record({ type: 'roadmap_item_added', subsystem: 'roadmap_service', summary: `Added roadmap item ${item.id}.`, payload: { item } });
    return item;
  }

  getById(id) {
    const item = this.list().find((entry) => entry.id === id);
    if (!item) throw createError(ERROR_CODES.ROADMAP_NOT_FOUND, `Roadmap item '${id}' was not found.`, { status: 404 });
    return item;
  }

  markDone(id) {
    const items = roadmapStore.readItems();
    const index = items.findIndex((entry) => entry.id === id);
    if (index < 0) throw createError(ERROR_CODES.ROADMAP_NOT_FOUND, `Roadmap item '${id}' was not found.`, { status: 404 });
    const now = nowIso();
    const updated = { ...items[index], status: 'done', updated_at: now, completed_at: now };
    items[index] = updated;
    roadmapStore.writeItems(items);
    activityLogService.record({ type: 'roadmap_item_done', subsystem: 'roadmap_service', summary: `Completed roadmap item ${id}.`, payload: { id } });
    return updated;
  }

  getSummary() {
    const items = this.list();
    return { total: items.length, open: items.filter((i) => i.status !== 'done').length, done: items.filter((i) => i.status === 'done').length };
  }

  getStatus() {
    return { state: 'live', ...roadmapStore.getStatus(), summary: this.getSummary() };
  }
}

export const roadmapService = new RoadmapService();
