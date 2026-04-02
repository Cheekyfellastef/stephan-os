const CONTROL_ATTRIBUTE = 'data-command-deck-return-control';
const CONTROL_LABEL = 'Return to Command Deck';
const CONTROL_STYLE_ID = 'command-deck-return-controls-style';
const CONTAINER_CLASS = 'command-deck-return-controls';

function shouldInjectTopLevelControls(windowRef = globalThis.window) {
  if (!windowRef?.document?.body) {
    return false;
  }

  try {
    return windowRef.top === windowRef.self;
  } catch {
    return false;
  }
}

function resolveCommandDeckUrl(windowRef = globalThis.window) {
  const explicitUrl = String(
    windowRef?.document?.querySelector?.('meta[name="stephanos-launcher-shell-url"]')?.getAttribute('content') || ''
  ).trim();

  if (explicitUrl) {
    try {
      return new URL(explicitUrl, windowRef.location?.href || '').href;
    } catch {
      // fall through to canonical root launcher url.
    }
  }

  try {
    return new URL('/', windowRef.location?.href || '').href;
  } catch {
    return '/';
  }
}

function ensureControlStyles(documentRef = globalThis.document) {
  if (!documentRef?.head || documentRef.getElementById(CONTROL_STYLE_ID)) {
    return;
  }

  const styleNode = documentRef.createElement('style');
  styleNode.id = CONTROL_STYLE_ID;
  styleNode.textContent = `
    .${CONTAINER_CLASS} {
      margin: 12px auto;
      width: min(1180px, calc(100% - 24px));
      display: flex;
      justify-content: flex-start;
      pointer-events: auto;
    }
    .${CONTAINER_CLASS} button {
      min-height: 44px;
      padding: 10px 16px;
      border-radius: 10px;
      border: 1px solid rgba(96, 173, 255, 0.5);
      color: #e8f6ff;
      background: linear-gradient(180deg, #1a66c6, #114b95);
      cursor: pointer;
      font-weight: 650;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .${CONTAINER_CLASS} button:hover {
      background: linear-gradient(180deg, #2380f0, #165ab5);
      border-color: #96d6ff9e;
    }
  `;
  documentRef.head.appendChild(styleNode);
}

function createReturnButton(documentRef, windowRef, destinationUrl) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.textContent = CONTROL_LABEL;
  button.setAttribute(CONTROL_ATTRIBUTE, 'button');
  button.addEventListener('click', () => {
    windowRef.location.assign(destinationUrl);
  });
  return button;
}

function createReturnControlContainer(documentRef, windowRef, position) {
  const destinationUrl = resolveCommandDeckUrl(windowRef);
  const container = documentRef.createElement('div');
  container.className = CONTAINER_CLASS;
  container.setAttribute(CONTROL_ATTRIBUTE, position);
  container.appendChild(createReturnButton(documentRef, windowRef, destinationUrl));
  return container;
}

export function installTopLevelCommandDeckReturnControls({
  windowRef = globalThis.window,
  documentRef = windowRef?.document,
} = {}) {
  if (!shouldInjectTopLevelControls(windowRef) || !documentRef?.body) {
    return false;
  }

  if (documentRef.querySelector(`[${CONTROL_ATTRIBUTE}="top"]`) || documentRef.querySelector(`[${CONTROL_ATTRIBUTE}="bottom"]`)) {
    return false;
  }

  ensureControlStyles(documentRef);
  const topControl = createReturnControlContainer(documentRef, windowRef, 'top');
  const bottomControl = createReturnControlContainer(documentRef, windowRef, 'bottom');
  documentRef.body.prepend(topControl);
  documentRef.body.appendChild(bottomControl);
  return true;
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      installTopLevelCommandDeckReturnControls();
    }, { once: true });
  } else {
    installTopLevelCommandDeckReturnControls();
  }
}
