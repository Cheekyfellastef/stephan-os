import { resolveCommandDeckDestinationPath } from './commandDeckDestination.mjs';

const CONTROL_ATTRIBUTE = 'data-command-deck-return-button';
const CONTROL_LABEL = 'Return to Command Deck';
const CONTROL_STYLE_ID = 'command-deck-return-controls-style';
const BUTTON_CLASS = 'command-deck-return-button';
const RETURN_DIAGNOSTIC_NAMESPACE = '__stephanosReturnDiagnostics';

function recordReturnDiagnostic(windowRef, key, value) {
  if (!windowRef || !key) {
    return;
  }
  const store = windowRef[RETURN_DIAGNOSTIC_NAMESPACE] || {};
  const counters = store.counters || {};
  const nextCount = Number(counters[key] || 0) + 1;
  counters[key] = nextCount;
  store.counters = counters;
  store[key] = value;
  windowRef[RETURN_DIAGNOSTIC_NAMESPACE] = store;
}

export function ensureCommandDeckReturnButtonStyles(documentRef = globalThis.document) {
  if (!documentRef?.head || documentRef.getElementById(CONTROL_STYLE_ID)) {
    return;
  }

  const styleNode = documentRef.createElement('style');
  styleNode.id = CONTROL_STYLE_ID;
  styleNode.textContent = `
    .${BUTTON_CLASS} {
      width: 100%;
      display: inline-flex;
      align-items: center;
      justify-content: center;
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
    .${BUTTON_CLASS}:focus-visible {
      outline: 2px solid rgba(150, 214, 255, 0.92);
      outline-offset: 2px;
    }
  `;
  documentRef.head.appendChild(styleNode);
}

export function getCommandDeckBasePath(windowRef = globalThis.window) {
  return resolveCommandDeckDestinationPath(windowRef);
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
      recordReturnDiagnostic(windowRef, 'commandDeckReturn.button_click', Date.now());
      recordReturnDiagnostic(windowRef, 'commandDeckReturn.query_before', windowRef.location?.search || '');
      const localHandler = typeof windowRef.returnToCommandDeck === 'function';
      recordReturnDiagnostic(windowRef, 'commandDeckReturn.local_handler_found', localHandler);
      if (localHandler) {
        windowRef.returnToCommandDeck();
        recordReturnDiagnostic(windowRef, 'commandDeckReturn.handler_invoked', 'window');
        return;
      }
      const parentHandler = Boolean(windowRef.parent && windowRef.parent !== windowRef && typeof windowRef.parent.returnToCommandDeck === 'function');
      recordReturnDiagnostic(windowRef, 'commandDeckReturn.parent_handler_found', parentHandler);
      if (parentHandler) {
        windowRef.parent.returnToCommandDeck();
        recordReturnDiagnostic(windowRef, 'commandDeckReturn.handler_invoked', 'parent');
        return;
      }
      recordReturnDiagnostic(windowRef, 'commandDeckReturn.fallback_navigation_used', true);
      windowRef.location.assign(resolveCommandDeckDestinationPath(windowRef));
    };
  button.addEventListener('click', clickHandler);
  return button;
}
