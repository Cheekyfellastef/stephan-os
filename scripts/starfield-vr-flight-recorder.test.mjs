import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { validateStarfieldVrPhysicalVerdict } from './report-starfield-vr-telemetry.mjs';

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

test('Starfield VR playtest CPU attribution tracks desktop ChatGPT and browsers alongside game/frame telemetry', () => {
  assert.match(recorder, /function Get-StarfieldVrCpuConsumerSample/);
  assert.match(recorder, /chatGpt = 'ChatGPT'/);
  assert.match(recorder, /edge = 'msedge'/);
  assert.match(recorder, /brave = 'brave'/);
  assert.match(recorder, /webView2 = 'msedgewebview2'/);
  assert.match(recorder, /node = 'node'/);
  assert.match(recorder, /metaVr = 'OVRServer_x64'/);
  assert.match(recorder, /\$Previous\[\$pidValue\]/);
  assert.match(recorder, /\$startTicks/);
  assert.match(recorder, /\$duration -gt 0/);
  assert.match(recorder, /\$g\.matched -eq \$g\.count/);
  assert.match(recorder, /return \[pscustomobject\]\$out/);
  assert.match(performance, /\$cpuConsumerHistory = @\{\}/);
  assert.match(performance, /Get-StarfieldVrCpuConsumerSample -Previous \$cpuConsumerHistory/);
  assert.match(performance, /chatGptCpuPct = \$cpuConsumers\.chatGptCpuPct/);
  assert.match(performance, /edgeCpuPct = \$cpuConsumers\.edgeCpuPct/);
  assert.match(performance, /webView2CpuPct = \$cpuConsumers\.webView2CpuPct/);
  assert.match(performance, /cpuConsumersAvailable = \[bool\]\$cpuConsumers\.available/);
  assert.match(performance, /avgChatGptCpuPct = if \(\$chatGptCpuSamples.Count\)/);
  assert.match(performance, /maxChatGptCpuPct = if \(\$chatGptCpuSamples.Count\)/);
  assert.match(performance, /browserTabsInspected = \$false/);
  assert.match(performance, /chatGptConversationContentsInspected = \$false/);
  assert.doesNotMatch(recorder, /\b(?:Stop-Process|taskkill|Invoke-Expression|Get-Content.*(?:Cookies|History)|Get-CimInstance Win32_Process|CommandLine)\b/i);
  assert.doesNotMatch(recorder, /chrome:\/\/|edge:\/\/|brave:\/\//);
  assert.match(diagnosis, /desktop-chatgpt-cpu-contention-observed/);
  assert.match(diagnosis, /edge-process-cpu-contention-observed/);
  assert.match(reporter, /avgChatGptCpuPct: safeMetric/);
});


test('Starfield diagnosis carries actual sampled CPU attribution counts into planning', () => {
  // Real collector summary already writes these counts, but the diagnostic
  // payload that the CPU/AER planner consumes must report them independently.
  assert.match(performance, /starfieldThreadCpuMeasuredSampleCount = \\$busiestThreadSamples\\.Count/);
  assert.match(performance, /cpuConsumersAvailableSampleCount = \\$cpuConsumerAvailableSamples\\.Count/);
  assert.match(diagnosis, /\\$cpuConsumersAvailableRows = @\\(\\$rows \\| Where-Object/);
  assert.match(diagnosis, /-Name 'cpuConsumersAvailable' -Default 'False'\\) -ceq 'True'/);
  assert.match(diagnosis, /starfieldThreadCpuMeasuredSampleCount = @\\(\\$starfieldThreadCpu\\)\\.Count/);
  assert.match(diagnosis, /cpuConsumersAvailableSampleCount = \\$cpuConsumersAvailableRows\\.Count/);
  assert.match(reporter, /starfieldThreadCpuMeasuredSampleCount: metrics\\?\\.starfieldThreadCpuMeasuredSampleCount/);
  assert.match(reporter, /cpuConsumersAvailableSampleCount: metrics\\?\\.cpuConsumersAvailableSampleCount/);
});

test('Starfield whole-game CPU sample rejects PID reuse, counter rollback and stale baseline', () => {
  const cpuBlock = performance.match(/\$starfieldCpuPct = \$null[\s\S]*?# Same-session fixed-name CPU attribution/)?.[0];
  assert.ok(cpuBlock, 'locate the same-session game CPU delta block');
  assert.match(cpuBlock, /\$gameStartTicks = \[long\]\$game\.StartTime\.ToUniversalTime\(\)\.Ticks/);
  assert.match(cpuBlock, /\$previousCpu\.processStartTicks -eq \$gameStartTicks/);
  assert.match(cpuBlock, /\$elapsedSeconds -gt 0 -and \$elapsedSeconds -le 120/);
  assert.match(cpuBlock, /\$cpuDeltaSeconds -ge 0/);
  assert.match(cpuBlock, /\$null -ne \$gameStartTicks/);
  assert.match(cpuBlock, /\$previousCpuByPid\.Remove\(\$currentGameProcessId\)/);
  assert.doesNotMatch(cpuBlock, /\[Math\]::Max\(0, \$cpuSeconds -/);
});

test('Starfield busiest-thread CPU uses bounded, lifetime-bound, low-overhead measurements', () => {
  assert.match(recorder, /function Get-StarfieldVrGameThreadCpuSample/);
  assert.match(recorder, /MaximumThreadCount = 512/);
  assert.match(recorder, /THREAD_SAMPLE_THROTTLED/);
  assert.match(recorder, /\$since -ge 0 -and \$since -lt 5/);
  assert.match(recorder, /STARFIELD_PROCESS_THREAD_CPU_DELTAS/);
  assert.match(recorder, /\$process\.StartTime\.ToUniversalTime\(\)\.Ticks/);
  assert.match(recorder, /\$thread\.StartTime\.ToUniversalTime\(\)\.Ticks/);
  assert.match(recorder, /\$thread\.TotalProcessorTime\.TotalSeconds/);
  assert.match(recorder, /old\.startTicks -eq \$threadStartTicks/);
  assert.match(recorder, /\$Previous\.processId -eq \$GameProcessId/);
  assert.match(recorder, /\$out\.busiestThreadCpuPct/);
  assert.match(recorder, /THREAD_SNAPSHOT_UNAVAILABLE/);
  assert.doesNotMatch(recorder, /thread\.PriorityLevel\s*=|thread\.ProcessorAffinity\s*=/i);
  assert.match(performance, /\$starfieldThreadCpuHistory = @\{\}/);
  assert.match(performance, /Get-StarfieldVrGameThreadCpuSample -GameProcessId \$currentGameProcessId/);
  assert.match(performance, /starfieldBusiestThreadCpuPct = \$gameThreads\.busiestThreadCpuPct/);
  assert.match(performance, /starfieldThreadCpuReason = \[string\]\$gameThreads\.reason/);
  assert.match(performance, /maxStarfieldBusiestThreadCpuPct = if \(\$busiestThreadSamples.Count\)/);
  assert.match(performance, /starfieldThreadRoleKnown = \$false/);
  assert.match(diagnosis, /starfield-single-thread-saturation-observed/);
  assert.match(diagnosis, /maxStarfieldBusiestThreadCpuPct = Get-Maximum/);
  assert.match(reporter, /maxStarfieldBusiestThreadCpuPct: safeMetric/);
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

test('Starfield thread inspection limits attempts even on failure', () => {
  const functionBody = recorder.split('function Get-StarfieldVrGameThreadCpuSample {')[1]
    ?.split('function Get-StarfieldVrCrashFingerprint')[0];
  assert.ok(functionBody, 'target sampler must exist');
  assert.match(functionBody, /THREAD_INVENTORY_LIMIT[\s\S]*?\$Previous\.Clear\(\)[\s\S]*?return \[pscustomobject\]\$out/);
  assert.match(functionBody, /\} catch \{[\s\S]*?\$out\.reason = 'THREAD_SNAPSHOT_UNAVAILABLE'\s*\} finally \{/);
  assert.match(functionBody, /\$Previous\.processId = \$GameProcessId\s*\$Previous\.collectedAtUtc = \$sampledAt/);
  assert.match(functionBody, /\$Previous\.collectedAtUtc -is \[DateTime\]/, 'malformed cooldown history must not crash the sampler');
  assert.doesNotMatch(functionBody, /Stop-Process|taskkill|ProcessorAffinity\s*=|PriorityLevel\s*=/i);
});

test('Starfield thread inspection native Windows regression: failure, cap and recovery', { skip: process.platform !== 'win32' }, () => {
  const file = fileURLToPath(new URL('./windows/starfield-vr-flight-recorder.ps1', import.meta.url)).replaceAll("'", "''");
  const script = ["$ErrorActionPreference = 'Stop'","RECORDER_FILE_PATH","$base = [DateTime]::Parse('2026-10-23T12:00:00Z')","$script:now = $base","$script:mode = 'deny'","$script:cpuSeconds = 0","$script:attempts = 0","function Get-Date { return $script:now }","function Get-Process {"," [CmdletBinding()]"," param([int]$Id)"," $script:attempts++"," if ($script:mode -eq 'deny') { throw 'simulated access denied' }"," if ($script:mode -eq 'oversized') { return [pscustomobject]@{StartTime=$base;Threads=@(1..513)} }"," return [pscustomobject]@{StartTime=$base;Threads=@([pscustomobject]@{Id=12;StartTime=$base;TotalProcessorTime=[TimeSpan]::FromSeconds($script:cpuSeconds)})}","}","foreach ($mode in @('deny','oversized')) {"," $script:mode = $mode"," $script:attempts = 0"," $history = @{}"," foreach ($n in 0..11) {","  $script:now = $base.AddSeconds($n)","  $sample = Get-StarfieldVrGameThreadCpuSample -GameProcessId 42 -Previous $history","  if ($null -ne $sample.busiestThreadCpuPct) { throw 'unmeasured CPU reported as measured' }"," }"," if ($script:attempts -ne 3) { throw \"failure-mode $mode attempted $script:attempts inspections instead of 3\" }","}","$script:mode = 'healthy'","$script:attempts = 0","$history = @{}","$script:now = $base","$script:cpuSeconds = 0","$warm = Get-StarfieldVrGameThreadCpuSample -GameProcessId 42 -Previous $history","$script:now = $base.AddSeconds(1)","$skip = Get-StarfieldVrGameThreadCpuSample -GameProcessId 42 -Previous $history","$script:now = $base.AddSeconds(5)","$script:cpuSeconds = 2","$measure = Get-StarfieldVrGameThreadCpuSample -GameProcessId 42 -Previous $history","if ($warm.reason -ne 'THREAD_WARMUP' -or $skip.reason -ne 'THREAD_SAMPLE_THROTTLED' -or $measure.reason -ne 'THREAD_CPU_MEASURED') {throw 'recovery reason incorrect'}","if ($measure.busiestThreadCpuPct -lt 39 -or $measure.busiestThreadCpuPct -gt 41 -or $script:attempts -ne 2) {throw 'measurement/recovery incorrect'}","$history = @{processId=42;collectedAtUtc='not-a-DateTime';threadCpu=@{}}","$script:now = $base.AddSeconds(20)","$attemptsBefore = $script:attempts","$invalidHistory = Get-StarfieldVrGameThreadCpuSample -GameProcessId 42 -Previous $history","if ($invalidHistory.reason -ne 'THREAD_WARMUP' -or $null -ne $invalidHistory.busiestThreadCpuPct) {throw 'invalid history must warm up without measured CPU'}","if ($script:attempts -ne ($attemptsBefore+1)) {throw 'invalid history prevented bounded source sampling'}","if ($history.collectedAtUtc -isnot [DateTime]) {throw 'invalid history was not replaced with valid timestamp'}"].join('\n').replace('RECORDER_FILE_PATH', ". '" + file + "'");
  const result = spawnSync('powershell.exe',
    ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 20000, windowsHide: true });
  assert.equal(result.status, 0, [result.error?.message, result.stdout, result.stderr].filter(Boolean).join('\n'));
});
