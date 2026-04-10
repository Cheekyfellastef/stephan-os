const FRAME_WIDTH = 12;
const FRAME_HEIGHT = 13;
const SCALE = 4;
const FRAME_MS = 400;
const SPRITE_PATH = '../../galaxians/assets/sprites/galaxian.png';

const FRAME_COORDS = [
  { sx: 20, sy: 199, sw: 12, sh: 13 }, // F1: (20,199 -> 32,212)
  { sx: 36, sy: 199, sw: 12, sh: 13 }, // F2: (36,199 -> 48,212)
];

const ROW_COLOR_TARGETS = ['red', 'purple', 'blue'];

const BASIC_ROW_PALETTES = {
  red: ['#ff6565', '#d93838', '#8f1111'],
  purple: ['#ca7bff', '#9647df', '#5d1ca3'],
  blue: ['#74c9ff', '#2d8fde', '#0e4f99'],
};

const DELUXE_ROW_PALETTES = {
  red: ['#ff9d9d', '#ff5555', '#a11313'],
  purple: ['#e2b3ff', '#b56cff', '#6d2eaa'],
  blue: ['#b4e2ff', '#63b8ff', '#1d5cab'],
};

const canvas = document.getElementById('lab-canvas');
const ctx = canvas.getContext('2d', { alpha: false });
ctx.imageSmoothingEnabled = false;

const modeLabel = document.getElementById('mode-label');
const modeButtons = Array.from(document.querySelectorAll('.mode-btn'));

let currentMode = 'original';
let currentFrameIndex = 0;
let sourceFrames = [];
let remappedFrames = {
  basic: { red: [], purple: [], blue: [] },
  deluxe: { red: [], purple: [], blue: [] },
};

