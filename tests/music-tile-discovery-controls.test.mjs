import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../apps/music-tile/main.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../apps/music-tile/index.html', import.meta.url), 'utf8');

test('discovery controls bind after pane mount/hydration readiness path', () => {
  assert.match(source, /startupLifecycle\.paneMountComplete = true;[\s\S]*startupLifecycle\.hydrationComplete = true;[\s\S]*bindControls\(\);/);
  assert.match(source, /function bindControls\(\) \{[\s\S]*ensureDiscoveryControlBindings\(\);/);
});

test('build/start handlers read visible artist input and validate empty input', () => {
  assert.match(source, /const artistInputValue = readArtistInputValue\(\);/);
  assert.match(source, /Enter at least one artist before building or starting a journey/);
  assert.match(source, /Building journey for: \$\{artistInputValue\}/);
  assert.match(source, /Starting journey for: \$\{artistInputValue\}/);
});

test('discovery controls use delegated click binding in canonical controls pane and avoid double bind', () => {
  assert.match(source, /const controlBindingState = \{[\s\S]*discoveryDelegatedBound: false/);
  assert.match(source, /if \(controlBindingState\.discoveryDelegatedBound\) return;/);
  assert.match(source, /const scope = elements\.controlsPane;[\s\S]*scope\.addEventListener\('click'/);
  assert.doesNotMatch(source, /elements\.smartRefresh\.addEventListener\('click'/);
  assert.doesNotMatch(source, /elements\.flowMode\.addEventListener\('click'/);
});

test('workspace readiness + inline status + taste cockpit are preserved', () => {
  assert.match(source, /setWorkspaceReady\(true, 'pane-mount \+ hydration \+ cockpit \+ pane-body renders complete'\)/);
  assert.match(source, /setDiscoveryStatus\('Ready\. Enter an artist to build or start a journey\.'\)/);
  assert.match(source, /renderTasteCockpit\(\);\s*startupLifecycle\.tasteCockpitRendered = true;/);
  assert.match(html, /id="discovery-status"/);
});
