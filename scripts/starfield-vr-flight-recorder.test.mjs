import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { validateStarfieldVrPhysicalVerdict } from './report-starfield-vr-telemetry.mjs';

test('Windows VR diagnosis handles zero, one and conflicting providers without inventing missing metrics', { skip: process.platform !== 'win32' }, async () => {
  const scriptPath = fileURLToPath(new URL('./windows/read-starfield-vr-performance-diagnosis.ps1', import.meta.url));
  for (const [sessionProvider, summaryProvider, expectedIdentity, expectedProvider, samples] of [
    ['', '', 'UNKNOWN_PROVIDER', 'UNKNOWN', []],
    ['mutar-openxr', '', 'VERIFIED_PROVIDER', 'mutar-openxr', [20]],
    ['vorpx', 'vorpx', 'VERIFIED_PROVIDER', 'vorpx', [20, 40]],
    ['mutar-openxr', 'vorpx', 'PROVIDER_IDENTITY_CONFLICT', 'UNKNOWN', [20, 40]],
    ['vorpx', '', 'VERIFIED_PROVIDER', 'vorpx', [null]],
  ]) {
    const workspace = await mkdtemp(join(tmpdir(), 'sovereign-vr-diagnosis-'));
    try {
      if (samples.length) {
        const sessions = join(workspace, 'vr', 'starfield-vr-performance-sessions');
        await mkdir(sessions, { recursive: true });
        const base = join(sessions, 'starfield-vr-performance-fixture');
        await writeFile(base + '.csv', 'timestampUtc,gpuUtilPct\n'
          + samples.map((value, index) => `2026-10-12T00:00:0${index}Z,${value ?? ''}\n`).join(''));
        await writeFile(base + '.json', JSON.stringify({ routeIdentity: { provider: sessionProvider } }));
        await writeFile(base + '.summary.json', JSON.stringify({ routeIdentity: { provider: summaryProvider } }));
      }
      const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath, '-WorkspaceRoot', workspace,
      ], { encoding: 'utf8', shell: false, windowsHide: true, timeout: 20_000 });
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      const receipt = JSON.parse(result.stdout);
      assert.equal(receipt.context.providerIdentityStatus, expectedIdentity);
      assert.equal(receipt.context.provider, expectedProvider);
      const measured = samples.filter(value => typeof value === 'number');
      assert.equal(receipt.metrics.sampleCount, samples.length);
      assert.equal(receipt.metrics.avgGpuUtilPct, measured.length
        ? measured.reduce((sum, value) => sum + value, 0) / measured.length : null);
      assert.equal(receipt.metrics.maxGpuUtilPct, measured.length ? Math.max(...measured) : null);
      assert.equal(receipt.metrics.avgApplicationFrameTimeMs, null);
      assert.equal(receipt.metrics.frameTimeTelemetryAvailable, false);
      assert.equal(receipt.metrics.storageTelemetryAvailable, false);
      assert.equal(receipt.boundaries.readOnly, true);
      assert.equal(receipt.boundaries.mutationAuthority, false);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }
});

