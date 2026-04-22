const IFRAME_API_SRC = 'https://www.youtube.com/iframe_api';

function ensureGlobalApiLoader() {
  if (window.__stephanosYouTubeIframeApiPromise) {
    return window.__stephanosYouTubeIframeApiPromise;
  }

  window.__stephanosYouTubeIframeApiPromise = new Promise((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }

    const previousReady = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (typeof previousReady === 'function') {
        previousReady();
      }
      resolve(window.YT);
    };

    const existingScript = document.querySelector(`script[src="${IFRAME_API_SRC}"]`);
    if (existingScript) {
      existingScript.addEventListener('error', () => reject(new Error('youtube-iframe-api-load-failed')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = IFRAME_API_SRC;
    script.async = true;
    script.onerror = () => reject(new Error('youtube-iframe-api-load-failed'));
    document.head.appendChild(script);
  });

  return window.__stephanosYouTubeIframeApiPromise;
}

function mapPlayerState(code) {
  const YT = window.YT;
  if (!YT?.PlayerState) return 'unknown';
  if (code === YT.PlayerState.ENDED) return 'ended';
  if (code === YT.PlayerState.PLAYING) return 'playing';
  if (code === YT.PlayerState.PAUSED) return 'paused';
  if (code === YT.PlayerState.BUFFERING) return 'buffering';
  if (code === YT.PlayerState.CUED) return 'cued';
  return 'unstarted';
}

function mapPlayerErrorCode(code) {
  const lookup = {
    2: 'Invalid video ID.',
    5: 'Player error during HTML5 playback.',
    100: 'Video unavailable or removed.',
    101: 'Playback in embedded players is not allowed for this video.',
    150: 'Playback in embedded players is not allowed for this video.',
  };
  return lookup[code] || `Unknown player error (${code}).`;
}

function buildFullscreenApi(target) {
  const documentRef = document;

  function request() {
    if (!target) return Promise.resolve(false);
    const requestMethod = target.requestFullscreen
      || target.webkitRequestFullscreen
      || target.msRequestFullscreen;
    if (!requestMethod) return Promise.resolve(false);
    return Promise.resolve(requestMethod.call(target)).then(() => true).catch(() => false);
  }

  function exit() {
    const exitMethod = documentRef.exitFullscreen
      || documentRef.webkitExitFullscreen
      || documentRef.msExitFullscreen;
    if (!exitMethod) return Promise.resolve(false);
    return Promise.resolve(exitMethod.call(documentRef)).then(() => true).catch(() => false);
  }

  function isActive() {
    return Boolean(documentRef.fullscreenElement || documentRef.webkitFullscreenElement || documentRef.msFullscreenElement);
  }

  function isEnabled() {
    return Boolean(
      target?.requestFullscreen
      || target?.webkitRequestFullscreen
      || target?.msRequestFullscreen,
    );
  }

  return {
    request,
    exit,
    isActive,
    isEnabled,
  };
}

export function createMusicTilePlayerAdapter({
  containerId,
  mountElement,
  width = 640,
  height = 360,
  onEvent = () => {},
} = {}) {
  let player = null;
  let lastVideoId = '';
  let fullscreenApi = null;

  async function initPlayer() {
    await ensureGlobalApiLoader();
    if (player) return player;

    const fullscreenTarget = mountElement || document.getElementById(containerId)?.parentElement || null;
    fullscreenApi = buildFullscreenApi(fullscreenTarget);

    player = new window.YT.Player(containerId, {
      width,
      height,
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 0,
        controls: 1,
        enablejsapi: 1,
        fs: 1,
        origin: window.location.origin,
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
      },
      events: {
        onReady: (event) => onEvent({ type: 'ready', event }),
        onStateChange: (event) => {
          const state = mapPlayerState(event.data);
          onEvent({ type: 'stateChange', state, event });
          onEvent({ type: state, event });
        },
        onError: (event) => {
          onEvent({
            type: 'error',
            code: event.data,
            message: mapPlayerErrorCode(event.data),
            event,
          });
        },
      },
    });

    document.addEventListener('fullscreenchange', () => {
      onEvent({ type: 'fullscreenChange', isFullscreen: fullscreenApi?.isActive?.() || false });
    });

    return player;
  }

  async function cueVideo(videoId, opts = {}) {
    if (!videoId) return;
    const instance = await initPlayer();
    lastVideoId = videoId;
    instance.cueVideoById({
      videoId,
      startSeconds: opts.startSeconds || 0,
      suggestedQuality: opts.suggestedQuality || 'large',
    });
  }

  async function loadVideo(videoId, opts = {}) {
    if (!videoId) return;
    const instance = await initPlayer();
    lastVideoId = videoId;
    instance.loadVideoById({
      videoId,
      startSeconds: opts.startSeconds || 0,
      suggestedQuality: opts.suggestedQuality || 'large',
    });
  }

  function play() {
    player?.playVideo();
  }

  function pause() {
    player?.pauseVideo();
  }

  function stop() {
    player?.stopVideo();
  }

  function setVolume(value) {
    player?.setVolume(Math.max(0, Math.min(100, Number(value) || 0)));
  }

  function mute() {
    player?.mute();
  }

  function unMute() {
    player?.unMute();
  }

  function isMuted() {
    return Boolean(player?.isMuted?.());
  }

  function getCurrentTime() {
    return Number(player?.getCurrentTime?.() || 0);
  }

  function getDuration() {
    return Number(player?.getDuration?.() || 0);
  }

  function getLastVideoId() {
    return lastVideoId;
  }

  function isFullscreenSupported() {
    return Boolean(fullscreenApi?.isEnabled?.());
  }

  function isFullscreenActive() {
    return Boolean(fullscreenApi?.isActive?.());
  }

  async function enterFullscreen() {
    return fullscreenApi?.request?.() || false;
  }

  async function exitFullscreen() {
    return fullscreenApi?.exit?.() || false;
  }

  function destroy() {
    if (player?.destroy) {
      player.destroy();
    }
    player = null;
    lastVideoId = '';
  }

  return {
    initPlayer,
    cueVideo,
    loadVideo,
    play,
    pause,
    stop,
    destroy,
    setVolume,
    mute,
    unMute,
    isMuted,
    getCurrentTime,
    getDuration,
    getLastVideoId,
    enterFullscreen,
    exitFullscreen,
    isFullscreenSupported,
    isFullscreenActive,
  };
}
