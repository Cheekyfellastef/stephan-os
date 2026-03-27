import test from 'node:test';
import assert from 'node:assert/strict';

import { stephanosLaws } from '../shared/runtime/stephanosLaws.mjs';
import { renderStephanosLawsPanel } from '../shared/runtime/renderStephanosLawsPanel.mjs';

function createDocumentFixture() {
  const mount = {
    id: 'stephanos-laws-mount',
    innerHTML: '',
  };

  return {
    getElementById(id) {
      if (id === 'stephanos-laws-mount') {
        return mount;
      }
      return null;
    },
    mount,
  };
}

test('laws panel renderer mounts successfully from structured law source', () => {
  const documentRef = createDocumentFixture();
  const rendered = renderStephanosLawsPanel(documentRef);

  assert.equal(rendered, true);
  assert.match(documentRef.mount.innerHTML, /Laws of Stephanos/);
  assert.match(documentRef.mount.innerHTML, /Constitutional layer/);

  const detailsCount = (documentRef.mount.innerHTML.match(/<details class="stephanos-law-card"/g) || []).length;
  assert.equal(detailsCount, stephanosLaws.length);
});

test('laws panel rendering is data-driven from supplied law set', () => {
  const documentRef = createDocumentFixture();
  const customLaws = [
    {
      id: 'law-custom-sample',
      title: 'Custom Law Title',
      shortStatement: 'Custom short statement',
      fullDescription: 'Custom full description for render coverage.',
      category: 'custom',
      invariantType: 'hard',
      operatorImplication: 'Operator implication',
      engineeringImplication: 'Engineering implication',
      relatedFiles: ['main.js'],
      testCoverageHint: 'tests/stephanos-laws-ui-render.test.mjs',
      severity: 'medium',
      status: 'active',
    },
  ];

  renderStephanosLawsPanel(documentRef, { laws: customLaws });

  assert.match(documentRef.mount.innerHTML, /Custom Law Title/);
  assert.doesNotMatch(documentRef.mount.innerHTML, /Root launcher is universal entry/);
});
