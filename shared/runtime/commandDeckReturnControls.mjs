import { createCommandDeckReturnButton, ensureCommandDeckReturnButtonStyles } from './commandDeckReturnButton.mjs';

const CONTROL_ATTRIBUTE = 'data-command-deck-return-control';
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

function ensureControlStyles(documentRef = globalThis.document) {
  ensureCommandDeckReturnButtonStyles(documentRef);
  const styleNode = documentRef.createElement('style');
  styleNode.id = 'command-deck-return-controls-layout-style';
  if (documentRef.getElementById(styleNode.id)) {
    return;
  }
  styleNode.textContent = `
    .${CONTAINER_CLASS} {
      margin: 12px auto;
      width: min(1180px, calc(100% - 24px));
      display: flex;
      justify-content: flex-start;
      pointer-events: auto;
    }
  `;
  documentRef.head.appendChild(styleNode);
}

function createReturnControlContainer(documentRef, windowRef, position) {
  const container = documentRef.createElement('div');
  container.className = CONTAINER_CLASS;
  container.setAttribute(CONTROL_ATTRIBUTE, position);
  const button = createCommandDeckReturnButton({ documentRef, windowRef });
  if (!button) {
    return null;
  }
  container.appendChild(button);
  return container;
}

export function installTopLevelCommandDeckReturnControls({
  windowRef = globalThis.window,
  documentRef = windowRef?.document,
  allowEmbedded = false,
} = {}) {
  const canInject = allowEmbedded || shouldInjectTopLevelControls(windowRef);
  if (!canInject || !documentRef?.body) {
    return false;
  }

  const hasTopControl = Boolean(documentRef.querySelector(`[${CONTROL_ATTRIBUTE}="top"]`));
  const hasBottomControl = Boolean(documentRef.querySelector(`[${CONTROL_ATTRIBUTE}="bottom"]`));
  if (hasTopControl && hasBottomControl) {
    return false;
  }

  ensureControlStyles(documentRef);
  let installedAnyControl = false;

  if (!hasTopControl) {
    const topControl = createReturnControlContainer(documentRef, windowRef, 'top');
    if (!topControl) {
      return false;
    }
    documentRef.body.prepend(topControl);
    installedAnyControl = true;
  }

  if (!hasBottomControl) {
    const bottomControl = createReturnControlContainer(documentRef, windowRef, 'bottom');
    if (!bottomControl) {
      return false;
    }
    documentRef.body.appendChild(bottomControl);
    installedAnyControl = true;
  }

  return installedAnyControl;
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
