import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OPENCLAW_PRESERVATION_CLASS,
  OPENCLAW_UPDATE_PREFLIGHT_STATUS,
  buildOpenClawUpdatePreflightV1,
  classifyOpenClawPreservationPath,
  renderOpenClawUpdatePreflightSummary,
} from './openClawUpdatePreflightV1.mjs';

const HEX_A = 'a'.repeat(64);
const HEX_B = 'b'.repeat(64);
const HEX_C = 'c'.repeat(64);
const HEAD = '1'.repeat(40);

function validInput(overrides = {}) {
  return {
    observedAtUtc: '2026-08-03T17:55:00Z',
    repository: 'Cheekyfellastef/stephan-os',
    sourceHead: HEAD,
    openClaw: {
      version: '2026.6.1',
      executablePath: 'C:\\Users\\Stephan\\AppData\\Roaming\\npm\\openclaw.cmd',
      executableSha256: HEX_A,
      packagePath: 'C:\\Users\\Stephan\\AppData\\Roaming\\npm\\node_modules\\openclaw',
      packageSha256: HEX_B,
      installPath: 'C:\\Users\\Stephan\\AppData\\Roaming\\npm\\node_modules\\openclaw',
      gatewayEndpoint: 'http://127.0.0.1:18789',
      startupSource: 'shared:openclaw-control-panel-start-gateway',
      startupCommand: 'openclaw gateway start --json',
    },
    updatePacket: {
      packetId: 'openclaw-2026.8.0',
      sourceId: 'official-openclaw-npm-package',
      targetVersion: '2026.8.0',
      packetSha256: HEX_C,
    },
    inventory: [
      { path: 'integrations/openclaw/stephanos-ignite-command/index.mjs', digestSha256: HEX_A, size: 1200 },
      { path: '.openclaw/openclaw.json', digestSha256: HEX_B, size: 14489 },
      { path: 'C:\\Users\\Stephan\\Documents\\Stephanos-openclaw-workspace\\receipts', kind: 'directory', digestSha256: HEX_C },
      { path: 'apps/stephanos/dist/assets/index.js', size: 5000 },
      { path: 'C:\\Users\\Stephan\\AppData\\Roaming\\npm\\node_modules\\openclaw', kind: 'package', digestSha256: HEX_B },
    ],
    ...overrides,
  };
}

test('builds a deterministic approval-required manifest without publishing absolute paths', () => {
  const first = buildOpenClawUpdatePreflightV1(validInput());
  const second = buildOpenClawUpdatePreflightV1(validInput({
    inventory: [...validInput().inventory].reverse(),
  }));

  assert.equal(first.status, OPENCLAW_UPDATE_PREFLIGHT_STATUS.APPROVAL_REQUIRED);
  assert.equal(first.blocker, null);
  assert.equal(first.safety.mutationAllowed, false);
  assert.equal(first.safety.updateAttempted, false);
  assert.equal(first.safety.absolutePathsPublished, false);
  assert.equal(first.currentOpenClaw.gatewayEndpoint, 'http://127.0.0.1:18789');
  assert.equal(first.currentOpenClaw.startupCommand, 'openclaw gateway start --json');
  assert.equal(first.preservationManifest.manifestSha256, second.preservationManifest.manifestSha256);
  assert.equal(first.preservationManifest.entries.length, 5);
  assert.equal(first.preservationManifest.counts.PRESERVE_SOURCE, 1);
  assert.equal(first.preservationManifest.counts.PRESERVE_CONFIG, 1);
  assert.equal(first.preservationManifest.counts.PRESERVE_RUNTIME, 1);
  assert.equal(first.preservationManifest.counts.REBUILDABLE_GENERATED, 1);
  assert.equal(first.preservationManifest.counts.UPDATE_TARGET, 1);

  const serialized = JSON.stringify(first);
  assert.doesNotMatch(serialized, /C:\\\\Users\\\\Stephan/i);
  assert.doesNotMatch(serialized, /AppData\\\\Roaming/i);
  assert.match(serialized, /absolute-path:[a-f0-9]{64}/);
});

test('classifies canonical OpenClaw preservation surfaces conservatively', () => {
  assert.equal(classifyOpenClawPreservationPath('plugins/openclaw/command.mjs').classification, OPENCLAW_PRESERVATION_CLASS.PRESERVE_SOURCE);
  assert.equal(classifyOpenClawPreservationPath('.openclaw/openclaw.json').classification, OPENCLAW_PRESERVATION_CLASS.PRESERVE_CONFIG);
  assert.equal(classifyOpenClawPreservationPath('memory/.dreams/events.jsonl').classification, OPENCLAW_PRESERVATION_CLASS.PRESERVE_RUNTIME);
  assert.equal(classifyOpenClawPreservationPath('apps/stephanos/dist/index.html').classification, OPENCLAW_PRESERVATION_CLASS.REBUILDABLE_GENERATED);
  assert.equal(classifyOpenClawPreservationPath('node_modules/openclaw/openclaw.mjs').classification, OPENCLAW_PRESERVATION_CLASS.UPDATE_TARGET);
  assert.equal(classifyOpenClawPreservationPath('.openclaw/sessions/current.json').classification, OPENCLAW_PRESERVATION_CLASS.MANUAL_ONLY);
  assert.equal(classifyOpenClawPreservationPath('random/private-addon.bin').classification, OPENCLAW_PRESERVATION_CLASS.APPROVAL_REQUIRED);
});

