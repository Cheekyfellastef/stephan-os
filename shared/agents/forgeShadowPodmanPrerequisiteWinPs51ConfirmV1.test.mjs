import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const adapterSource = readFileSync(new URL('./forgeShadowBattleBridgeAdapterV1.mjs', import.meta.url), 'utf8');
const prerequisiteSource = readFileSync(
  new URL('../../scripts/windows/install-forge-shadow-podman-prerequisite-v1.ps1', import.meta.url),
  'utf8',
);

test('prerequisite launch remains fixed -File Windows PowerShell 5.1 compatible', () => {
  const start = adapterSource.indexOf('if (normalized.prerequisiteOnly)');
  const end = adapterSource.indexOf("return fail('FORGE_SHADOW_PODMAN_PREREQUISITE_RECEIPT_TOO_LARGE')", start);
  assert.ok(start >= 0 && end > start);
  const launch = adapterSource.slice(start, end);

  assert.match(launch, /BATTLE_BRIDGE_WINDOWS_HOST\.powershell/);
  assert.match(launch, /'-File', installerPath/);
  assert.match(launch, /'-ExpectedHead', normalized\.expectedHead/);
  assert.match(launch, /'-OperatorApproved'/);
  assert.doesNotMatch(launch, /-Confirm:\$false/);
  assert.doesNotMatch(launch, /'-Command'|'-EncodedCommand'/);
});

test('prerequisite confirmation suppression is admitted only after exact operator approval', () => {
  const approvalGate = "if (-not $OperatorApproved -and -not $WhatIfPreference) { Emit-Blocked 'EXACT_RUNTIME_OPERATOR_APPROVAL_REQUIRED' }";
  const confirmationGate = "if ($OperatorApproved -and -not $WhatIfPreference) { $ConfirmPreference = 'None' }";
  const approvalIndex = prerequisiteSource.indexOf(approvalGate);
  const confirmationIndex = prerequisiteSource.indexOf(confirmationGate);
  const shouldProcessIndex = prerequisiteSource.indexOf("$PSCmdlet.ShouldProcess($PodmanUserExe, 'Install fixed user-scoped Podman 6.0.2 prerequisite')");

  assert.ok(approvalIndex >= 0);
  assert.ok(confirmationIndex > approvalIndex);
  assert.ok(shouldProcessIndex > confirmationIndex);
  assert.match(prerequisiteSource, /if \(\$WhatIfPreference\) \{/);
  assert.match(prerequisiteSource, /\[CmdletBinding\(SupportsShouldProcess = \$true, ConfirmImpact = 'High'\)\]/);
  assert.doesNotMatch(prerequisiteSource.slice(0, approvalIndex), /\$ConfirmPreference\s*=\s*'None'/);
});
