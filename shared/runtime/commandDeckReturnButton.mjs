import { resolveCommandDeckDestinationPath } from './commandDeckDestination.mjs';

const CONTROL_ATTRIBUTE = 'data-command-deck-return-button';
const CONTROL_LABEL = 'Return to Command Deck';
const CONTROL_STYLE_ID = 'command-deck-return-controls-style';
const BUTTON_CLASS = 'command-deck-return-button';

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
      windowRef.location.assign(resolveCommandDeckDestinationPath(windowRef));
    };
  button.addEventListener('click', clickHandler);
  return button;
}
