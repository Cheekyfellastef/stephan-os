import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const stylesPath = path.resolve(root, '../styles.css');
const missionConsolePath = path.resolve(root, 'MissionConsoleTile.jsx');

test('canonical workspace shell/stage/canvas/content contract exists', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  ['.workspace-shell', '.workspace-stage', '.workspace-canvas', '.workspace-content', '.mission-console-workspace', '.mission-console-workspace-wide'].forEach((token) => {
    assert.equal(css.includes(token), true, `missing workspace token: ${token}`);
  });
});

test('mission console mounts as workspace-class surface and not narrow tile-only class', async () => {
  const source = await fs.readFile(missionConsolePath, 'utf8');
  ['mission-console-workspace', 'mission-console-workspace-wide', 'stephanos-workspace-surface', 'stephanos-workspace-surface--mission'].forEach((token) => {
    assert.equal(source.includes(token), true, `missing mission workspace token: ${token}`);
  });
});

test('readable min-width and responsive stack guardrails are explicit', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  ['--workspace-shell-lane-nav-min: 260px', '--workspace-shell-lane-main-min: 760px', '--workspace-shell-lane-rail-min: 320px', 'min-width:0', '@media (max-width: 1280px)', 'grid-template-columns: minmax(0,1fr);'].forEach((token) => {
    assert.equal(css.includes(token), true, `missing readable width token: ${token}`);
  });
});

test('global overflow and nested panel body lock are prevented for workspace mode', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  ['.workspace-content', 'overflow-x: hidden', '.mission-console-workspace .panel-body', 'height: auto', 'max-height: none', 'overflow: visible'].forEach((token) => {
    assert.equal(css.includes(token), true, `missing overflow/height token: ${token}`);
  });
});

test('workspace containment authority enforces bounded children and local overflow only', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  [
    '.workspace-content > .panel',
    '.workspace-content > section',
    '.workspace-content > div',
    'max-width: 100%',
    '.mission-command-deck-canvas',
    'overflow: hidden',
    '.mission-console-workspace .mission-command-deck-canvas',
  ].forEach((token) => {
    assert.equal(css.includes(token), true, `missing containment token: ${token}`);
  });
});
