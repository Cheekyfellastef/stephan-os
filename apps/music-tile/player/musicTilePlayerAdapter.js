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

export function createMusicTilePlayerAdapter({
  containerId,
  width = 640,
  height = 360,
  onEvent = () => {},
} = {}) {
  let player = null;
  let lastVideoId = '';

  async function initPlayer() {
    await ensureGlobalApiLoader();
    if (player) return player;

    player = new window.YT.Player(containerId, {
      width,
      height,
      host: 'https://www.youtube-nocookie.com',
      playerVars: {
        autoplay: 0,
        controls: 1,
        enablejsapi: 1,
        origin: window.location.origin,
        rel: 0,
        modestbranding: 1,
      },
      events: {
        onReady: (event) => onEvent({ type: 'ready', event }),
        onStateChange: (event) => {
          const state = mapPlayerState(event.data);
          onEvent({ type: 'stateChange', state, event });
          if (state === 'ended') onEvent({ type: 'ended', event });
          if (state === 'playing') onEvent({ type: 'playing', event });
          if (state === 'paused') onEvent({ type: 'paused', event });
          if (state === 'buffering') onEvent({ type: 'buffering', event });
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

    return player;
  }

  async function loadVideo(videoId, { autoplay = false } = {}) {
    if (!videoId) return;
    const instance = await initPlayer();
    lastVideoId = videoId;
    instance.loadVideoById({ videoId, suggestedQuality: 'large' });
    if (!autoplay) {
      instance.pauseVideo();
    }
  }

  async function cueVideo(videoId) {
    if (!videoId) return;
    const instance = await initPlayer();
    lastVideoId = videoId;
    instance.cueVideoById({ videoId, suggestedQuality: 'large' });
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

  function destroy() {
    if (player?.destroy) {
      player.destroy();
    }
    player = null;
    lastVideoId = '';
  }

  return {
    initPlayer,
    loadVideo,
    cueVideo,
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
  };
}
