import test from 'node:test';
import assert from 'node:assert/strict';

import { createStephanosContinuityCore, createStephanosContinuityService } from './stephanosContinuity.mjs';

function createEventBus() {
  const listeners = new Map();
  return {
    on(name, handler) {
      const handlers = listeners.get(name) || [];
      handlers.push(handler);
      listeners.set(name, handlers);
    },
    emit(name, data) {
      const handlers = listeners.get(name) || [];
      handlers.forEach((handler) => handler(data));
      const wildcard = listeners.get('*') || [];
      wildcard.forEach((handler) => handler({ name, data, timestamp: Date.now() }));
    },
  };
}

test('stephanos continuity core updates workspace state and keeps recent event window', () => {
  const continuity = createStephanosContinuityCore({
    session: { continuityId: 'test-1' },
  });

  for (let index = 0; index < 20; index += 1) {
    continuity.pushEvent({ name: `tile.action.${index}`, summary: `action-${index}` });
  }

  const snapshot = continuity.getState();
  assert.equal(snapshot.session.continuityId, 'test-1');
  assert.equal(snapshot.recentEvents.length, 15);

  continuity.update({ workspace: { activeWorkspace: 'workspace', activeTileId: 'ideas' } });
  const next = continuity.getState();
  assert.equal(next.workspace.activeWorkspace, 'workspace');
  assert.equal(next.workspace.activeTileId, 'ideas');
});

test('stephanos continuity service reacts to tile and workspace events and persists selected events', () => {
  const eventBus = createEventBus();
  const persisted = [];
  const continuity = createStephanosContinuityService({
    eventBus,
    memoryGateway: {
      persistEventRecord(eventEnvelope) {
        persisted.push(eventEnvelope);
      },
    },
    persistEventNames: ['tile.opened', 'ai.decision.made'],
  });

  eventBus.emit('tile.opened', { id: 'wealthapp', name: 'Wealth App', summary: 'Opened wealth app' });
  eventBus.emit('workspace:closed', {});

  const snapshot = continuity.getState();
  assert.equal(snapshot.workspace.activeWorkspace, 'launcher');
  assert.equal(snapshot.workspace.activeTileId, '');
  assert.equal(snapshot.recentEvents.length >= 2, true);
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].name, 'tile.opened');
});
