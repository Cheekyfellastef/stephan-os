import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createLauncherReadinessReport, assertSafeDescriptiveCommand, main } from './launcher-readiness-report.mjs';

const allReady = { backend: true, 'stephanos-ui': true, 'openclaw-gateway': true, 'shared-workspace': true };

function reportFor(facts) {
  return createLauncherReadinessReport(facts);
}

test('backend and OpenClaw but missing UI returns PARTIAL_UI_MISSING with exact next operator action', () => {
  const report = reportFor({ observedFacts: { services: { backend: true, 'openclaw-gateway': true, 'shared-workspace': true } } });
  assert.equal(report.status, 'PARTIAL_UI_MISSING');
  assert.equal(report.verdict, 'partial-ui-missing');
  assert.match(report.nextOperatorAction, /Stephanos UI 4173/);
  assert.match(report.nextOperatorAction, /rerun npm run ignition:readiness/);
});

test('stale workspace returns STALE_WORKSPACE', () => {
  const report = reportFor({ observedFacts: { services: allReady, staleWorkspaceRecords: ['workspace/status UNKNOWN'] } });
  assert.equal(report.status, 'STALE_WORKSPACE');
  assert.equal(report.safetyBlockers[0].id, 'stale-workspace-records');
});

test('all services ready returns READY', () => {
  assert.equal(reportFor({ observedFacts: { services: allReady } }).status, 'READY');
});

test('dirty source facts block repair', () => {
  const report = reportFor({ observedFacts: { services: allReady }, sourceFacts: { dirtyPaths: ['scripts/launcher-readiness-report.mjs'] } });
  assert.equal(report.status, 'BLOCKED_DIRTY_SOURCE');
});

test('runtime-only dirt is caveat', () => {
  const report = reportFor({ observedFacts: { services: allReady }, sourceFacts: { dirtyPaths: ['runtime-activity/shared-workspace/current/status.json'] } });
  assert.equal(report.status, 'READY');
  assert.equal(report.caveats[0].id, 'runtime-only-dirt');
});

test('unsafe command text is rejected', () => {
  assert.throws(() => assertSafeDescriptiveCommand('git push origin HEAD'), /Unsafe proof command text rejected/);
  assert.equal(reportFor({ observedFacts: { services: allReady }, requestedStartCommand: 'npm run dev' }).status, 'BLOCKED_NEEDS_SUPERVISOR_REPAIR');
});

test('no start kill shell merge or push authority is exposed', () => {
  const report = reportFor({ observedFacts: { services: allReady } });
  assert.deepEqual(report.authority, {
    executesCommands: false,
    startsServices: false,
    killsProcesses: false,
    mergesOrPushes: false,
    mutatesRuntime: false,
  });
  const commands = report.proofCommands.map((proof) => proof.command).join('\n');
  assert.doesNotMatch(commands, /\b(?:kill|taskkill|git\s+(?:merge|push)|npm\s+run\s+dev|Start-Process)\b/i);
});

test('CLI wrapper reads facts from a temp fixture and emits deterministic JSON', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-readiness-'));
  const fixture = path.join(dir, 'facts.json');
  fs.writeFileSync(fixture, JSON.stringify({ observedFacts: { services: allReady } }));
  let output = '';
  const code = main(['--facts', fixture, '--json'], { write: (chunk) => { output += chunk; } });
  assert.equal(code, 0);
  const parsed = JSON.parse(output);
  assert.equal(parsed.status, 'READY');
  assert.equal(parsed.proofCommands.length, 4);
});

test('--facts-file valid JSON returns PARTIAL_UI_MISSING for backend OpenClaw workspace with missing UI', () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-launcher-readiness-'));
  const fixture = path.join(dir, 'ignition-facts.json');
  fs.writeFileSync(fixture, JSON.stringify({ observedFacts: { services: { backend: true, 'openclaw-gateway': true, 'shared-workspace': true } } }));
  let output = '';
  try {
    const relativeFixture = path.relative(process.cwd(), fixture);
    const code = main(['--facts-file', relativeFixture, '--json'], { write: (chunk) => { output += chunk; } });
    assert.equal(code, 0);
    const parsed = JSON.parse(output);
    assert.equal(parsed.status, 'PARTIAL_UI_MISSING');
    assert.equal(parsed.verdict, 'partial-ui-missing');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('--facts inline JSON still works', () => {
  let output = '';
  const code = main(['--facts', JSON.stringify({ observedFacts: { services: allReady } }), '--json'], { write: (chunk) => { output += chunk; } });
  assert.equal(code, 0);
  assert.equal(JSON.parse(output).status, 'READY');
});

test('both --facts and --facts-file are blocked with deterministic usage error', () => {
  assert.throws(
    () => main(['--facts', '{}', '--facts-file', '.\\ignition-facts.json', '--json'], { write: () => {} }),
    /Usage error: supply either --facts or --facts-file, not both\./,
  );
});

test('missing --facts-file is blocked with deterministic error', () => {
  assert.throws(
    () => main(['--facts-file', '.\\missing-ignition-facts.json', '--json'], { write: () => {} }),
    /Facts file not found: \.\\missing-ignition-facts\.json/,
  );
});

test('invalid --facts-file JSON is blocked with deterministic error', () => {
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-launcher-readiness-'));
  const fixture = path.join(dir, 'invalid.json');
  fs.writeFileSync(fixture, '{not-json');
  try {
    const relativeFixture = path.relative(process.cwd(), fixture);
    assert.throws(
      () => main(['--facts-file', relativeFixture, '--json'], { write: () => {} }),
      new RegExp(`Invalid JSON in --facts-file ${relativeFixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('unsafe traversal --facts-file path is blocked with deterministic error', () => {
  assert.throws(
    () => main(['--facts-file', '../ignition-facts.json', '--json'], { write: () => {} }),
    /Unsafe --facts-file path rejected: path must stay within the current workspace\./,
  );
});
