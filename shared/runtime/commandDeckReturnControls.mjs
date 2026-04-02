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
  if (!topControl || !bottomControl) {
    return false;
  }
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
