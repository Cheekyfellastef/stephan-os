import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const componentsDir = path.dirname(fileURLToPath(import.meta.url));
const flywheelPath = path.join(componentsDir, 'FlywheelPanel.jsx');
const appPath = path.join(componentsDir, '../App.jsx');
const aiStorePath = path.join(componentsDir, '../state/aiStore.js');

test('FlywheelPanel preserves canonical CollapsiblePanel and renders shared telemetry projections', async () => {
  const source = await fs.readFile(flywheelPath, 'utf8');
  assert.match(source, /import CollapsiblePanel from '\.\/CollapsiblePanel';/);
  assert.match(source, /panelId="flywheelPanel"/);
  assert.match(source, /isOpen=\{uiLayout\.flywheelPanel\}/);
  assert.match(source, /onToggle=\{\(\) => togglePanel\('flywheelPanel'\)\}/);
  assert.match(source, /deriveFlywheelTelemetryView\(telemetry\.payload \|\| \{\}\)/);
  assert.match(source, /const stateItems = view\.valid \? view\.stateItems : \[\];/);
  assert.match(source, /const metrics = view\.valid \? view\.metrics : \[\];/);
  assert.match(source, /stateItems\.map\(\(item\)/);
  assert.match(source, /metrics\.map\(\(metric\)/);
  assert.match(source, /\{view\.exactNextAction\}/);
});

test('FlywheelPanel uses shared backend transport and uplift projection for the live workspace', async () => {
  const source = await fs.readFile(flywheelPath, 'utf8');
  assert.match(source, /import \{ requestWorkspaceHydration \} from '\.\.\/\.\.\/\.\.\/shared\/runtime\/workspaceHydrationBridge\.mjs';/);
  assert.match(source, /await requestWorkspaceHydration\(\{[\s\S]*?workspaceId: 'flywheel',[\s\S]*?datasets: \['dashboard'\],[\s\S]*?runtimeContext,/);
  assert.match(source, /hydration\?\.datasets\?\.dashboard/);
  assert.match(source, /\/api\/shared-workspace\/hydrate\?workspace=flywheel/);
  assert.match(source, /deriveFlywheelWorkspaceView\(telemetry\.payload \|\| \{\}\)/);
  assert.match(source, /<FlywheelWorkspaceCanvas[\s\S]*?\.\.\.upliftView,[\s\S]*?liveFeedState: telemetry\.state,[\s\S]*?liveFeedReason: telemetry\.error \|\| view\.reason/);
  assert.match(source, /data-testid="flywheel-live-state"/);
  assert.match(source, /data-state=\{telemetry\.state\}/);
  assert.match(source, /data-testid="flywheel-backend-unreachable"/);
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