const performance = await readFile(new URL('./windows/starfield-vr-performance-mode.ps1', import.meta.url), 'utf8');
const recorder = await readFile(new URL('./windows/starfield-vr-flight-recorder.ps1', import.meta.url), 'utf8');
const runtimeProducer = await readFile(new URL('./windows/starfield-vr-runtime-metrics-producer.ps1', import.meta.url), 'utf8');
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
  assert.match(recorder, /\[string\]::Equals\(\$payloadLaunch, \$LaunchSessionId, \[StringComparison\]::Ordinal\)/);
  assert.match(recorder, /\[string\]::Equals\(\$payloadProvider, \$Provider, \[StringComparison\]::Ordinal\)/);
  assert.doesNotMatch(recorder, /\$payloadLaunch -ne \$LaunchSessionId/);
  assert.doesNotMatch(recorder, /\$payloadProvider -ne \$Provider/);
  assert.match(recorder, /RUNTIME_METRICS_PAYLOAD_IDENTITY_MISSING/);
  assert.match(recorder, /RUNTIME_METRICS_SOURCE_FUTURE/);
  assert.match(recorder, /Get-StarfieldVrOptionalProperty/);
  assert.match(recorder, /Write-Output -NoEnumerate \$property\.Value/);
  assert.match(recorder, /Test-StarfieldVrPrimitiveScalar/);
  assert.match(recorder, /-not \(Test-StarfieldVrPrimitiveScalar -Value \$raw\)/);
  assert.match(recorder, /Get-StarfieldVrOptionalString/);
  assert.match(recorder, /-not \(\$raw -is \[string\]\)/);
  assert.match(recorder, /reprojectionState = Get-StarfieldVrOptionalString/);
  assert.match(recorder, /aswState = Get-StarfieldVrOptionalString/);
  assert.match(recorder, /stereoMode = Get-StarfieldVrOptionalString/);
  assert.doesNotMatch(recorder, /reprojectionState = \[string\]/);
  assert.doesNotMatch(recorder, /aswState = \[string\]/);
  assert.doesNotMatch(recorder, /stereoMode = \[string\]/);
  assert.match(recorder, /Get-StarfieldVrOptionalNumber/);
  assert.match(recorder, /\[double\]::TryParse/);
  assert.match(recorder, /\[double\]::IsNaN/);
  assert.match(recorder, /\[double\]::IsInfinity/);
  assert.match(recorder, /Get-StarfieldVrBoundedNumber/);
  assert.match(recorder, /\$value -lt \$Minimum -or \$value -gt \$Maximum/);
  assert.match(recorder, /applicationFrameTimeMs = Get-StarfieldVrBoundedNumber .* -Minimum 0\.01 -Maximum 60000/);
  assert.match(recorder, /networkLatencyMs = Get-StarfieldVrBoundedNumber .* -Minimum 0 -Maximum 60000/);
  assert.match(recorder, /packetLossPct = Get-StarfieldVrBoundedNumber .* -Minimum 0 -Maximum 100/);
  assert.match(recorder, /openXrRenderWidth = Get-StarfieldVrBoundedNumber .* -Minimum 1 -Maximum 32768/);
  assert.doesNotMatch(recorder, /applicationFrameTimeMs = Get-StarfieldVrOptionalNumber/);
  assert.doesNotMatch(recorder, /applicationFrameTimeMs = \$payload\.applicationFrameTimeMs/);
});

test('Meta Air Link runtime metrics producer feeds measured render and transport telemetry', () => {
  assert.match(runtimeProducer, /META_OCULUS_PERFLOG_XRS_STATS/);
  assert.match(runtimeProducer, /oculus_pc_xrs_stats_event/);
  assert.match(runtimeProducer, /render_duration_seconds_p50/);
  assert.match(runtimeProducer, /render_duration_seconds_p95/);
  assert.match(runtimeProducer, /num_pc_presented_frames/);
  assert.match(runtimeProducer, /network_rtt_ms_p50/);
  assert.match(runtimeProducer, /network_rtt_ms_jitter/);
  assert.match(runtimeProducer, /encode_duration_seconds_p50/);
  assert.match(runtimeProducer, /decode_duration_seconds_p50/);
  assert.match(runtimeProducer, /total_network_video_goodput_Mbps/);
  assert.match(runtimeProducer, /app_render_width/);
  assert.match(runtimeProducer, /app_render_height/);
  assert.match(runtimeProducer, /SessionStartedAtUtc/);
  assert.match(runtimeProducer, /NoGameGraceSeconds = 35/);
  assert.match(runtimeProducer, /eventUtc -ge \$sessionStartUtc\.AddSeconds\(-2\)/);
  assert.match(performance, /starfield-vr-runtime-metrics-producer\.ps1/);
  assert.match(performance, /source = 'META_OCULUS_PERFLOG_XRS_STATS'/);
  assert.match(performance, /freshnessSeconds = 75/);
  assert.match(performance, /-MaxAgeSeconds \$runtimeMetricsFreshnessSeconds/);
});

