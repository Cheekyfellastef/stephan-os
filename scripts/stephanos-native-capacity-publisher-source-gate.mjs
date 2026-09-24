#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { classifyDirt } from './battle-bridge-github-sync-policy.mjs';

export const STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_SCHEMA = 'stephanos.native-capacity-publisher-source-gate.v1';
export const STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_PASS = 'STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_PASS';
export const STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_BLOCKED = 'STEPHANOS_NATIVE_PUBLISHER_SOURCE_GATE_BLOCKED';

const CANONICAL_GIT = 'C:\\Program Files\\Git\\cmd\\git.exe';
const SHA40 = /^[0-9a-f]{40}$/i;

function text(value) {
  return String(value ?? '').trim();
}

function lines(value) {
  return String(value ?? '').split(/\r?\n/).filter((line) => line.trim());
}

function run(spawnSyncFn, executable, args) {
  const result = spawnSyncFn(executable, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    timeout: 30_000,
    maxBuffer: 256 * 1024,
  });
  return Object.freeze({
    ok: !result?.error && Number(result?.status) === 0,
    stdout: String(result?.stdout || ''),
    stderr: String(result?.stderr || ''),
  });
}

export function summarizeNativePublisherDirt(statusLines = []) {
  const dirt = classifyDirt(statusLines);
  return Object.freeze({
    trackedSourceCount: dirt.trackedSource.length,
    untrackedSourceCount: dirt.untrackedSource.length,
    runtimeOnlyCount: dirt.runtimeOnly.length,
    generatedSourceCount: dirt.generatedSource.length,
    unknownCount: dirt.unknown.length,
    blocksSync: dirt.blocksSync === true,
  });
}

export function runStephanosNativeCapacityPublisherSourceGate({ env = process.env, spawnSyncFn = spawnSync } = {}) {
  const profile = text(env.USERPROFILE);
  if (!profile) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_SCHEMA,
      finalVerdict: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_BLOCKED,
      blocker: 'USERPROFILE_REQUIRED',
      exitCode: 75,
    });
  }

  const repositoryRoot = resolve(profile, 'Documents', 'GitHub', 'stephan-os');
  const branch = run(spawnSyncFn, CANONICAL_GIT, ['-C', repositoryRoot, 'branch', '--show-current']);
  const head = run(spawnSyncFn, CANONICAL_GIT, ['-C', repositoryRoot, 'rev-parse', 'HEAD']);
  const status = run(spawnSyncFn, CANONICAL_GIT, ['-C', repositoryRoot, 'status', '--porcelain=v1', '--untracked-files=all']);
  const observedBranch = text(branch.stdout);
  const observedHead = text(head.stdout).toLowerCase();

  if (!branch.ok || !head.ok || !status.ok || observedBranch !== 'main' || !SHA40.test(observedHead)) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_SCHEMA,
      finalVerdict: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_BLOCKED,
      blocker: 'SOURCE_IDENTITY_UNAVAILABLE',
      exitCode: 75,
    });
  }

  const dirtSummary = summarizeNativePublisherDirt(lines(status.stdout));
  if (dirtSummary.blocksSync) {
    return Object.freeze({
      ok: false,
      schemaVersion: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_SCHEMA,
      finalVerdict: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_BLOCKED,
      blocker: 'SOURCE_DIRT_BLOCKED',
      sourceHead: observedHead,
      dirtSummary,
      exitCode: 75,
    });
  }

  return Object.freeze({
    ok: true,
    schemaVersion: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_SCHEMA,
    finalVerdict: STEPHANOS_NATIVE_CAPACITY_PUBLISHER_SOURCE_GATE_PASS,
    blocker: '',
    sourceHead: observedHead,
    dirtSummary,
    exitCode: 0,
  });
}

export function main() {
  const result = runStephanosNativeCapacityPublisherSourceGate();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && new URL(`file://${process.argv[1].replace(/\\/g, '/')}`).pathname === new URL(import.meta.url).pathname) {
  main();
}
