import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const script = readFileSync(new URL('./status-sovereign-mailbox-lifeboat-v1.ps1', import.meta.url), 'utf8');
const registry = readFileSync(new URL('../../shared/agents/sovereignCommanderV1.mjs', import.meta.url), 'utf8');
const remote = readFileSync(new URL('../../shared/agents/sovereignCommanderRemoteMailboxV1.mjs', import.meta.url), 'utf8');
const privateMcp = readFileSync(new URL('../sovereign-commander-mcp.mjs', import.meta.url), 'utf8');

test('mailbox Lifeboat inspector has zero parameters or command execution surface', () => {
  assert.match(script, /\[CmdletBinding\(\)\]\s*param\(\)/);
  assert.match(script, /SOVEREIGN_MAILBOX_STATUS_ARGUMENTS_NOT_ALLOWED/);
  for (const forbidden of [
    /\bStart-ScheduledTask\b/i, /\bStop-ScheduledTask\b/i,
    /\bRegister-ScheduledTask\b/i, /\bUnregister-ScheduledTask\b/i,
    /\bRemove-Item\b/i, /\bMove-Item\b/i, /\bSet-Content\b/i,
    /\bStart-Process\b/i, /\bInvoke-Expression\b/i,
    /\bInvoke-WebRequest\b/i, /\bInvoke-RestMethod\b/i,
  ]) assert.doesNotMatch(script, forbidden);
});

test('mailbox inspector reads only fixed native task and bounded local recovery facts', () => {
  assert.match(script, /Stephanos Battle Bridge GitHub Command Mailbox/);
  assert.match(script, /Stephanos Battle Bridge Recovery Lifeboat/);
  assert.match(script, /receipt-publication-deferred-v1\.json\.lock-v1\.json/);
  assert.match(script, /mobile-recovery-current\.json/);
  assert.match(script, /bank-\$bankId-heartbeat\.json/);
  assert.match(script, /\$info\.Length -gt 65536/);
  assert.match(script, /ReparsePoint/);
  assert.match(script, /PRESENT_OWNER_UNVERIFIED/);
  assert.match(script, /guardLockOwnerVerified = \$false/);
  assert.match(script, /nativeMailboxIngressProven = \$false/);
  assert.match(script, /mailboxCutoverProven = \$false/);
});

test('source-controlled Commander, remote action and private MCP admit exactly the fixed inspector', () => {
  const verb = 'status-sovereign-mailbox-lifeboat';
  const occurrences = text => text.split("'"+verb+"'").length - 1;
  assert.equal(occurrences(registry), 1);
  assert.equal(occurrences(remote), 1);
  assert.ok(occurrences(privateMcp) >= 3);
  assert.match(registry, /psFile\('status-sovereign-mailbox-lifeboat-v1\.ps1'\)/);
  assert.match(registry, /'status-sovereign-mailbox-lifeboat': frozen\(\{[\s\S]*?timeoutMs: 15_000/);
  assert.match(privateMcp, /SOVEREIGN_COMMANDER_INSPECTION_ACTIONS[\s\S]*?'status-sovereign-mailbox-lifeboat'/);
});

test('the inspector does not issue recovery, merge, credential or reboot authority', () => {
  for (const property of [
    'readOnly', 'taskStartAllowed', 'guardLockMutationAllowed',
    'sourceMutationAllowed', 'gitMutationAllowed', 'mergeAuthority', 'pcRestartAllowed',
  ]) assert.match(script, new RegExp(property+'\\s*=\\s*\\$false|'+property+'\\s*=\\s*\\$true'));
  assert.match(script, /taskStartAllowed = \$false/);
  assert.match(script, /sourceMutationAllowed = \$false/);
  assert.match(script, /mergeAuthority = \$false/);
  assert.match(script, /pcRestartAllowed = \$false/);
});
