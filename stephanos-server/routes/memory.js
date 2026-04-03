import express from 'express';
import { memoryService } from '../services/memoryService.js';
import { durableMemoryService } from '../services/durableMemoryService.js';
import { normalizeError } from '../services/errors.js';

const router = express.Router();

function parseMemoryFilters(query = {}) {
  return {
    category: query.category || '',
    tags: query.tags || '',
  };
}

router.get('/', (req, res) => {
  const items = memoryService.listMemory(parseMemoryFilters(req.query));
  res.json({ success: true, data: { items, total: items.length } });
});


router.get('/durable', (_req, res) => {
  const state = durableMemoryService.getStore();
  res.json({
    success: true,
    data: {
      ...state,
      storage: 'shared-json-store',
    },
  });
});

router.put('/durable', (req, res, next) => {
  try {
    const state = durableMemoryService.setStore({
      schemaVersion: req.body?.schemaVersion,
      updatedAt: req.body?.updatedAt,
      records: req.body?.records,
    }, req.body?.source || 'runtime', {
      ifUnmodifiedSince: req.body?.ifUnmodifiedSince,
    });

    res.json({
      success: true,
      data: {
        ...state,
        storage: 'shared-json-store',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/search', (req, res) => {
  const q = String(req.query.q || '').trim();
  const items = q ? memoryService.searchMemory(q, parseMemoryFilters(req.query)) : memoryService.listMemory(parseMemoryFilters(req.query));
  res.json({ success: true, data: { items, query: q, total: items.length } });
});

router.post('/', (req, res, next) => {
  try {
    const item = memoryService.addMemoryItem(req.body || {});
    res.status(201).json({ success: true, data: { item } });
  } catch (error) {
    next(error);
  }
});

router.put('/:id', (req, res, next) => {
  try {
    const item = memoryService.updateMemoryItem(req.params.id, req.body || {});
    res.json({ success: true, data: { item } });
  } catch (error) {
    next(error);
  }
});

router.delete('/:id', (req, res, next) => {
  try {
    const item = memoryService.deleteMemoryItem(req.params.id);
    res.json({ success: true, data: { item } });
  } catch (error) {
    next(error);
  }
});

router.use((error, _req, res, _next) => {
  const appError = normalizeError(error);
  res.status(appError.status ?? 500).json({
    success: false,
    error: appError.message,
    error_code: appError.code,
    details: appError.details || null,
  });
});

export default router;
