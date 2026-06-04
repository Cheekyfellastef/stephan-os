import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentsDir = path.dirname(new URL(import.meta.url).pathname);
const flywheelPath = path.join(componentsDir, 'FlywheelPanel.jsx');
const appPath = path.join(componentsDir, '../App.jsx');
const aiStorePath = path.join(componentsDir, '../state/aiStore.js');

test('FlywheelPanel uses canonical CollapsiblePanel and exposes required shared state sections', async () => {
  const source = await fs.readFile(flywheelPath, 'utf8');
  assert.match(source, /import CollapsiblePanel from '\.\/CollapsiblePanel';/);
  assert.match(source, /panelId="flywheelPanel"/);
  for (const label of ['Mission State', 'Current Thinking', 'Next Action', 'Agent Notes', 'Decision Log']) {
    assert.equal(source.includes(label), true);
  }
});

test('FlywheelPanel exposes required flywheel metrics and file-backed TODO', async () => {
  const source = await fs.readFile(flywheelPath, 'utf8');
  for (const metric of ['Flywheel Index', 'Context Recovery Time', 'Human Routing Load', 'Capability Discoveries', 'Time From Idea To Reality']) {
    assert.equal(source.includes(metric), true);
  }
  assert.match(source, /TODO:[\s\S]*MISSION_STATE\.md[\s\S]*DECISION_LOG\.md/);
});

test('App and store register Flywheel pane through existing pane order system', async () => {
  const appSource = await fs.readFile(appPath, 'utf8');
  const storeSource = await fs.readFile(aiStorePath, 'utf8');
  assert.equal(appSource.includes("import FlywheelPanel from './components/FlywheelPanel.jsx';"), true);
  assert.equal(appSource.includes("id: 'flywheelPanel'"), true);
  assert.equal(appSource.includes('<FlywheelPanel />'), true);
  assert.match(storeSource, /flywheelPanel: true/);
  assert.match(storeSource, /const DEFAULT_OPERATOR_PANE_ORDER = \[[\s\S]*'flywheelPanel'/m);
});
