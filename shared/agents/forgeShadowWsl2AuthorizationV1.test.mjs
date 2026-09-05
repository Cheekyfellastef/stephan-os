import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  FORGE_WSL2_AUTHORIZED_REQUEST_IDS_V1,
  forgeShadowBattleBridgeFields,
  validateForgeShadowBattleBridgeCommand,
} from './forgeShadowBattleBridgeAdapterV1.mjs';

const source = readFileSync(new URL('./forgeShadowBattleBridgeAdapterV1.mjs', import.meta.url), 'utf8');
const wslScript = readFileSync(new URL('../../scripts/windows/enable-forge-wsl2-prerequisite-v1.ps1', import.meta.url), 'utf8');
const HEAD = 'a'.repeat(40);

function command(overrides = {}) {
  return {
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    requestId: 'ordinary-forge-prerequisite-request',
    operation: 'INSTALL_FORGE_SHADOW_M2',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: 1507,
    branch: 'main',
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    forgejoVersion: '15.0.6',
    forgejoImageDigest: '',
    runtimeBoundary: 'podman-wsl-rootless',
    m2Only: true,
    expiresAt: '2026-09-05T18:00:00.000Z',
    ...overrides,
  };
}

test('keeps the existing Forge command schema unchanged', () => {
  assert.deepEqual(forgeShadowBattleBridgeFields(), [
    'forgejoVersion',
    'forgejoImageDigest',
    'runtimeBoundary',
    'm2Only',
  ]);
  const result = validateForgeShadowBattleBridgeCommand(command());
  assert.equal(result.ok, true);
  assert.equal(Object.hasOwn(result.command, 'wsl2PrerequisiteAuthorized'), false);
});

test('binds WSL2 mutation authority to exactly two fixed one-use request identities', () => {
  assert.deepEqual(FORGE_WSL2_AUTHORIZED_REQUEST_IDS_V1, [
    'forge-wsl2-enable-authorized-20260905-v1',
    'forge-wsl2-postreboot-authorized-20260905-v1',
  ]);
  assert.match(source, /AUTHORIZED_REQUEST_IDS\.has\(String\(normalized\.requestId \|\| ''\)\)/);
  assert.doesNotMatch(source, /wsl2PrerequisiteAuthorized/);
  assert.match(source, /initial\?\.blocker !== 'WSL2_NOT_AVAILABLE'/);
  assert.match(source, /normalized\.prerequisiteOnly !== true/);
});

test('ordinary Forge prerequisite commands cannot enter the WSL2 elevation rung', () => {
  const ordinary = command();
  assert.equal(FORGE_WSL2_AUTHORIZED_REQUEST_IDS_V1.includes(ordinary.requestId), false);
  for (const requestId of FORGE_WSL2_AUTHORIZED_REQUEST_IDS_V1) {
    const authorized = validateForgeShadowBattleBridgeCommand(command({ requestId }));
    assert.equal(authorized.ok, true);
    assert.equal(authorized.command.prerequisiteOnly, true);
  }
});

test('WSL2 source route is fixed, source-bound, typed and explicitly non-rebooting', () => {
  assert.match(source, /scripts\/windows\/enable-forge-wsl2-prerequisite-v1\.ps1/);
  assert.match(source, /workingBlob === identity\.committedBlob/);
  assert.match(source, /receipt\.rebootPerformed !== false/);
  assert.match(source, /FORGE_WSL2_REBOOT_REQUIRED/);
  assert.match(wslScript, /Microsoft-Windows-Subsystem-Linux/);
  assert.match(wslScript, /VirtualMachinePlatform/);
  assert.match(wslScript, /rebootPerformed = \$false/);
  assert.match(wslScript, /podmanMutation = \$false/);
  assert.match(wslScript, /forgeRuntimeMutation = \$false/);
  assert.match(wslScript, /sourceMutation = \$false/);
  assert.doesNotMatch(wslScript, /Restart-Computer|shutdown\.exe/i);
});

test('WSL2 wrapper grants no generic command, credential or provider surface', () => {
  for (const forbidden of [
    /Invoke-Expression/i,
    /child_process[^\n]*exec\b/i,
    /credential/i,
    /token/i,
    /providerChangeAllowed\s*[:=]\s*true/i,
    /mergeAuthority\s*[:=]\s*true/i,
  ]) {
    assert.doesNotMatch(source, forbidden);
  }
});
