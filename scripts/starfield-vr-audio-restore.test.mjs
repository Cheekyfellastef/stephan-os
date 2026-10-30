import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const audio = await readFile(new URL('./windows/starfield-vr-audio-endpoint.ps1', import.meta.url), 'utf8');
const performance = await readFile(new URL('./windows/starfield-vr-performance-mode.ps1', import.meta.url), 'utf8');

test('Starfield VR captures and restores exact Windows audio roles', () => {
  assert.match(audio, /GetDefaultRenderEndpointForRole/);
  assert.match(audio, /SetDefaultRenderEndpointForRole/);
  assert.match(audio, /GetDefaults/);
  assert.match(audio, /RestoreDefaults/);
  assert.match(audio, /consoleEndpointId/);
  assert.match(audio, /multimediaEndpointId/);
  assert.match(audio, /communicationsEndpointId/);
  assert.match(audio, /eConsole/);
  assert.match(audio, /eMultimedia/);
  assert.match(audio, /eCommunications/);
});

test('performance session records the exact pre-VR audio state', () => {
  assert.match(performance, /-Action GetDefaults/);
  assert.match(performance, /originalEndpoints = \[ordered\]@\{/);
  assert.match(performance, /consoleEndpointId = \[string\]\$audioCurrent\.endpoints\.consoleEndpointId/);
  assert.match(performance, /multimediaEndpointId = \[string\]\$audioCurrent\.endpoints\.multimediaEndpointId/);
  assert.match(performance, /communicationsEndpointId = \[string\]\$audioCurrent\.endpoints\.communicationsEndpointId/);
});

test('audio restore is retried and requires two stable confirmations', () => {
  assert.match(performance, /function Restore-AudioState/);
  assert.match(performance, /TimeoutSeconds = 15/);
  assert.match(performance, /stableConfirmations/);
  assert.match(performance, /stableConfirmations -ge 2/);
  assert.match(performance, /Audio endpoint changed again after restore/);
  assert.match(performance, /-Action RestoreDefaults/);
  assert.match(performance, /-Action GetDefaults/);
});

test('leaving Air Link restores desktop audio even while Starfield remains alive', () => {
  assert.match(performance, /\$airLinkWasObserved = \$false/);
  assert.match(performance, /\$airLinkInactiveSince = \$null/);
  assert.match(performance, /TotalSeconds -ge 10/);
  assert.match(performance, /Restore-AudioState -Session \$session -TimeoutSeconds 10/);
  assert.match(performance, /audioRestoredOnAirLinkExit/);
});

test('final summary carries audio restore proof for future diagnosis', () => {
  assert.match(performance, /audioRestoreAttempts/);
  assert.match(performance, /audioStableConfirmations/);
  assert.match(performance, /audioFinalEndpointId/);
  assert.match(performance, /audioRestoreError/);
  assert.match(performance, /originalAudioEndpoints/);
});
