const CONTROL_ATTRIBUTE = 'data-command-deck-return-control';
const CONTROL_LABEL = 'Return to Command Deck';
const CONTROL_STYLE_ID = 'command-deck-return-controls-style';
const BUTTON_CLASS = 'command-deck-return-button';

function resolveCommandDeckBasePath(windowRef = globalThis.window) {
  const explicitUrl = String(
    windowRef?.document?.querySelector?.('meta[name="stephanos-launcher-shell-url"]')?.getAttribute('content') || ''
  ).trim();

  if (explicitUrl) {
    try {
      return new URL(explicitUrl, windowRef.location?.href || '').pathname || '/';
    } catch {
      // fall through to path-derived launcher base.
    }
  }

  try {
    const pathname = String(windowRef?.location?.pathname || '/').trim() || '/';
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      return '/';
    }

    const appsSegmentIndex = segments.indexOf('apps');
    if (appsSegmentIndex === 0) {
      return '/';
    }

    if (appsSegmentIndex > 0) {
      return `/${segments.slice(0, appsSegmentIndex).join('/')}/`;
    }

    return `/${segments[0]}/`;
  } catch {
    return '/';
  }
}

export function ensureCommandDeckReturnButtonStyles(documentRef = globalThis.document) {
  if (!documentRef?.head || documentRef.getElementById(CONTROL_STYLE_ID)) {
    return;
  }

  const styleNode = documentRef.createElement('style');
  styleNode.id = CONTROL_STYLE_ID;
  styleNode.textContent = `
    .${BUTTON_CLASS} {
      min-height: 44px;
      padding: 10px 16px;
      border-radius: 10px;
      border: 1px solid rgba(96, 173, 255, 0.5);
      color: #e8f6ff;
      background: linear-gradient(180deg, #1a66c6, #114b95);
      cursor: pointer;
      font-weight: 650;
      font-size: 14px;
      line-height: 1.2;
      touch-action: manipulation;
      -webkit-tap-highlight-color: transparent;
    }
    .${BUTTON_CLASS}:hover {
      background: linear-gradient(180deg, #2380f0, #165ab5);
      border-color: #96d6ff9e;
    }
  `;
  documentRef.head.appendChild(styleNode);
}

export function getCommandDeckBasePath(windowRef = globalThis.window) {
  return resolveCommandDeckBasePath(windowRef);
}

export function createCommandDeckReturnButton({
  documentRef = globalThis.document,
  windowRef = globalThis.window,
  label = CONTROL_LABEL,
  onClick,
} = {}) {
  if (!documentRef || !windowRef) {
    return null;
  }

  ensureCommandDeckReturnButtonStyles(documentRef);

  const button = documentRef.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.className = BUTTON_CLASS;
  button.setAttribute(CONTROL_ATTRIBUTE, 'button');

  const clickHandler = typeof onClick === 'function'
    ? onClick
    : () => {
      windowRef.location.assign(resolveCommandDeckBasePath(windowRef));
    };
  button.addEventListener('click', clickHandler);
  return button;
}
