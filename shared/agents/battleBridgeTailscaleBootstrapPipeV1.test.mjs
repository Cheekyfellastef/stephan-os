import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_MARKER,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_OPERATION,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_SCHEMA,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_VERDICT,
  buildFixedBattleBridgeBootstrapEncodedCommand,
  buildFixedBattleBridgeBootstrapPowerShell,
  extractBattleBridgeTailscaleBootstrap,
  validateBattleBridgeTailscaleBootstrap,
  validateBattleBridgeTailscaleBootstrapReceipt,
} from './battleBridgeTailscaleBootstrapPipeV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-08-07T13:45:00.000Z');

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_SCHEMA,
    requestId: 'tailscale-bootstrap-72d4e79-20260807T1345Z',
    operation: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-08-07T14:00:00.000Z',
    ...overrides,
  };
}

function body(value = command()) {
  return `\`\`\`${BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_MARKER}\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

test('owner-authored exact-head request is accepted and Codex is not required', () => {
  const extracted = extractBattleBridgeTailscaleBootstrap(body());
  assert.equal(extracted.ok, true);
  const result = validateBattleBridgeTailscaleBootstrap(extracted.command, {
    authorLogin: 'Cheekyfellastef',
    issueNumber: 1507,
    now: NOW,
    currentMainHead: HEAD,
  });
  assert.equal(result.ok, true);
  assert.equal(result.request.expectedHead, HEAD);
  assert.equal(result.codexRequired, false);
  assert.equal(result.arbitraryCommandAllowed, false);
  assert.equal(result.arbitraryPathAllowed, false);
  assert.equal(result.arbitraryTaskNameAllowed, false);
  assert.equal(BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG, 'tag:stephanos-github-recovery');
});

test('request rejects foreign author, issue, head, expiry and any extra authority field', () => {
  const fixtures = [
    { value: command(), options: { authorLogin: 'someone-else', issueNumber: 1507, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_AUTHOR_NOT_ALLOWED' },
    { value: command(), options: { authorLogin: 'Cheekyfellastef', issueNumber: 1508, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_ISSUE_MISMATCH' },
    { value: command(), options: { authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: 'b'.repeat(40) }, blocker: 'TAILSCALE_BOOTSTRAP_MAIN_HEAD_MISMATCH' },
    { value: command({ expiresAt: '2026-08-07T15:00:00.000Z' }), options: { authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_EXPIRY_TOO_FAR_AHEAD' },
    { value: { ...command(), command: 'whoami' }, options: { authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_FIELDS_NOT_EXACT' },
    { value: { ...command(), path: 'C:\\Windows' }, options: { authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_FIELDS_NOT_EXACT' },
  ];
  for (const fixture of fixtures) {
    const result = validateBattleBridgeTailscaleBootstrap(fixture.value, fixture.options);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, fixture.blocker);
  }
});

test('fixed remote PowerShell binds preservation and fast-forward to the approved exact head', () => {
  const source = buildFixedBattleBridgeBootstrapPowerShell(HEAD);
  assert.match(source, /battle-bridge-exact-head-preservation-sync\.mjs/);
  assert.match(source, /battle-bridge-runtime-data-v1/);
  assert.match(source, /exactHeadBound -ne \$true/);
  assert.match(source, /\$sync\.expectedHead -ne \$expectedHead/);
  assert.match(source, /\$sync\.afterHead -ne \$expectedHead/);
  assert.match(source, /preservation\.receipt\.itemCount -ne 6/);
  assert.match(source, /preservation\.receipt\.allHashesVerified -ne \$true/);
  assert.match(source, /preservation\.destructiveCleanupPerformed -ne \$false/);
  assert.ok(source.includes(String.raw`C:\Program Files\nodejs\node.exe`));
  assert.ok(source.includes(String.raw`C:\Program Files\Git\cmd\git.exe`));
  assert.match(source, /install-battle-bridge-github-sync\.ps1/);
  assert.match(source, /status-battle-bridge-github-sync\.ps1/);
  assert.match(source, /Stephanos Battle Bridge GitHub Sync/);
  assert.match(source, /-StartNow/);
  assert.match(source, new RegExp(HEAD));
  assert.match(source, /BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_READY/);
  assert.match(source, /liveOpenClawUpdateAllowed -ne \$false/);
  assert.match(source, /codexRequired = \$false/);
  assert.match(source, /try \{ \$syncOutput = @\(& \$node \$preservationSync \$expectedHead\) \} catch \{ throw 'TAILSCALE_BOOTSTRAP_PRESERVATION_SYNC_FAILED' \}/);
  assert.match(source, /try \{ \$installerOutput = @\(& \$installer -StartNow\) \} catch \{ throw 'TAILSCALE_BOOTSTRAP_SYNC_INSTALLER_FAILED' \}/);
  assert.match(source, /try \{ \$statusOutput = @\(& \$statusScript\) \} catch \{ throw 'TAILSCALE_BOOTSTRAP_SYNC_STATUS_FAILED' \}/);
  assert.doesNotMatch(source, /stephanos-codex-dispatch-mcp\.mjs|sync_codex_dispatch_bridge/);
  assert.doesNotMatch(source, /reset --hard|git clean|git stash|git rebase|git push|Restart-Computer|Stop-Computer|Invoke-Expression/i);
  assert.doesNotMatch(source, /codex\.exe|codex\.cmd|codex\s+(?:exec|run|dispatch)|openclaw-gateway|gateway\.cmd|\.openclaw/i);
  const encoded = buildFixedBattleBridgeBootstrapEncodedCommand(HEAD);
  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
  assert.ok(encoded.length > 100);
});

test('receipt validation requires preservation proof, exact head and bounded safety posture', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-tailscale-bootstrap-receipt.v1',
    repository: 'Cheekyfellastef/stephan-os',
    taskName: 'Stephanos Battle Bridge GitHub Sync',
    expectedHead: HEAD,
    observedHead: HEAD,
    taskInstalled: true,
    taskState: 'Ready',
    lastTaskResult: 0,
    preservationProfile: 'battle-bridge-runtime-data-v1',
    preservationItemCount: 6,
    preservationHashesVerified: true,
    codexRequired: false,
    arbitraryCommandAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryTaskNameAllowed: false,
    sourceMutationOutsideCanonicalSyncAllowed: false,
    destructiveGitAllowed: false,
    pcRestartAllowed: false,
    finalVerdict: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_VERDICT,
  };
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt(receipt, HEAD), true);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, observedHead: 'b'.repeat(40) }, HEAD), false);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, preservationItemCount: 5 }, HEAD), false);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, preservationHashesVerified: false }, HEAD), false);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, codexRequired: true }, HEAD), false);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, destructiveGitAllowed: true }, HEAD), false);
});
