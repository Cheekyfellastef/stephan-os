import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  createStephanosCanonRotatingChevronButton,
  readSurfacePanelState,
  STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS,
  writeSurfacePanelState,
} from './stephanosSurfacePanels.mjs';

function createMemoryStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test('surface panel state writes and reads through stephanos session memory layout', () => {
  const storage = createMemoryStorage();
  writeSurfacePanelState('vr-research-lab', 'overview', true, storage);
  writeSurfacePanelState('vr-research-lab', 'techniques', false, storage);
  writeSurfacePanelState('music-lab', 'queue', true, storage);

  assert.deepEqual(readSurfacePanelState('vr-research-lab', storage), {
    overview: true,
    techniques: false,
  });
  assert.deepEqual(readSurfacePanelState('music-lab', storage), { queue: true });
});

test('surface panel shell canon control excludes old two-symbol dial implementation', () => {
  const source = fs.readFileSync(new URL('./stephanosSurfacePanels.mjs', import.meta.url), 'utf8');
  assert.match(source, /stephanos-canon-rotating-chevron-button/);
  assert.doesNotMatch(source, /◉/);
  assert.doesNotMatch(source, /class="dial"/);
  assert.doesNotMatch(source, /stephanos-surface-panel-knob/);
});

test('canon rotating chevron button uses chevron-only structure and PaneCollapseDial rotation model', () => {
  const documentRef = {
    createElement(tagName) {
      return {
        tagName,
        type: '',
        className: '',
        innerHTML: '',
      };
    },
  };

  const button = createStephanosCanonRotatingChevronButton({ documentRef });
  assert.equal(button.tagName, 'button');
  assert.equal(button.type, 'button');
  assert.equal(button.className, STEPHANOS_CANON_ROTATING_CHEVRON_BUTTON_CLASS);
  assert.match(button.innerHTML, /^<span class="chevron" aria-hidden="true">⌄<\/span>$/);
  assert.doesNotMatch(button.innerHTML, /◉|dial/);

  const source = fs.readFileSync(new URL('./stephanosSurfacePanels.mjs', import.meta.url), 'utf8');
  assert.match(source, /\.chevron\s*\{[\s\S]*?transform:\s*rotate\(0deg\)/);
  assert.match(source, /stephanos-surface-panel-collapsed[^\n]*\.chevron\s*\{[\s\S]*?transform:\s*rotate\(-90deg\)/);
});
