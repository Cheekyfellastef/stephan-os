import { createFlowQueue } from '../engine/musicDiscoveryEngine.js';

export function createMusicTileFlowController() {
  let queue = [];
  let currentIndex = -1;

  function rebuild(mediaItems, options = {}) {
    queue = createFlowQueue(mediaItems, options);
    if (!queue.length) {
      currentIndex = -1;
      return queue;
    }

    if (currentIndex >= queue.length) {
      currentIndex = queue.length - 1;
    }

    return queue;
  }

  function getQueue() {
    return queue;
  }

  function getCurrentIndex() {
    return currentIndex;
  }

  function getCurrent() {
    if (currentIndex < 0 || currentIndex >= queue.length) return null;
    return queue[currentIndex];
  }

  function selectById(mediaItemId) {
    const foundIndex = queue.findIndex((item) => item.id === mediaItemId);
    if (foundIndex < 0) return null;
    currentIndex = foundIndex;
    return queue[currentIndex];
  }

  function start() {
    if (!queue.length) return null;
    if (currentIndex < 0) currentIndex = 0;
    return queue[currentIndex];
  }

  function next() {
    if (!queue.length) return null;
    if (currentIndex < 0) {
      currentIndex = 0;
      return queue[currentIndex];
    }
    currentIndex += 1;
    if (currentIndex >= queue.length) {
      currentIndex = -1;
      return null;
    }
    return queue[currentIndex];
  }

  function previous() {
    if (!queue.length) return null;
    if (currentIndex <= 0) {
      currentIndex = 0;
      return queue[currentIndex] || null;
    }
    currentIndex -= 1;
    return queue[currentIndex] || null;
  }

  return {
    rebuild,
    getQueue,
    getCurrentIndex,
    getCurrent,
    selectById,
    start,
    next,
    previous,
  };
}
