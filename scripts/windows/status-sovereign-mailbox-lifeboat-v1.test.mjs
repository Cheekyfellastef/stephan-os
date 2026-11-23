import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('./status-battle-bridge-recovery-mesh.ps1', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../../shared/agents/sovereignCommanderV1.mjs', import.meta.url), 'utf8');
const remote = readFileSync(new URL('../../shared/agents/sovereignCommanderRemoteMailboxV1.mjs', import.meta.url), 'utf8');
const privateMcp = readFileSync(new URL('../sovereign-commander-mcp.mjs', import.meta.url), 'utf8');

test('fixed recovery mesh script now includes bounded mailbox and Lifeboat observation', () => {
  assert.match(script, /'Stephanos Battle Bridge GitHub Command Mailbox'/);
  assert.match(script, /'Stephanos Battle Bridge Recovery Lifeboat'/);
  assert.match(script, /receipt-publication-deferred-v1\.json\.lock-v1\.json/);
  assert.match(script, /mobile-recovery-current\.json/);
  assert.match(script, /bank-\$bankId-heartbeat\.json/);
  assert.match(script, /\$file\.Length -gt 65536/);
  assert.match(script, /ReparsePoint/);
  assert.match(script, /PRESENT_OWNER_UNVERIFIED/);
  assert.match(script, /mailboxGuardOwnerProven = \$false/);
  assert.match(script, /nativeMailboxIngressProven = \$false/);
  assert.match(script, /mailboxCutoverProven = \$false/);
  assert.match(script, /maximumConcurrentExecutors = 1/);
});

test('read-only inspector preserves the original recovery mesh contract and has no mutators', () => {
  assert.match(script, /schemaVersion = 'stephanos\.battle-bridge-recovery-mesh-status\.v1'/);
  assert.match(script, /\[CmdletBinding\(\)\]\s*param\(\)/);
  for (const forbidden of [
    /\bStart-ScheduledTask\b/i, /\bStop-ScheduledTask\b/i,
    /\bRegister-ScheduledTask\b/i, /\bUnregister-ScheduledTask\b/i,
    /\bRemove-Item\b/i, /\bMove-Item\b/i, /\bSet-Content\b/i,
    /\bStart-Process\b/i, /\bInvoke-Expression\b/i,
    /\bInvoke-WebRequest\b/i, /\bInvoke-RestMethod\b/i,
  ]) assert.doesNotMatch(script, forbidden);
});

test('new fixed Commander action maps to already captured trusted recovery mesh bytes', () => {
  const verb = 'status-sovereign-mailbox-lifeboat';
  const occurrences = text => text.split("'"+verb+"'").length - 1;
  assert.equal(occurrences(registry), 1);
  assert.equal(occurrences(remote), 1);
  assert.ok(occurrences(privateMcp) >= 2);
  assert.match(registry, /psFile\('status-battle-bridge-recovery-mesh\.ps1'\)/);
  assert.match(registry, /'status-sovereign-mailbox-lifeboat': frozen\(\{[\s\S]*?timeoutMs: 15_000/);
  assert.match(privateMcp, /SOVEREIGN_COMMANDER_INSPECTION_ACTIONS[\s\S]*?'status-sovereign-mailbox-lifeboat'/);
});

test('new observation never grants task start, lock mutation, merge or reboot', () => {
  assert.match(script, /readOnly = \$true/);
  assert.match(script, /taskStartAllowed = \$false/);
  assert.match(script, /guardLockMutationAllowed = \$false/);
  assert.match(script, /sourceMutationAllowed = \$false/);
  assert.match(script, /pcRestartAllowed = \$false/);
  assert.match(script, /nativeMailboxIngressProven = \$false/);
});
