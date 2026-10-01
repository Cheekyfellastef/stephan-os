import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyHolodeckDevice,
  inspectHolodeckBaselineCapabilities,
} from '../apps/spatial-bridge/holodeck-baseline-v0.mjs';
import { createHolodeckRoomGeometry } from '../apps/spatial-bridge/holodeck-room-v1.mjs';

const questEntry = readFileSync(new URL('../apps/spatial-bridge/quest-entry.html', import.meta.url), 'utf8');
const manifest = JSON.parse(readFileSync(new URL('../apps/spatial-bridge/app.json', import.meta.url), 'utf8'));

test('Holodeck Baseline device classification stays bounded', () => {
  assert.equal(classifyHolodeckDevice('OculusBrowser Quest 3'), 'Quest/browser');
  assert.equal(classifyHolodeckDevice('desktop browser'), 'browser');
});

test('Holodeck capability probe fails closed without WebXR', async () => {
  const capability = await inspectHolodeckBaselineCapabilities({ navigatorRef: { userAgent: 'desktop' } });
  assert.equal(capability.webxrAvailable, false);
  assert.equal(capability.immersiveSupported, false);
  assert.equal(capability.session, 'fallback');
});

test('Holodeck capability probe reports support without claiming a live session', async () => {
  const capability = await inspectHolodeckBaselineCapabilities({
    navigatorRef: {
      userAgent: 'OculusBrowser Quest',
      xr: { isSessionSupported: async (mode) => mode === 'immersive-vr' },
    },
  });
  assert.equal(capability.webxrAvailable, true);
  assert.equal(capability.immersiveSupported, true);
  assert.equal(capability.session, 'fallback');
  assert.equal(capability.device, 'Quest/browser');
});

test('Quest entry exposes the Spatial Workspace starting card', () => {
  assert.match(questEntry, /Stephanos Spatial Workspace/);
  assert.match(questEntry, /Starting Simulation · Holodeck Chamber/);
  assert.match(questEntry, /Enter Spatial Workspace/);
  assert.match(questEntry, /Inspect Local Projection/);
  assert.match(questEntry, /Open VR Research Lab/);
  assert.match(questEntry, /WebXR available/);
  assert.match(questEntry, /Backend route/);
  assert.match(questEntry, /enterHolodeckBaseline/);
});

test('Holodeck room geometry includes the chamber and first idea cube', () => {
  const geometry = createHolodeckRoomGeometry();
  assert.ok(geometry.vertexCount > 300);
  assert.equal(geometry.positions.length, geometry.colors.length);
  assert.equal(geometry.positions.length, geometry.vertexCount * 3);
  assert.deepEqual(geometry.ideaCube.center, [0, 1.18, -2.2]);
  assert.equal(geometry.ideaCube.size, 0.58);
  assert.equal(geometry.room.frontZ, -6);
  assert.equal(geometry.room.height, 3.2);
});

test('manifest separates source readiness from physical immersive proof', () => {
  assert.equal(manifest.authority, 'read-only');
  assert.equal(manifest.capabilities.includes('webxr-holodeck-baseline-source'), true);
  assert.equal(manifest.capabilities.includes('spatial-workspace-starting-chamber-v1'), true);
  assert.equal(manifest.capabilities.includes('idea-cube-visual-primitive'), true);
  assert.equal(manifest.questDistribution.immersiveRendererSourceReady, true);
  assert.equal(manifest.questDistribution.immersiveRendererReady, false);
  assert.equal(manifest.questDistribution.proofPending, true);
});
