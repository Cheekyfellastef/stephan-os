import test from 'node:test';
import assert from 'node:assert/strict';

import { installTopLevelCommandDeckReturnControls } from './commandDeckReturnControls.mjs';
import { createCommandDeckReturnButton } from './commandDeckReturnButton.mjs';

function createMockDocument() {
  const allNodes = [];
  const headChildren = [];
  const bodyChildren = [];

  function createElement(tagName) {
    const listeners = new Map();
    const node = {
      tagName: String(tagName || '').toUpperCase(),
      attributes: new Map(),
      children: [],
      className: '',
      style: {},
      textContent: '',
      id: '',
      setAttribute(name, value) {
        this.attributes.set(String(name), String(value));
      },
      getAttribute(name) {
        return this.attributes.get(String(name)) || null;
      },
      appendChild(child) {
        this.children.push(child);
      },
      addEventListener(name, handler) {
        listeners.set(String(name), handler);
      },
      dispatchEvent(event) {
        const handler = listeners.get(String(event?.type || ''));
        if (typeof handler === 'function') {
          handler(event);
        }
      },
    };
    allNodes.push(node);
    return node;
  }

  const head = {
    appendChild(node) {
      headChildren.push(node);
    },
  };

  const body = {
    prepend(node) {
      bodyChildren.unshift(node);
    },
    appendChild(node) {
      bodyChildren.push(node);
    },
  };

  const documentRef = {
    head,
    body,
    createElement,
    getElementById(id) {
      return [...headChildren, ...bodyChildren, ...allNodes].find((node) => node.id === id) || null;
    },
    querySelector(selector) {
      if (selector === '[data-command-deck-return-control="top"]') {
        return bodyChildren.find((node) => node.getAttribute?.('data-command-deck-return-control') === 'top') || null;
      }
      if (selector === '[data-command-deck-return-control="bottom"]') {
        return bodyChildren.find((node) => node.getAttribute?.('data-command-deck-return-control') === 'bottom') || null;
      }
      return null;
    },
  };

  return { documentRef, bodyChildren };
}

test('shared return button invokes local in-runtime handler when present and skips fallback navigation', () => {
  const { documentRef } = createMockDocument();
  const assignCalls = [];
  const windowRef = {
    document: documentRef,
    location: { assign(url) { assignCalls.push(url); }, search: '?surface=agents', href: 'http://127.0.0.1:5173/?surface=agents' },
    returnToCommandDeck() { windowRef.called = true; },
    called: false,
  };
  const button = createCommandDeckReturnButton({ documentRef, windowRef });
  button.dispatchEvent({ type: 'click' });
  assert.equal(windowRef.called, true);
  assert.equal(assignCalls.length, 0);
});

test('installTopLevelCommandDeckReturnControls skips embedded contexts by default', () => {
  const { documentRef, bodyChildren } = createMockDocument();
  const windowRef = {
    document: documentRef,
    self: {},
    top: {},
    location: { assign() {}, href: 'http://127.0.0.1:5173/' },
  };

  const installed = installTopLevelCommandDeckReturnControls({ windowRef, documentRef });
  assert.equal(installed, false);
  assert.equal(bodyChildren.length, 0);
});

test('installTopLevelCommandDeckReturnControls injects top and bottom controls when embedded mode is explicitly allowed', () => {
  const { documentRef, bodyChildren } = createMockDocument();
  const selfRef = {};
  const windowRef = {
    document: documentRef,
    self: selfRef,
    top: {},
    location: { assign() {}, href: 'http://127.0.0.1:5173/' },
  };

  const installed = installTopLevelCommandDeckReturnControls({ windowRef, documentRef, allowEmbedded: true });
  assert.equal(installed, true);
  assert.equal(bodyChildren.length, 2);
  assert.equal(bodyChildren[0].getAttribute('data-command-deck-return-control'), 'top');
  assert.equal(bodyChildren[1].getAttribute('data-command-deck-return-control'), 'bottom');
});

test('installTopLevelCommandDeckReturnControls restores any missing top-level control', () => {
  const { documentRef, bodyChildren } = createMockDocument();
  const selfRef = {};
  const windowRef = {
    document: documentRef,
    self: selfRef,
    top: selfRef,
    location: { assign() {}, href: 'http://127.0.0.1:4173/apps/stephanos/dist/' },
  };

  const initialInstall = installTopLevelCommandDeckReturnControls({ windowRef, documentRef, allowEmbedded: true });
  assert.equal(initialInstall, true);
  bodyChildren.splice(0, 1);

  const repairedInstall = installTopLevelCommandDeckReturnControls({ windowRef, documentRef, allowEmbedded: true });
  assert.equal(repairedInstall, true);
  assert.equal(bodyChildren.length, 2);
  assert.equal(bodyChildren[0].getAttribute('data-command-deck-return-control'), 'top');
  assert.equal(bodyChildren[1].getAttribute('data-command-deck-return-control'), 'bottom');
});