test('VR guard preserves finalization on Windows PowerShell and boosts the CPU-bound VR path reversibly', () => {
  assert.match(performance, /observedGameProcessIds = \$observedGameProcessIds\.ToArray\(\)/);
  assert.match(performance, /Get-StarfieldVrTelemetryCompleteness -Samples \$samples\.ToArray\(\)/);
  assert.doesNotMatch(performance, /Get-StarfieldVrTelemetryCompleteness -Samples @\(\$samples\)/);
  assert.match(performance, /Apply-StarfieldVrPriorityBoost/);
  assert.match(performance, /Set-VrProcessPriority -ProcessId \$GameProcessId -Priority High/);
  assert.match(performance, /Get-Process -Name 'OVRServer_x64'/);
  assert.match(performance, /Get-Process -Name 'OculusDash'/);
  assert.match(performance, /Restore-StarfieldVrPriorities/);
  assert.match(performance, /priorityRestoreCount/);
  assert.match(performance, /restoreFailure/);
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
  assert.match(performance, /workspaceRootProperty/);
  assert.match(performance, /Guard requires the session WorkspaceRoot/);
  assert.match(performance, /-AppliedSettings \$appliedSettings/);
  assert.doesNotMatch(performance, /-AppliedSettings \$originalSettings/);
  assert.match(performance, /ValidateSet\('Enter','StartGuard','Guard','Restore','Recover'\)/);
  assert.match(performance, /proof = 'FIRST_SAMPLE_RECORDED'/);
  assert.match(performance, /sampleCount -ge 1/);
  assert.match(performance, /COMFORT_BASELINE_V1/);
  assert.match(performance, /VR_AsyncAER/);
  assert.match(performance, /DLSS_AER_Enabled/);
  assert.match(performance, /CreationEngine_MotionVectorFix/);
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
  assert.match(reporter, /validateStarfieldVrPhysicalVerdict/);
  assert.match(reporter, /PHYSICAL_VERDICT_PROVENANCE_INVALID/);
  assert.match(reporter, /PHYSICAL_VERDICT_TIME_UNBOUND/);
  assert.match(reporter, /physicalVerdictStatus/);
  assert.match(verdictPrompt, /source = 'OPERATOR_ONE_CLICK_POST_RUN'/);
  assert.match(verdictPrompt, /inferred = \$false/);
  assert.match(verdictPrompt, /Stereo breakup \/ alternate-eye/);
  assert.match(verdictPrompt, /Nausea \/ discomfort/);
  assert.match(verdictPrompt, /UNRECORDED_TIMEOUT/);
  assert.match(verdictPrompt, /canonical Starfield VR telemetry reporter/);
  assert.match(verdictPrompt, /report-starfield-vr-telemetry\.mjs/);
});


test('physical verdict authority fields reject coercible non-string values', () => {
  const base = {
    schemaVersion: 'stephanos.starfield-vr-physical-verdict.v1',
    recordedAtUtc: '2026-10-02T21:00:30.000Z',
    sessionId: 'session-1',
    primaryVerdict: 'SMOOTH_COMFORTABLE',
    physicalAcceptance: 'ACCEPTED_THIS_RUN',
    source: 'OPERATOR_ONE_CLICK_POST_RUN',
    inferred: false,
  };
  const context = {
    sessionId: 'session-1',
    endedAtUtc: '2026-10-02T21:00:00.000Z',
    now: new Date('2026-10-02T21:01:00.000Z'),
  };
  assert.equal(validateStarfieldVrPhysicalVerdict(base, context).valid, true);
  for (const field of [
    'schemaVersion',
    'recordedAtUtc',
    'sessionId',
    'primaryVerdict',
    'physicalAcceptance',
    'source',
  ]) {
    const malformed = { ...base, [field]: [base[field]] };
    assert.equal(
      validateStarfieldVrPhysicalVerdict(malformed, context).valid,
      false,
      `expected array-valued ${field} to fail closed`,
    );
  }
});
