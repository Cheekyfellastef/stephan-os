import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const performance = await readFile(new URL('./windows/starfield-vr-performance-mode.ps1', import.meta.url), 'utf8');
const diagnosis = await readFile(new URL('./windows/read-starfield-vr-performance-diagnosis.ps1', import.meta.url), 'utf8');
const report = await readFile(new URL('./report-starfield-vr-telemetry.mjs', import.meta.url), 'utf8');

test('Starfield VR performance telemetry captures storage pressure', () => {
  assert.match(performance, /Get-GameDriveSample/);
  assert.match(performance, /gameDriveFreeGiB/);
  assert.match(performance, /gameDriveFreePct/);
  assert.match(performance, /gameDriveActivePct/);
  assert.match(performance, /gameDriveReadMiBps/);
  assert.match(performance, /gameDriveWriteMiBps/);
  assert.match(performance, /gameDriveAvgLatencyMs/);
  assert.match(performance, /gameDriveQueueLength/);
  assert.match(performance, /pagesPerSec/);
  assert.match(performance, /startGameDriveFreeGiB/);
  assert.match(performance, /endGameDriveFreeGiB/);
});

test('Starfield VR completed sessions auto-publish shared telemetry', () => {
  assert.match(performance, /report-starfield-vr-telemetry\.mjs/);
  assert.match(performance, /Get-Command node\.exe/);
  assert.match(performance, /& \$node\.Source \$telemetryReportScript/);
  assert.match(report, /segments: \['vr', 'performance', 'current\.json'\]/);
  assert.match(report, /starfield-vr-performance-current\.json/);
});

test('Starfield VR diagnosis distinguishes storage and combined pressure', () => {
  assert.match(diagnosis, /drive-space-pressure-high/);
  assert.match(diagnosis, /storage-io-pressure-high/);
  assert.match(diagnosis, /storage-source-not-yet-captured/);
  assert.match(diagnosis, /'STORAGE_PRESSURE'/);
  assert.match(diagnosis, /'MULTI_RESOURCE_PRESSURE'/);
  assert.match(diagnosis, /minGameDriveFreeGiB/);
  assert.match(diagnosis, /minGameDriveFreePct/);
  assert.match(diagnosis, /maxGameDriveLatencyMs/);
  assert.match(diagnosis, /maxGameDriveQueueLength/);
});

test('shared Starfield VR telemetry headline carries storage evidence', () => {
  assert.match(report, /minGameDriveFreeGiB/);
  assert.match(report, /minGameDriveFreePct/);
  assert.match(report, /avgGameDriveActivePct/);
  assert.match(report, /maxGameDriveLatencyMs/);
  assert.match(report, /storageTelemetryAvailable/);
});
