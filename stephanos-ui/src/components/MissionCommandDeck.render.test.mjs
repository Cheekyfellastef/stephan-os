import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'MissionCommandDeck.jsx');
const stylesPath = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../styles.css');

test('Command Deck renders required shell, strip, rail, hero, and matrix sections', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  [
    'mission-command-deck-fullwidth',
    'Mission Console / Command Deck',
    'mission-deck-strip',
    'mission-deck-rail',
    'Mission Routing / Delegation Readiness',
    'aria-label="readiness ring"',
    'Agent Assignment Matrix',
    '<table>',
  ].forEach((token) => assert.equal(source.includes(token), true, `missing token: ${token}`));
});

test('Command Deck renders repair contract, operator cards, runtime snapshot, activity feed, and secondary cards', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  [
    'Codex PR Repair Contract',
    'Retry Checks',
    'Repair PR',
    'Recreate PR',
    'Operator Decision Console',
    'Operator chooses the path — no default manual code surgery.',
    'Support Snapshot / Runtime Truth',
    'Activity Feed',
    'Skill Forge',
    'Capability Radar',
    'Memory Librarian',
    'OpenClaw Policy State',
    'Verification Judge',
  ].forEach((token) => assert.equal(source.includes(token), true, `missing token: ${token}`));
});

test('Missing data fallback and preview controls are safe and explicit', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  ['no evidence yet / unavailable', 'preview-only control', '(Preview)', 'disabled aria-disabled="true"'].forEach((token) => {
    assert.equal(source.includes(token), true, `missing safety token: ${token}`);
  });
});

test('Static style guard enforces full-width, min-width, wrapping, responsive grid, and accessibility cues', async () => {
  const css = await fs.readFile(stylesPath, 'utf8');
  [
    'app-shell-root.mission-console-surface-mode',
    'mission-console-surface-stage',
    'mission-console-workspace-wide',
    'width: 100%',
    'max-width:none',
    'min-width:0',
    'minmax(0, 1fr)',
    'minmax(min(200px,100%),1fr)',
    'overflow-wrap:anywhere',
    'cursor:pointer',
    ':focus-visible',
  ].forEach((token) => assert.equal(css.includes(token), true, `missing style token: ${token}`));
});

