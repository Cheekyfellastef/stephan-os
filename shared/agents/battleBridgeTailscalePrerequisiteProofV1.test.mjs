import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG,
  BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_MARKER,
  BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_OPERATION,
  BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_SCHEMA,
  BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_VERDICT,
  buildBattleBridgeTailscalePrerequisiteReceipt,
  buildBattleBridgeTailscalePrerequisiteSettingsProof,
  buildFixedBattleBridgePrerequisiteProbeEncodedCommand,
  buildFixedBattleBridgePrerequisiteProbePowerShell,
  extractBattleBridgeTailscalePrerequisiteCheck,
  isBattleBridgeTailscaleOnlyHost,
  validateBattleBridgeTailscalePrerequisiteCheck,
  validateBattleBridgeTailscalePrerequisiteRemoteReceipt,
  validateBattleBridgeTailscalePrerequisiteSettingsProof,
} from './battleBridgeTailscalePrerequisiteProofV1.mjs';

const HEAD = 'a'.repeat(40);
const OLD_HEAD = 'b'.repeat(40);
const NOW = new Date('2026-08-07T13:45:00.000Z');

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_SCHEMA,
    requestId: 'tailscale-prerequisite-72d4e79-20260807T1345Z',
    operation: BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    expectedHead: HEAD,
    expiresAt: '2026-08-07T14:00:00.000Z',
    ...overrides,
  };
}

