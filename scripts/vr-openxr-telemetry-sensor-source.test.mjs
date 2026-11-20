import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const layer = await readFile(new URL('../src/vr/Stephanos.OpenXrTelemetryLayer/stephanos-openxr-telemetry-layer.cpp', import.meta.url), 'utf8');
const nativeTest = await readFile(new URL('../src/vr/Stephanos.OpenXrTelemetryLayer/stephanos-openxr-telemetry-layer.test.cpp', import.meta.url), 'utf8');
const install = await readFile(new URL('./windows/install-vr-openxr-telemetry-layer.ps1', import.meta.url), 'utf8');
const session = await readFile(new URL('./windows/new-vr-telemetry-session.ps1', import.meta.url), 'utf8');
const marker = await readFile(new URL('./windows/vr-visual-fault-marker.ps1', import.meta.url), 'utf8');
const launcher = await readFile(new URL('./windows/launch-starfield-vr.ps1', import.meta.url), 'utf8');
const performance = await readFile(new URL('./windows/starfield-vr-performance-mode.ps1', import.meta.url), 'utf8');
const producer = await readFile(new URL('./windows/starfield-vr-runtime-metrics-producer.ps1', import.meta.url), 'utf8');
const observe = await readFile(new URL('./windows/run-starfield-aer-stabilizer-observe.ps1', import.meta.url), 'utf8');

test('generic OpenXR flight recorder is pass-through and observes the full stereo submission lifecycle', () => {
  for (const command of [
    'xrAcquireSwapchainImage',
    'xrWaitSwapchainImage',
    'xrReleaseSwapchainImage',
    'xrWaitFrame',
    'xrBeginFrame',
    'xrLocateViews',
    'xrEndFrame',
  ]) {
    assert.match(layer, new RegExp(command));
  }
  assert.match(layer, /NO_PROJECTION_LAYER/);
  assert.match(layer, /MISSING_STEREO_EYE/);
  assert.match(layer, /EYE_RELEASE_UNPROVEN/);
  assert.match(layer, /REUSED_SWAPCHAIN_RELEASE/);
  assert.match(layer, /END_FRAME_FAILURE/);
  assert.match(layer, /SUBMISSION_PRESENT_PIXELS_UNOBSERVED/);
  assert.match(layer, /eyePresentationSkewMs/);
  assert.match(layer, /poseDisplayDeltaMs/);
  assert.match(layer, /predictionDeltaMs/);
  assert.match(layer, /submittedPose/);
  assert.match(layer, /submittedFov/);
  assert.match(layer, /locatedPose/);
  assert.match(layer, /locatedFov/);
  assert.match(layer, /pixelContentState/);
  assert.match(layer, /UNOBSERVED/);
  assert.match(layer, /std::try_to_lock/);
  assert.match(layer, /256ull \* 1024ull \* 1024ull/);
  assert.doesNotMatch(layer, /Map\(|Readback|CopyTextureRegion|CopyResource|CreateCommittedResource/i);
});

test('native mock-runtime test proves stereo, missing-eye and end-frame failure observation without a game', () => {
  assert.match(nativeTest, /gameLaunched\\":false/);
  assert.match(nativeTest, /frameMutation\\":false/);
  assert.match(nativeTest, /MISSING_STEREO_EYE/);
  assert.match(nativeTest, /END_FRAME_FAILURE/);
  assert.match(nativeTest, /SUBMISSION_PRESENT_PIXELS_UNOBSERVED/);
});

test('installation and launch bind a hash-proven layer to one child game process only', () => {
  assert.match(install, /VR_OPENXR_TELEMETRY_LAYER_INSTALLED/);
  assert.match(install, /dllSha256/);
  assert.match(install, /nativeTest/);
  assert.match(install, /gameLaunched -ne \$false/);
  assert.match(install, /frameMutation -ne \$false/);
  assert.match(session, /Get-FileHash -LiteralPath \$dllPath -Algorithm SHA256/);
  assert.match(session, /dllHash -ne \(\[string\]\$install\.dllSha256\)/);
  assert.match(session, /pixelContentSampling = \$false/);
  assert.match(launcher, /STEPHANOS_VR_TELEMETRY_TARGET_EXE/);
  assert.match(launcher, /STEPHANOS_VR_TELEMETRY_LAUNCH_SESSION_ID/);
  assert.match(launcher, /XR_ENABLE_API_LAYERS/);
  assert.match(launcher, /XR_APILAYER_STEPHANOS_telemetry_v1/);
  assert.match(launcher, /finally[\s\S]*SetEnvironmentVariable\(\$name, \$previous\[\$name\], 'Process'\)/);
});

test('visual marker and provider adapter feed the same flight-recorder timeline', () => {
  assert.match(marker, /XINPUT_VIEW_L3_R3/);
  assert.match(marker, /KEYBOARD_F12/);
  assert.match(marker, /operator_visual_fault_marker/);
  assert.match(performance, /OPERATOR_VISUAL_FAULT/);
  assert.match(performance, /VISUAL_SUBMISSION_ANOMALY/);
  assert.match(performance, /AER_SEQUENCE_FAULT/);
  assert.match(producer, /Get-LatestOpenXrVisualEvent/);
  assert.match(producer, /Get-OperatorMarkerState/);
  assert.match(producer, /Get-ProviderTelemetryState/);
  assert.match(producer, /aerSequenceFaultCount/);
  assert.match(observe, /-ProviderTelemetryPath \$liveLog/);
  assert.match(observe, /mutar\.aer-presenter-sequence/);
});
