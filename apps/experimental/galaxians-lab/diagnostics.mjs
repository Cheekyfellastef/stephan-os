const MODES = new Set(['original', 'basic', 'deluxe']);
const STATUS_LABELS = Object.freeze({
  loading: 'Loading sprite sheet',
  ready: 'Sprite frames ready',
  error: 'Sprite sheet failed to load',
});

const validPositive = (value) => Number.isSafeInteger(value) && value > 0;

export function isGalaxiansLabDiagnosticsKey(event) {
  return event?.key === 'F1'
    && event.repeat !== true
    && event.altKey !== true
    && event.ctrlKey !== true
    && event.metaKey !== true;
}

// The lab reports only its observed state, not an inferred frame rate or a
// claim that the original Galaxians game uses these experimental palettes.
export function formatGalaxiansLabDiagnostics({
  mode,
  imageStatus,
  frameIndex,
  frameCount,
  loadedFrames,
  sourceWidth,
  sourceHeight,
  scale,
  frameMs,
} = {}) {
  const status = Object.hasOwn(STATUS_LABELS, imageStatus)
    ? STATUS_LABELS[imageStatus]
    : 'Sprite status unavailable';
  const palette = MODES.has(mode) ? mode : 'unknown';
  const validFrameCount = validPositive(frameCount);
  const ready = imageStatus === 'ready'
    && validFrameCount
    && loadedFrames === frameCount;
  const frame = ready && Number.isSafeInteger(frameIndex)
    && frameIndex >= 0 && frameIndex < frameCount
    ? `${frameIndex + 1} of ${frameCount}`
    : 'Unavailable';
  const crop = validPositive(sourceWidth) && validPositive(sourceHeight)
    ? `${sourceWidth} x ${sourceHeight} source pixels`
    : 'Unavailable';
  const display = validPositive(sourceWidth) && validPositive(sourceHeight) && validPositive(scale)
    ? `${sourceWidth * scale} x ${sourceHeight * scale} pixels (${scale}x nearest-neighbour)`
    : 'Unavailable';
  const animation = validPositive(frameMs) && validFrameCount
    ? `${frameMs} ms per frame (${frameCount} frames)`
    : 'Unavailable';

  return [
    `Sprite: ${status}`,
    `Palette: ${palette}`,
    `Frame: ${frame}`,
    `Crop: ${crop}`,
    `Rendered sprite: ${display}`,
    `Animation: ${animation}`,
    'Scope: experimental lab only; original game unchanged',
  ].join('\n');
}
