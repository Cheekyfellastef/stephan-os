import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const performance = await readFile(new URL('./windows/starfield-vr-performance-mode.ps1', import.meta.url), 'utf8');
const recorder = await readFile(new URL('./windows/starfield-vr-flight-recorder.ps1', import.meta.url), 'utf8');
const diagnosis = await readFile(new URL('./windows/read-starfield-vr-performance-diagnosis.ps1', import.meta.url), 'utf8');
const reporter = await readFile(new URL('./report-starfield-vr-telemetry.mjs', import.meta.url), 'utf8');
const verdictPrompt = await readFile(new URL('./windows/starfield-vr-physical-verdict-prompt.ps1', import.meta.url), 'utf8');

test('Starfield VR flight recorder captures bounded runtime, stereo, transport and controller evidence', () => {
  assert.match(recorder, /starfield-vr-runtime-metrics-current\.json/);
  assert.match(recorder, /applicationFrameTimeMs/);
  assert.match(recorder, /deliveredCadenceHz/);
  assert.match(recorder, /headsetRefreshRateHz/);
  assert.match(recorder, /droppedFrames/);
  assert.match(recorder, /reprojectionState/);
  assert.match(recorder, /encodeLatencyMs/);
  assert.match(recorder, /networkLatencyMs/);
  assert.match(recorder, /decodeLatencyMs/);
  assert.match(recorder, /packetLossPct/);
  assert.match(recorder, /jitterMs/);
  assert.match(recorder, /leftEyePresentMs/);
  assert.match(recorder, /rightEyePresentMs/);
  assert.match(recorder, /eyePresentationSkewMs/);
  assert.match(recorder, /poseAgeMs/);
  assert.match(recorder, /Get-StarfieldVrControllerSample/);
  assert.match(recorder, /xinputModuleLoaded/);
  assert.match(recorder, /RUNTIME_METRICS_LAUNCH_IDENTITY_MISMATCH/);
  assert.match(recorder, /RUNTIME_METRICS_PROVIDER_IDENTITY_MISMATCH/);
});

test('playtest guard adapts capture cadence and produces configuration, crash and completeness proof', () => {
  assert.match(performance, /Get-StarfieldVrConfigurationFingerprint/);
  assert.match(performance, /Get-StarfieldVrCrashFingerprint/);
  assert.match(performance, /adaptiveCaptureReason/);
  assert.match(performance, /sampleIntervalSeconds = if \(\$adaptiveCaptureActive\) \{ 1 \}/);
  assert.match(performance, /p95ApplicationFrameTimeMs/);
  assert.match(performance, /p99ApplicationFrameTimeMs/);
  assert.match(performance, /telemetryCompleteness/);
  assert.match(performance, /audioLifecycle/);
  assert.match(performance, /starfield-vr-physical-verdict-prompt\.ps1/);
});

test('diagnosis classifies frame, stereo, transport and input evidence and exposes Skyrim baseline readiness', () => {
  assert.match(diagnosis, /frame-time-pressure-observed/);
  assert.match(diagnosis, /stereo-eye-timing-skew-observed/);
  assert.match(diagnosis, /pose-age-high/);
  assert.match(diagnosis, /air-link-packet-loss-observed/);
  assert.match(diagnosis, /air-link-jitter-high/);
  assert.match(diagnosis, /controller-problem-observed/);
  assert.match(diagnosis, /'RENDERING_OR_STEREO'/);
  assert.match(diagnosis, /'STREAMING_TRANSPORT'/);
  assert.match(diagnosis, /'TRACKING_OR_INPUT'/);
  assert.match(diagnosis, /skyrim-vr-known-good\.json/);
  assert.match(diagnosis, /SKYRIM_BASELINE_NOT_CAPTURED/);
});

test('shared telemetry surfaces recorder completeness and operator physical verdict without inference', () => {
  assert.match(reporter, /frameTimeTelemetryAvailable/);
  assert.match(reporter, /maxEyePresentationSkewMs/);
  assert.match(reporter, /telemetryCompleteness/);
  assert.match(reporter, /skyrimBaselineComparison/);
  assert.match(reporter, /physicalVerdict/);
  assert.match(reporter, /physicalAcceptance/);
  assert.match(verdictPrompt, /source = 'OPERATOR_ONE_CLICK_POST_RUN'/);
  assert.match(verdictPrompt, /inferred = \$false/);
  assert.match(verdictPrompt, /Stereo breakup \/ alternate-eye/);
  assert.match(verdictPrompt, /Nausea \/ discomfort/);
  assert.match(verdictPrompt, /UNRECORDED_TIMEOUT/);
});