test('blocks unknown and secret-bearing inventory paths while retaining a rollback plan', () => {
  const result = buildOpenClawUpdatePreflightV1(validInput({
    inventory: [
      ...validInput().inventory,
      { path: 'random/private-addon.bin', digestSha256: HEX_A },
      { path: 'C:\\Users\\Stephan\\.openclaw\\sessions\\current.json', digestSha256: HEX_B },
    ],
  }));

  assert.equal(result.status, OPENCLAW_UPDATE_PREFLIGHT_STATUS.BLOCKED_WITH_RESTORE_PATH);
  assert.ok(result.blockers.some((blocker) => blocker.startsWith('UNCLASSIFIED_PATH:')));
  assert.ok(result.blockers.some((blocker) => blocker.startsWith('MANUAL_ONLY_PATH:')));
  assert.equal(result.rollbackPlan.length, 6);
  assert.equal(result.safety.operatorApprovalRequired, false);
  assert.doesNotMatch(JSON.stringify(result), /sessions\\\\current\.json/i);
});

test('fails closed on gateway identity drift and unpinned update packets', () => {
  const input = validInput();
  input.openClaw.gatewayEndpoint = 'http://127.0.0.1:9999';
  input.openClaw.startupCommand = 'openclaw gateway run --force';
  input.updatePacket.packetSha256 = '';

  const result = buildOpenClawUpdatePreflightV1(input);
  assert.equal(result.status, OPENCLAW_UPDATE_PREFLIGHT_STATUS.BLOCKED_WITH_RESTORE_PATH);
  assert.ok(result.blockers.includes('OPENCLAW_GATEWAY_ENDPOINT_MISMATCH'));
  assert.ok(result.blockers.includes('OPENCLAW_STARTUP_COMMAND_MISMATCH'));
  assert.ok(result.blockers.includes('UPDATE_PACKET_DIGEST_MISSING'));
  assert.equal(result.safety.servicesStopped, false);
  assert.equal(result.safety.configWritten, false);
});

test('requires digests for protected identities but not rebuildable generated output', () => {
  const result = buildOpenClawUpdatePreflightV1(validInput({
    inventory: [
      { path: 'plugins/openclaw/command.mjs', size: 42 },
      { path: 'apps/stephanos/dist/index.html', size: 55 },
    ],
  }));

  assert.equal(result.status, OPENCLAW_UPDATE_PREFLIGHT_STATUS.BLOCKED_WITH_RESTORE_PATH);
  assert.equal(result.blockers.filter((value) => value.startsWith('MISSING_DIGEST:')).length, 1);
});

test('rejects conflicting duplicate path identities with order-independent blocked evidence', () => {
  const inventory = [
    { path: 'Plugins\\OpenClaw\\command.mjs', digestSha256: HEX_A },
    { path: 'plugins/openclaw/command.mjs', digestSha256: HEX_B },
  ];
  const forward = buildOpenClawUpdatePreflightV1(validInput({ inventory }));
  const reversed = buildOpenClawUpdatePreflightV1(validInput({ inventory: [...inventory].reverse() }));

  assert.equal(forward.status, OPENCLAW_UPDATE_PREFLIGHT_STATUS.BLOCKED_WITH_RESTORE_PATH);
  assert.ok(forward.blockers.some((value) => value.startsWith('CONFLICTING_INVENTORY_IDENTITY:')));
  assert.deepEqual(forward.blockers, reversed.blockers);
  assert.equal(forward.preservationManifest.manifestSha256, reversed.preservationManifest.manifestSha256);
  assert.deepEqual(forward.preservationManifest.entries, reversed.preservationManifest.entries);
});

test('fails closed on links, malformed existence evidence, invalid sizes and stale absent digests', () => {
  const result = buildOpenClawUpdatePreflightV1(validInput({
    inventory: [
      { path: 'plugins/openclaw/link.mjs', kind: 'symlink', exists: 'yes', size: -1, digestSha256: HEX_A },
      { path: 'plugins/openclaw/absent.mjs', exists: false, digestSha256: HEX_B },
    ],
  }));

  assert.equal(result.status, OPENCLAW_UPDATE_PREFLIGHT_STATUS.BLOCKED_WITH_RESTORE_PATH);
  assert.ok(result.blockers.some((value) => value.startsWith('UNSUPPORTED_INVENTORY_KIND:')));
  assert.ok(result.blockers.some((value) => value.startsWith('INVENTORY_EXISTS_INVALID:')));
  assert.ok(result.blockers.some((value) => value.startsWith('INVENTORY_SIZE_INVALID:')));
  assert.ok(result.blockers.some((value) => value.startsWith('ABSENT_INVENTORY_DIGEST_PRESENT:')));
  assert.ok(result.preservationManifest.entries.some((entry) => entry.kind === 'unsupported' && entry.exists === null));
});

test('reports no update needed when the pinned target version already matches', () => {
  const result = buildOpenClawUpdatePreflightV1(validInput({
    updatePacket: {
      ...validInput().updatePacket,
      targetVersion: '2026.6.1',
    },
  }));

  assert.equal(result.status, OPENCLAW_UPDATE_PREFLIGHT_STATUS.NO_UPDATE_NEEDED);
  assert.equal(result.safety.operatorApprovalRequired, false);
  assert.match(result.nextAction, /No version-changing update/);
});

test('renders a compact mutation-free summary', () => {
  const result = buildOpenClawUpdatePreflightV1(validInput());
  const summary = renderOpenClawUpdatePreflightSummary(result);
  assert.match(summary, /OPENCLAW_UPDATE_PREFLIGHT=APPROVAL_REQUIRED/);
  assert.match(summary, /MUTATION_ALLOWED=NO/);
  assert.match(summary, /OPERATOR_APPROVAL_REQUIRED=YES/);
  assert.match(summary, new RegExp(`MANIFEST_SHA256=[a-f0-9]{64}`));
});
