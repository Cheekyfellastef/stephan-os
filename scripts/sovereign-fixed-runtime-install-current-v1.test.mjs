import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  observeCurrentFixedRuntimeInstallationV1,
  observeCurrentFixedRuntimeQualificationV1,
} from './sovereign-fixed-runtime-install-current-v1.mjs';

const HEAD = 'a'.repeat(40);
const HASH = 'b'.repeat(64);

test('current fixed runtime commissioning distinguishes missing present restart-required and qualified', () => {
  const missing = observeCurrentFixedRuntimeInstallationV1(HEAD, {
    platform: 'win32',
    inspectPresence: () => ({ ok: false, reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING' }),
  });
  assert.deepEqual(missing, {
    ok: true, state: 'MISSING', reason: 'FIXED_RUNTIME_CURRENT_INSTALLATION_MISSING',
    installed: false, sourceHead: HEAD,
  });

  const present = observeCurrentFixedRuntimeInstallationV1(HEAD, {
    platform: 'win32',
    inspectPresence: () => ({
      ok: true, installed: true, sourceHead: HEAD,
      helperSha256: HASH, manifestSha256: 'c'.repeat(64),
    }),
  });
  assert.equal(present.ok, true);
  assert.equal(present.state, 'PRESENT');
  assert.equal(present.installed, true);

  const restart = observeCurrentFixedRuntimeQualificationV1(HEAD, {
    platform: 'win32',
    inspectQualification: () => ({ ok: false, reason: 'RUNTIME_PENDING_LATER_BOOT_UNPROVEN' }),
  });
  assert.deepEqual(restart, {
    ok: true, state: 'RESTART_REQUIRED', reason: 'RUNTIME_PENDING_LATER_BOOT_UNPROVEN',
    qualified: false, sourceHead: HEAD,
  });

  const qualified = observeCurrentFixedRuntimeQualificationV1(HEAD, {
    platform: 'win32',
    inspectQualification: () => ({ ok: true, dispatchAllowed: true, sourceHead: HEAD }),
  });
  assert.deepEqual(qualified, {
    ok: true, state: 'QUALIFIED', reason: '', qualified: true, sourceHead: HEAD,
  });
});

test('fixed runtime commissioning observations fail closed on wrong identity or unrelated denial', () => {
  const wrong = observeCurrentFixedRuntimeInstallationV1(HEAD, {
    platform: 'win32',
    inspectPresence: () => ({
      ok: true, installed: true, sourceHead: 'd'.repeat(40),
      helperSha256: HASH, manifestSha256: 'c'.repeat(64),
    }),
  });
  assert.equal(wrong.ok, false);
  assert.equal(wrong.reason, 'FIXED_RUNTIME_PENDING_IDENTITY_UNPROVEN');

  const blocked = observeCurrentFixedRuntimeQualificationV1(HEAD, {
    platform: 'win32',
    inspectQualification: () => ({ ok: false, reason: 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD' }),
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.state, 'BLOCKED');
  assert.equal(blocked.reason, 'FIXED_RUNTIME_RESOURCE_GOVERNOR_HOLD');

  assert.equal(observeCurrentFixedRuntimeQualificationV1('bad', {
    platform: 'win32', inspectQualification: () => ({ ok: true }),
  }).reason, 'FIXED_RUNTIME_SOURCE_HEAD_UNPROVEN');
});

test('current-main preparer remains fixed-path and cannot become arbitrary installer transport', async () => {
  const source = await readFile(new URL('./sovereign-fixed-runtime-install-current-v1.mjs', import.meta.url), 'utf8');
  assert.match(source, /C:\\\\Users\\\\Stephan Callear\\\\Documents\\\\GitHub\\\\stephan-os/);
  assert.match(source, /C:\\\\Program Files\\\\Git\\\\cmd\\\\git\.exe/);
  assert.match(source, /C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1\.0\\\\powershell\.exe/);
  assert.match(source, /FIXED_RUNTIME_SOURCE_PATHS_V1/);
  assert.match(source, /buildFixedRuntimeInstallerCandidateV1/);
  assert.match(source, /rev-parse', expectedMain \+ ':' \+ relative/);
  assert.match(source, /cat-file', 'blob', blobSha/);
  assert.match(source, /FIXED_RUNTIME_INSTALL_SOURCE_MATERIALIZATION_CHANGED/);
  assert.match(source, /writeFileFn\(candidate\.payloadPath, payload, \{ flag: 'wx', mode: 0o600 \}\)/);
  assert.match(source, /args\.length === 3/);
  assert.match(source, /\['status'|'qualification'|'prepare'\]/, 'mode vocabulary should stay visible in source');
  assert.doesNotMatch(source, /cmd\.exe|Invoke-Expression|Restart-Computer|Stop-Computer|shutdown\.exe|git\s+reset|git\s+clean|git\s+push/i);
});

test('elevated broker uses one fixed UAC command and never gains restart or arbitrary shell authority', async () => {
  const source = await readFile(new URL('./windows/install-sovereign-fixed-runtime-elevated-v1.ps1', import.meta.url), 'utf8');
  assert.match(source, /\[ValidatePattern\('\^\[0-9a-f\]\{40\}\$'\)\]/);
  assert.match(source, /sovereign-fixed-runtime-install-current-v1\.mjs/);
  assert.match(source, /READY_FOR_OPERATOR_APPROVAL/);
  assert.match(source, /payloadSha256/);
  assert.match(source, /scriptSha256/);
  assert.match(source, /Start-Process[\s\S]*?-Verb RunAs[\s\S]*?-Wait -PassThru/);
  assert.match(source, /'-EncodedCommand'/);
  assert.match(source, /INSTALLED_PENDING_RESTART/);
  assert.match(source, /requiresLaterFullBoot = \$true/);
  assert.match(source, /restartPerformed = \$false/);
  assert.match(source, /arbitraryShellAllowed = \$false/);
  assert.match(source, /sourceMutationAllowed = \$false/);
  assert.match(source, /pcRestartAuthority = \$false/);
  assert.doesNotMatch(source, /Restart-Computer|Stop-Computer|shutdown\.exe|Invoke-Expression|cmd\.exe|git\s+reset|git\s+clean|git\s+push/i);
});