function hexToRgb(hex) {
  const normalized = hex.replace('#', '');
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function createMappedFrame(imageData, rowColor, mode) {
  const mapped = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const palette = (mode === 'basic' ? BASIC_ROW_PALETTES : DELUXE_ROW_PALETTES)[rowColor].map(hexToRgb);

  for (let i = 0; i < mapped.data.length; i += 4) {
    const r = mapped.data[i];
    const g = mapped.data[i + 1];
    const b = mapped.data[i + 2];
    const a = mapped.data[i + 3];

    if (a === 0) {
      continue;
    }

    // Green-dominant classifier: only remap pixels where green is clearly the strongest channel.
    if (!(g > r * 1.12 && g > b * 1.12 && g > 26)) {
      continue;
    }

    // Brightness ranking preserves relative luminance (light/mid/dark) across target palette tones.
    const brightness = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const level = brightness > 150 ? 0 : brightness > 95 ? 1 : 2;

    const target = palette[level];

    if (mode === 'deluxe') {
      // Deluxe mode preserves intra-tone brightness by scaling around the selected tone.
      const reference = level === 0 ? 200 : level === 1 ? 140 : 85;
      const scale = Math.max(0.65, Math.min(1.35, brightness / reference));
      mapped.data[i] = Math.min(255, Math.round(target.r * scale));
      mapped.data[i + 1] = Math.min(255, Math.round(target.g * scale));
      mapped.data[i + 2] = Math.min(255, Math.round(target.b * scale));
    } else {
      mapped.data[i] = target.r;
      mapped.data[i + 1] = target.g;
      mapped.data[i + 2] = target.b;
    }
  }

  return mapped;
}

function drawFrameToOffscreen(source, frameDef) {
  const offscreen = document.createElement('canvas');
  offscreen.width = FRAME_WIDTH;
  offscreen.height = FRAME_HEIGHT;
  const offCtx = offscreen.getContext('2d');
  offCtx.imageSmoothingEnabled = false;

  // Centre-based crop: requested frame size remains exact with no trim/stretch.
  offCtx.drawImage(
    source,
    frameDef.sx,
    frameDef.sy,
    frameDef.sw,
    frameDef.sh,
    0,
    0,
    FRAME_WIDTH,
    FRAME_HEIGHT,
  );

  return offscreen;
}

function buildFrameCache(spriteImage) {
  sourceFrames = FRAME_COORDS.map((frame) => drawFrameToOffscreen(spriteImage, frame));

  const offscreen = document.createElement('canvas');
  offscreen.width = FRAME_WIDTH;
  offscreen.height = FRAME_HEIGHT;
  const offCtx = offscreen.getContext('2d');

  for (const colorName of ROW_COLOR_TARGETS) {
    remappedFrames.basic[colorName] = [];
    remappedFrames.deluxe[colorName] = [];

    for (const frameCanvas of sourceFrames) {
      offCtx.clearRect(0, 0, FRAME_WIDTH, FRAME_HEIGHT);
      offCtx.drawImage(frameCanvas, 0, 0);
      const pixels = offCtx.getImageData(0, 0, FRAME_WIDTH, FRAME_HEIGHT);

      const basic = createMappedFrame(pixels, colorName, 'basic');
      const deluxe = createMappedFrame(pixels, colorName, 'deluxe');

      const basicCanvas = document.createElement('canvas');
      basicCanvas.width = FRAME_WIDTH;
      basicCanvas.height = FRAME_HEIGHT;
      basicCanvas.getContext('2d').putImageData(basic, 0, 0);

      const deluxeCanvas = document.createElement('canvas');
      deluxeCanvas.width = FRAME_WIDTH;
      deluxeCanvas.height = FRAME_HEIGHT;
      deluxeCanvas.getContext('2d').putImageData(deluxe, 0, 0);

      remappedFrames.basic[colorName].push(basicCanvas);
      remappedFrames.deluxe[colorName].push(deluxeCanvas);
    }
  }
}

function getFrameFor(rowIndex, frameIndex) {
  if (currentMode === 'original') {
    return sourceFrames[frameIndex];
  }

  const rowColor = ROW_COLOR_TARGETS[rowIndex];
  return remappedFrames[currentMode][rowColor][frameIndex];
}

function render() {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const columns = 10;
  const rows = 3;
  const spriteW = FRAME_WIDTH * SCALE;
  const spriteH = FRAME_HEIGHT * SCALE;
  const gapX = Math.round(spriteW * 0.45);
  const gapY = Math.round(spriteH * 0.55);

  const totalW = columns * spriteW + (columns - 1) * gapX;
  const totalH = rows * spriteH + (rows - 1) * gapY;
  const startX = Math.round((canvas.width - totalW) / 2);
  const startY = Math.round((canvas.height - totalH) / 2);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const x = startX + col * (spriteW + gapX);
      const y = startY + row * (spriteH + gapY);
      const sprite = getFrameFor(row, currentFrameIndex);
      ctx.drawImage(sprite, x, y, spriteW, spriteH);
    }
  }
}

function setMode(mode) {
  currentMode = mode;
  modeLabel.textContent = mode;

  for (const button of modeButtons) {
    button.classList.toggle('is-active', button.dataset.mode === mode);
  }

  render();
}

function attachControls() {
  for (const button of modeButtons) {
    button.addEventListener('click', () => {
      const mode = button.dataset.mode;
      if (mode && mode !== currentMode) {
        setMode(mode);
      }
    });
  }
}

function startAnimationLoop() {
  window.setInterval(() => {
    currentFrameIndex = (currentFrameIndex + 1) % FRAME_COORDS.length;
    render();
  }, FRAME_MS);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load sprite sheet: ${src}`));
    image.src = src;
  });
}

async function init() {
  attachControls();

  try {
    const spriteSheet = await loadImage(SPRITE_PATH);
    buildFrameCache(spriteSheet);
    render();
    startAnimationLoop();
  } catch (error) {
    console.error(error);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ff6666';
    ctx.font = '16px sans-serif';
    ctx.fillText('Sprite sheet failed to load.', 24, 40);
  }
}

init();
