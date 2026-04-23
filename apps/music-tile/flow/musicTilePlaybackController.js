export function createMusicTilePlaybackController({
  flowController,
  sessionStore,
  getMediaItemById,
} = {}) {
  function snapshotQueue(queue = []) {
    return Array.isArray(queue) ? queue.map((item) => item.id) : [];
  }

  function enterSingle(item, { queue = [] } = {}) {
    if (!item?.id) return null;
    return sessionStore.patch({
      mode: 'single',
      flowState: 'paused',
      queueIds: snapshotQueue(queue),
      currentMediaItemId: item.id,
      currentIndex: flowController.selectById(item.id) ? flowController.getCurrentIndex() : -1,
      externallyOpened: false,
      resumeAvailable: false,
      errorType: 'none',
    });
  }

  function startOrResumeFlow(queue = []) {
    const session = sessionStore.read();
    let item = null;

    if (session.mode === 'flow' && session.currentMediaItemId) {
      item = flowController.selectById(session.currentMediaItemId);
    }

    item = item || flowController.start();
    if (!item) return null;

    sessionStore.patch({
      mode: 'flow',
      flowState: 'active',
      queueIds: snapshotQueue(queue),
      currentMediaItemId: item.id,
      currentIndex: flowController.getCurrentIndex(),
      externallyOpened: false,
      resumeAvailable: false,
      errorType: 'none',
    });

    return item;
  }

  function startFlowAtItem(item, queue = []) {
    if (!item?.id) return null;
    const selected = flowController.selectById(item.id) || item;
    sessionStore.patch({
      mode: 'flow',
      flowState: 'active',
      queueIds: snapshotQueue(queue),
      currentMediaItemId: selected.id,
      currentIndex: flowController.getCurrentIndex(),
      externallyOpened: false,
      resumeAvailable: false,
      errorType: 'none',
    });
    return selected;
  }

  function onFlowEnded() {
    return sessionStore.patch({
      mode: 'flow',
      flowState: 'ended',
      currentMediaItemId: '',
      currentIndex: -1,
      externallyOpened: false,
      resumeAvailable: false,
    });
  }

  function onExternalOpen() {
    return sessionStore.patch({
      flowState: 'externally-opened',
      externallyOpened: true,
      resumeAvailable: true,
      lastExternalOpenAt: new Date().toISOString(),
    });
  }

  function onPaused() {
    const current = sessionStore.read();
    if (current.mode === 'flow' && current.flowState === 'active') {
      return sessionStore.patch({ flowState: 'paused' });
    }
    return current;
  }

  function onPlaying(mediaItemId = '') {
    const current = sessionStore.read();
    return sessionStore.patch({
      currentMediaItemId: mediaItemId || current.currentMediaItemId,
      currentIndex: flowController.getCurrentIndex(),
      flowState: current.mode === 'flow' ? 'active' : current.flowState,
      externallyOpened: false,
      resumeAvailable: false,
      errorType: 'none',
    });
  }

  function onPlaybackError(errorType = 'none') {
    return sessionStore.patch({
      errorType,
    });
  }

  function clearCurrentSelection() {
    return sessionStore.patch({
      mode: 'single',
      flowState: 'idle',
      currentMediaItemId: '',
      currentIndex: -1,
      resumeAvailable: false,
      errorType: 'none',
    });
  }

  function nextInFlow(queue = []) {
    const next = flowController.next();
    if (!next) {
      onFlowEnded();
      return null;
    }

    sessionStore.patch({
      mode: 'flow',
      flowState: 'active',
      queueIds: snapshotQueue(queue),
      currentMediaItemId: next.id,
      currentIndex: flowController.getCurrentIndex(),
      externallyOpened: false,
      resumeAvailable: false,
      errorType: 'none',
    });

    return next;
  }

  function previousInFlow(queue = []) {
    const previous = flowController.previous();
    if (!previous) return null;

    sessionStore.patch({
      mode: 'flow',
      flowState: 'active',
      queueIds: snapshotQueue(queue),
      currentMediaItemId: previous.id,
      currentIndex: flowController.getCurrentIndex(),
      externallyOpened: false,
      resumeAvailable: false,
      errorType: 'none',
    });

    return previous;
  }

  function getCurrentItem() {
    const session = sessionStore.read();
    return getMediaItemById?.(session.currentMediaItemId) || null;
  }

  return {
    enterSingle,
    startOrResumeFlow,
    startFlowAtItem,
    onFlowEnded,
    onExternalOpen,
    onPaused,
    onPlaying,
    onPlaybackError,
    clearCurrentSelection,
    nextInFlow,
    previousInFlow,
    getCurrentItem,
  };
}
