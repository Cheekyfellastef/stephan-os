import express from 'express';
import { tileStateService } from '../services/tileStateService.js';

const router = express.Router();

tileStateService.load();

router.get('/', (_req, res) => {
  const items = tileStateService.list();
  res.json({
    success: true,
    data: {
      storage: 'shared-json-store',
      items,
      total: items.length,
    },
  });
});

router.get('/:appId', (req, res) => {
  const appId = String(req.params.appId || '').trim();
  const item = tileStateService.get(appId);

  if (!item) {
    res.status(404).json({
      success: false,
      error: `Tile state '${appId}' was not found.`,
      data: {
        appId,
        storage: 'shared-json-store',
      },
    });
    return;
  }

  res.json({
    success: true,
    data: {
      ...item,
      storage: 'shared-json-store',
    },
  });
});

router.put('/:appId', (req, res, next) => {
  try {
    const appId = String(req.params.appId || '').trim();
    const item = tileStateService.set(appId, {
      schemaVersion: req.body?.schemaVersion,
      state: req.body?.state,
      source: req.body?.source,
    });

    res.json({
      success: true,
      data: {
        ...item,
        storage: 'shared-json-store',
      },
    });
  } catch (error) {
    next(error);
  }
});

router.delete('/:appId', (req, res) => {
  const appId = String(req.params.appId || '').trim();
  const removed = tileStateService.delete(appId);

  res.json({
    success: true,
    data: {
      appId,
      removed,
      storage: 'shared-json-store',
    },
  });
});

export default router;
