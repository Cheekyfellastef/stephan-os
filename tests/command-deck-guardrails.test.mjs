import test from 'node:test';
import assert from 'node:assert/strict';

import {
  renderProjectRegistry,
  resolveStephanosLaunchTargetForTest,
} from '../modules/command-deck/command-deck.js';

function createElement({ tagName = 'div', ownerDocument = null } = {}) {
  const node = {
    tagName,
    ownerDocument,
    id: '',
    className: '',
    style: {},
    children: [],
    dataset: {},
    textContent: '',
    innerText: '',
    title: '',
    onclick: null,
    appendChild(child) {
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    querySelector(selector) {
      if (selector.startsWith('#')) {
        const targetId = selector.slice(1);
        return this.children.find((child) => child.id === targetId) || null;
      }
      return null;
    },
    setAttribute() {},
  };

  Object.defineProperty(node, 'innerHTML', {
    get() {
      return node.__innerHTML || '';
    },
    set(value) {
      node.__innerHTML = value;
      if (value === '') {
        node.children = [];
      }
    },
  });

  return node;
}

function createDocumentFixture() {
  const documentRef = {
    nodes: {},
    createElement(tagName) {
      return createElement({ tagName, ownerDocument: documentRef });
    },
    getElementById(id) {
      return this.nodes[id] || null;
    },
  };

  documentRef.nodes['project-registry'] = createElement({ ownerDocument: documentRef });
  documentRef.nodes['launcher-secondary-panels'] = createElement({ ownerDocument: documentRef });

  return documentRef;
}

test('command-deck Stephanos target resolution prefers launchEntry then runtimeEntry then entry', () => {
  assert.equal(
    resolveStephanosLaunchTargetForTest({ launchEntry: '/launch', runtimeEntry: '/runtime', entry: '/compat' }),
    '/launch',
  );
  assert.equal(
    resolveStephanosLaunchTargetForTest({ runtimeEntry: '/runtime', entry: '/compat' }),
    '/runtime',
  );
  assert.equal(
    resolveStephanosLaunchTargetForTest({ entry: '/compat' }),
    '/compat',
  );
});

test('renderProjectRegistry does not inject secondary surfaces into primary launcher body by default', () => {
  const originalDocument = globalThis.document;
  globalThis.document = createDocumentFixture();

  const projects = [{
    id: 'stephanos',
    folder: 'stephanos',
    name: 'Stephanos OS',
    entry: 'apps/stephanos/dist/index.html',
    launchEntry: 'http://localhost:5173/',
    runtimeEntry: 'http://localhost:5173/',
    launcherEntry: 'http://127.0.0.1:4173/',
  }];

  try {
    renderProjectRegistry(projects, { workspace: { open() {} } }, { enableSecondaryStatusSurfaces: false });

    assert.equal(globalThis.document.getElementById('project-registry').children.length, 1);
    assert.equal(globalThis.document.getElementById('launcher-secondary-panels').children.length, 0);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('launcher-critical command-deck module loads without duplicate declaration syntax errors', async () => {
  await assert.doesNotReject(async () => {
    await import('../modules/command-deck/command-deck.js');
  });
});
