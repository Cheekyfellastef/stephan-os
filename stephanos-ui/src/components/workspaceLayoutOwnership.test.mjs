import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const stylesPath = path.resolve(root, '../styles.css');
const missionConsolePath = path.resolve(root, 'MissionConsoleTile.jsx');
const missionDeckPath = path.resolve(root, 'MissionCommandDeck.jsx');

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

test('workspace containment authority enforces one deck child canvas and bounded overflow', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  const source = await fs.readFile(missionDeckPath, 'utf8');
  ['className="mission-command-deck mission-command-deck-canvas"', '.mission-command-deck-canvas { width:100%; max-width:100%; min-width:0; overflow:hidden; }', '.mission-command-deck-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));', '@media (max-width: 980px) { .mission-command-deck-grid { grid-template-columns:minmax(0,1fr); }'].forEach((token) => {
    assert.equal((source + css).includes(token), true, `missing containment token: ${token}`);
  });
});

test('legacy satellite lane/pane composition is absent in MissionCommandDeck', async () => {
  const source = await fs.readFile(missionDeckPath, 'utf8');
  ['mission-deck-rail', 'mission-deck-nav-button', 'mission-deck-main', 'stephanos-wide-content'].forEach((token) => {
    assert.equal(source.includes(token), false, `legacy layout token present: ${token}`);
  });
});
