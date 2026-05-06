import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'MissionCommandDeck.jsx');
const stylesPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../styles.css');

test('MissionCommandDeck uses one canonical bounded root and scan-first grid sections', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  ['className="mission-command-deck mission-command-deck-canvas"', 'mission-command-deck-grid', 'mission-deck-grid-status-strip', 'mission-deck-grid-readiness-hero', 'mission-deck-grid-agent-assignment', 'mission-deck-grid-pr-repair', 'mission-deck-grid-operator-decision'].forEach((token) => {
    assert.equal(source.includes(token), true, `missing token: ${token}`);
  });
});

test('legacy lane/rail/table wrappers are removed from MissionCommandDeck', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  ['mission-deck-rail', 'mission-deck-nav-button', 'mission-deck-table-wrap', 'mission-deck-matrix-wrap'].forEach((token) => {
    assert.equal(source.includes(token), false, `legacy token present: ${token}`);
  });
});

test('Agent assignment and PR repair actions remain bounded and safe', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  ['mission-deck-assignment-row', 'mission-deck-assignment-grid', 'mission-deck-actions', 'preview-only control', 'disabled aria-disabled="true"'].forEach((token) => {
    assert.equal(source.includes(token), true, `missing safety token: ${token}`);
  });
});

test('Missing/unknown data fallback is explicit and safe', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  ['unknown', 'pending', 'no evidence yet / unavailable'].forEach((token) => {
    assert.equal(source.includes(token), true, `missing fallback token: ${token}`);
  });
});

test('Card grid and bounded card CSS guardrails are explicit', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  ['.mission-command-deck-grid', 'grid-template-columns:repeat(auto-fit,minmax(min(320px,100%),1fr));', '.mission-deck-grid-agent-assignment,', 'min-inline-size:min(100%, 300px);', 'grid-template-columns:repeat(auto-fit,minmax(min(280px,100%),1fr));', '.mission-deck-card, .mission-deck-chip, .mission-deck-metric', 'word-break:normal', '.mission-deck-actions { display:flex; gap:8px; flex-wrap:wrap;', '.mission-deck-preview-button', 'white-space:normal'].forEach((token) => {
    assert.equal(css.includes(token), true, `missing style token: ${token}`);
  });
});


test('MissionCommandDeck avoids unsafe vertical text/secondary squeeze patterns', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  ['grid-template-columns:1fr auto', 'writing-mode:vertical', 'writing-mode: vertical'].forEach((token) => {
    assert.equal(css.includes(token), false, `unsafe token present: ${token}`);
  });
  ['@media (max-width: 980px) { .mission-command-deck-grid { grid-template-columns:minmax(0,1fr); }', '.mission-deck-grid-agent-assignment, .mission-deck-grid-pr-repair, .mission-deck-grid-operator-decision { grid-column:1 / -1;'].forEach((token) => {
    assert.equal(css.includes(token), true, `missing stack token: ${token}`);
  });
});
