import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryService } from '../services/memoryService.js';
import { activityLogService } from '../services/activityLogService.js';

function withTempMemoryService(callback) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stephanos-memory-'));
  const storageFile = path.join(tempDir, 'memory.json');
  const service = new MemoryService(storageFile);
  const originalRecord = activityLogService.record;
  activityLogService.record = () => ({ id: 'evt_test' });

  try {
    return callback(service, storageFile);
  } finally {
    activityLogService.record = originalRecord;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

test('memory service seeds storage and lists readable items', () => {
  withTempMemoryService((service, storageFile) => {
    const items = service.listMemory();
    assert.ok(items.length >= 6);
    assert.equal(fs.existsSync(storageFile), true);
    assert.equal(items[0].title.length > 0, true);
  });
});

test('memory service supports add, update, search, and delete', () => {
  withTempMemoryService((service) => {
    const created = service.addMemoryItem({
      category: 'troubleshooting',
      title: 'Ollama timeout fix',
      content: 'Increase timeout to 61000ms when gpt-oss:20b stalls.',
      tags: ['ollama', 'timeout', '61000ms'],
      importance: 5,
      source: 'test',
    });

    assert.equal(created.category, 'troubleshooting');
    assert.equal(service.searchMemory('61000ms')[0].id, created.id);

    const updated = service.updateMemoryItem(created.id, {
      title: 'Ollama timeout fix updated',
      content: 'Use a 61000ms timeout for large local models.',
      tags: ['ollama', 'timeout'],
      importance: 4,
    });

    assert.equal(updated.title, 'Ollama timeout fix updated');
    assert.equal(service.getById(created.id).title, 'Ollama timeout fix updated');

    const deleted = service.deleteMemoryItem(created.id);
    assert.equal(deleted.id, created.id);
    assert.equal(service.searchMemory('61000ms').some((item) => item.id === created.id), false);
  });
});

test('memory context summary returns only top relevant entries', () => {
  withTempMemoryService((service) => {
    const summary = service.buildContextSummary('What port does the backend use and where is Ollama running?', { limit: 2 });
    assert.equal(summary.relevantItems.length, 2);
    assert.match(summary.summaryText, /backend/i);
    assert.match(summary.summaryText, /Ollama/i);
  });
});

test('memory service rejects secret-like values', () => {
  withTempMemoryService((service) => {
    assert.throws(() => {
      service.addMemoryItem({
        category: 'workflow',
        title: 'Do not store keys',
        content: 'apiKey=sk-test-secret-value-1234567890',
        tags: ['security'],
        importance: 5,
        source: 'test',
      });
    }, /rejects secret-like values/i);
  });
});
