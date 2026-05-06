import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'MissionCommandDeck.jsx');
const stylesPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../styles.css');

test('MissionCommandDeck renders command deck visual sections and status strip labels', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  [
    'Route Truth','Launch State','Active Provider','OpenClaw','Codex PR Repair','Memory','Verification','System Watcher',
    'Mission Routing / Delegation Readiness','Agent Assignment Matrix','Codex PR Repair Contract','Operator Decision Console',
    'Support Snapshot / Runtime Truth','Activity Feed','Approval Required','Operator approval needed to proceed',
  ].forEach((label) => assert.equal(source.includes(label), true, `missing label: ${label}`));
});

test('MissionCommandDeck uses real buttons for nav and preview-only actions with clear disabled state', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes('mission-deck-nav-button'), true);
  assert.equal(source.includes('onClick={() => setActiveNav(item)}'), true);
  assert.equal(source.includes('aria-current={activeNav === item ? \'page\' : undefined}'), true);
  assert.equal(source.includes('preview-only control'), true);
  assert.equal(source.includes('(Preview)'), true);
  assert.equal(source.includes('disabled aria-disabled="true"'), true);
});

test('MissionCommandDeck keeps no execution/write/merge automation', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  ['exec(', 'spawn(', 'fetch(', 'git push', 'autonomous execution', 'OpenClaw execution'].forEach((token) => assert.equal(source.includes(token), false, `unexpected automation token: ${token}`));
});

test('MissionCommandDeck styling guards include overflow protections, pointer cursor, and focus-visible', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  [
    'minmax(0,1fr)',
    'min-width:0',
    'max-width:100%',
    'overflow-wrap:anywhere',
    '.mission-deck-nav-button',
    'cursor:pointer',
    ':focus-visible',
  ].forEach((token) => assert.equal(css.includes(token), true, `missing style token: ${token}`));
});

test('MissionCommandDeck long token values are rendered safely and without crashes via wrapping classes', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.equal(source.includes('route/provider truth'), true);
  assert.equal(source.includes('branch:'), true);
  const css = await fs.readFile(stylesPath, 'utf8');
  assert.equal(css.includes('.mission-deck-card'), true);
  assert.equal(css.includes('overflow-wrap:anywhere'), true);
});