function body(value = command()) {
  return `\`\`\`${BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_MARKER}\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

test('read-only prerequisite request is owner-authored, exact-head bound and Codex-free', () => {
  const extracted = extractBattleBridgeTailscalePrerequisiteCheck(body());
  assert.equal(extracted.ok, true);
  const result = validateBattleBridgeTailscalePrerequisiteCheck(extracted.command, {
    authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: HEAD,
  });
  assert.equal(result.ok, true);
  assert.equal(result.request.operation, 'CHECK_BOOTSTRAP_PREREQUISITES');
  assert.equal(result.readOnly, true);
  assert.equal(result.mutationPerformed, false);
  assert.equal(result.codexRequired, false);
  assert.equal(BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG, 'tag:stephanos-github-recovery');
});

test('prerequisite request fails closed on foreign author, stale head, long expiry and extra fields', () => {
  const fixtures = [
    [command(), { authorLogin: 'other', issueNumber: 1507, now: NOW, currentMainHead: HEAD }, 'TAILSCALE_BOOTSTRAP_PREREQUISITE_AUTHOR_NOT_ALLOWED'],
    [command(), { authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: OLD_HEAD }, 'TAILSCALE_BOOTSTRAP_PREREQUISITE_MAIN_HEAD_MISMATCH'],
    [command({ expiresAt: '2026-08-07T15:00:00.000Z' }), { authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: HEAD }, 'TAILSCALE_BOOTSTRAP_PREREQUISITE_EXPIRY_TOO_FAR_AHEAD'],
    [{ ...command(), command: 'whoami' }, { authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: HEAD }, 'TAILSCALE_BOOTSTRAP_PREREQUISITE_FIELDS_NOT_EXACT'],
  ];
  for (const [value, options, blocker] of fixtures) {
    const result = validateBattleBridgeTailscalePrerequisiteCheck(value, options);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, blocker);
  }
});

test('settings proof contains booleans and names only, never secret values', () => {
  const sentinels = ['CLIENT-SENTINEL', 'AUDIENCE-SENTINEL', 'PRIVATE-KEY-SENTINEL', 'KNOWN-HOSTS-SENTINEL'];
  const proof = buildBattleBridgeTailscalePrerequisiteSettingsProof(HEAD, {
    tsOauthClientId: sentinels[0], tsAudience: sentinels[1], sshPrivateKey: sentinels[2], sshKnownHosts: sentinels[3],
    bootstrapHost: 'battle-bridge.tail123.ts.net', bootstrapUser: 'Stephan Callear',
  });
  assert.equal(proof.ready, true);
  assert.equal(proof.secretValuesExposed, false);
  assert.equal(validateBattleBridgeTailscalePrerequisiteSettingsProof(proof, HEAD), true);
  const serialized = JSON.stringify(proof);
  for (const sentinel of sentinels) assert.equal(serialized.includes(sentinel), false);
});

test('Tailscale target is constrained to CGNAT or ts.net only', () => {
  assert.equal(isBattleBridgeTailscaleOnlyHost('100.64.0.1'), true);
  assert.equal(isBattleBridgeTailscaleOnlyHost('100.127.255.254'), true);
  assert.equal(isBattleBridgeTailscaleOnlyHost('battle-bridge.tail123.ts.net'), true);
  for (const invalid of ['100.128.0.1', '192.168.1.2', '127.0.0.1', 'example.com', 'battle-bridge.local']) {
    assert.equal(isBattleBridgeTailscaleOnlyHost(invalid), false);
  }
  const blocked = buildBattleBridgeTailscalePrerequisiteSettingsProof(HEAD, {
    tsOauthClientId: 'x', tsAudience: 'x', sshPrivateKey: 'x', sshKnownHosts: 'x',
    bootstrapHost: 'example.com', bootstrapUser: 'Stephan Callear',
  });
  assert.equal(blocked.ready, false);
  assert.deepEqual(blocked.invalid, ['STEPHANOS_BATTLE_BRIDGE_TAILSCALE_HOST_NOT_TAILSCALE_ONLY']);
});

test('fixed remote prerequisite PowerShell is read-only', () => {
  const source = buildFixedBattleBridgePrerequisiteProbePowerShell(HEAD);
  assert.match(source, /install-battle-bridge-github-sync\.ps1/);
  assert.match(source, /status-battle-bridge-github-sync\.ps1/);
  assert.ok(source.includes(String.raw`C:\Program Files\Git\cmd\git.exe`));
  assert.ok(source.includes(String.raw`C:\Program Files\Tailscale\tailscale.exe`));
  assert.match(source, /status --json/);
  assert.match(source, /sshAuthenticated = \$true/);
  assert.match(source, /mutationPerformed = \$false/);
  assert.doesNotMatch(source, /-StartNow|Start-ScheduledTask|Set-Service|Start-Service|Restart-Service/i);
  assert.doesNotMatch(source, /reset --hard|git clean|git stash|git rebase|git push|Restart-Computer|Stop-Computer|Invoke-Expression/i);
  assert.match(buildFixedBattleBridgePrerequisiteProbeEncodedCommand(HEAD), /^[A-Za-z0-9+/=]+$/);
});

test('final prerequisite receipt requires redacted settings and authenticated remote proof', () => {
  const settings = buildBattleBridgeTailscalePrerequisiteSettingsProof(HEAD, {
    tsOauthClientId: 'x', tsAudience: 'x', sshPrivateKey: 'x', sshKnownHosts: 'x',
    bootstrapHost: '100.75.10.20', bootstrapUser: 'Stephan Callear',
  });
  const remote = {
    schemaVersion: 'stephanos.battle-bridge-tailscale-bootstrap-prerequisite-remote-receipt.v1',
    repository: 'Cheekyfellastef/stephan-os', expectedHead: HEAD, observedHead: OLD_HEAD,
    sshAuthenticated: true, tailscaleClientPresent: true, tailscaleConnected: true,
    canonicalRepoPresent: true, canonicalGitPresent: true, installerPresent: true, statusScriptPresent: true,
    codexRequired: false, mutationPerformed: false, arbitraryCommandAllowed: false,
    sourceMutationAllowed: false, destructiveGitAllowed: false, pcRestartAllowed: false,
    finalVerdict: 'BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_PREREQUISITE_REMOTE_READY',
  };
  assert.equal(validateBattleBridgeTailscalePrerequisiteRemoteReceipt(remote, HEAD), true);
  const receipt = buildBattleBridgeTailscalePrerequisiteReceipt(settings, remote, HEAD);
  assert.equal(receipt.ok, true);
  assert.equal(receipt.observedHead, OLD_HEAD);
  assert.equal(receipt.tailscaleTcp22PathReady, true);
  assert.equal(receipt.mutationPerformed, false);
  assert.equal(receipt.finalVerdict, BATTLE_BRIDGE_TAILSCALE_PREREQUISITE_VERDICT);
  assert.equal(buildBattleBridgeTailscalePrerequisiteReceipt(settings, { ...remote, sshAuthenticated: false }, HEAD).ok, false);
});
