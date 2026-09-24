import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifyHolodeckDevice,
  inspectHolodeckBaselineCapabilities,
} from '../apps/spatial-bridge/holodeck-baseline-v0.mjs';

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

test('Quest entry exposes the #1717 VR Link surface', () => {
  assert.match(questEntry, /VR Link · Holodeck Baseline/);
  assert.match(questEntry, /Enter Holodeck Baseline/);
  assert.match(questEntry, /Inspect Local Projection/);
  assert.match(questEntry, /Open VR Research Lab/);
  assert.match(questEntry, /WebXR available/);
  assert.match(questEntry, /Backend route/);
  assert.match(questEntry, /enterHolodeckBaseline/);
});

test('manifest separates source readiness from physical immersive proof', () => {
  assert.equal(manifest.authority, 'read-only');
  assert.equal(manifest.capabilities.includes('webxr-holodeck-baseline-source'), true);
  assert.equal(manifest.questDistribution.immersiveRendererSourceReady, true);
  assert.equal(manifest.questDistribution.immersiveRendererReady, false);
  assert.equal(manifest.questDistribution.proofPending, true);
});
