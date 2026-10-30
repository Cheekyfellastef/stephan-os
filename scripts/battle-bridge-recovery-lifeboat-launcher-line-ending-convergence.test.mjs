import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const installerUrl = new URL('./windows/install-battle-bridge-recovery-lifeboat-v1.ps1', import.meta.url);

async function source() {
  return readFile(installerUrl, 'utf8');
}

function boundedBlock(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  assert.ok(end > start, `missing end marker after: ${startMarker}`);
  return text.slice(start, end);
}

test('launcher equivalence normalizes CRLF bytes only and keeps a cryptographic comparison', async () => {
  const text = await source();
  const helper = boundedBlock(
    text,
    'function Get-CrLfNormalizedSha256([string]$Path) {',
    '\nfunction Write-AtomicJson',
  );

  assert.match(helper, /\[System\.IO\.File\]::ReadAllBytes\(\$Path\)/);
  assert.match(helper, /\$bytes\[\$index\]\s*-eq\s*13/);
  assert.match(helper, /\$bytes\[\$index \+ 1\]\s*-eq\s*10/);
  assert.match(helper, /\$normalized\.Add\(\[byte\]10\)/);
  assert.match(helper, /SHA256\]::Create\(\)/);
  assert.match(helper, /ComputeHash\(\$normalized\.ToArray\(\)\)/);

  assert.doesNotMatch(helper, /ReadAllText|Get-Content|Trim\(|ToLowerInvariant\(\).*ReadAllText/);
  assert.doesNotMatch(helper, /Replace\([^\n]*\\r|Regex|UTF8\.GetBytes/);
});

test('active PowerShell launcher converges only after normalized equivalence and then re-proves exact bytes', async () => {
  const text = await source();
  const block = boundedBlock(
    text,
    'if (Test-Path -LiteralPath $installedLauncher -PathType Leaf) {',
    '\n\nif (Test-Path -LiteralPath $installedWindowlessLauncher -PathType Leaf) {',
  );

  const normalizedGate = block.indexOf('(Get-CrLfNormalizedSha256 $installedLauncher) -ne (Get-CrLfNormalizedSha256 $sourceLauncher)');
  const mismatchThrow = block.indexOf("throw 'Installed immutable lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.'", normalizedGate);
  const copy = block.indexOf('Copy-Item -LiteralPath $sourceLauncher -Destination $installedLauncher -Force');
  const exactReproof = block.lastIndexOf('(Get-Sha256 $installedLauncher) -ne $sourceLauncherSha256');

  assert.ok(normalizedGate >= 0, 'normalized-equivalence gate must exist');
  assert.ok(mismatchThrow > normalizedGate, 'non-equivalent installed bytes must fail closed');
  assert.ok(copy > mismatchThrow, 'copy must be unreachable for non-equivalent bytes');
  assert.ok(exactReproof > copy, 'exact reviewed bytes must be re-proved after convergence');
  assert.match(block, /ShouldProcess\(\$installedLauncher, 'Converge line-ending-equivalent immutable lifeboat active-bank launcher to exact reviewed source bytes'\)/);
  assert.equal((block.match(/Copy-Item -LiteralPath \$sourceLauncher -Destination \$installedLauncher -Force/g) || []).length, 1);
});

test('windowless launcher uses the same bounded equivalence, exact-copy and exact-reproof contract', async () => {
  const text = await source();
  const block = boundedBlock(
    text,
    'if (Test-Path -LiteralPath $installedWindowlessLauncher -PathType Leaf) {',
    '\n$windowlessLauncherSha256 = Get-Sha256 $installedWindowlessLauncher',
  );

  const normalizedGate = block.indexOf('(Get-CrLfNormalizedSha256 $installedWindowlessLauncher) -ne (Get-CrLfNormalizedSha256 $sourceWindowlessLauncher)');
  const mismatchThrow = block.indexOf("throw 'Installed immutable windowless lifeboat launcher differs from reviewed source. Refusing silent launcher replacement.'", normalizedGate);
  const copy = block.indexOf('Copy-Item -LiteralPath $sourceWindowlessLauncher -Destination $installedWindowlessLauncher -Force');
  const exactReproof = block.lastIndexOf('(Get-Sha256 $installedWindowlessLauncher) -ne $sourceWindowlessLauncherSha256');

  assert.ok(normalizedGate >= 0, 'normalized-equivalence gate must exist');
  assert.ok(mismatchThrow > normalizedGate, 'non-equivalent installed VBS bytes must fail closed');
  assert.ok(copy > mismatchThrow, 'VBS copy must be unreachable for non-equivalent bytes');
  assert.ok(exactReproof > copy, 'exact reviewed VBS bytes must be re-proved after convergence');
  assert.match(block, /ShouldProcess\(\$installedWindowlessLauncher, 'Converge line-ending-equivalent immutable windowless lifeboat launcher to exact reviewed source bytes'\)/);
  assert.equal((block.match(/Copy-Item -LiteralPath \$sourceWindowlessLauncher -Destination \$installedWindowlessLauncher -Force/g) || []).length, 1);
});

test('repair does not widen recovery authority or silently normalize arbitrary installed content', async () => {
  const text = await source();

  assert.doesNotMatch(text, /Invoke-Expression|Start-Process|cmd\.exe|powershell\.exe\s+-Command/);
  assert.doesNotMatch(text, /Set-Content -LiteralPath \$installedLauncher|Set-Content -LiteralPath \$installedWindowlessLauncher/);
  assert.doesNotMatch(text, /Move-Item -LiteralPath \$sourceLauncher|Move-Item -LiteralPath \$sourceWindowlessLauncher/);
  assert.match(text, /activeBankOverwriteAllowed = \$false/);
  assert.match(text, /arbitraryPathAllowed = \$false/);
  assert.match(text, /arbitraryExecutableAllowed = \$false/);
  assert.match(text, /arbitraryShellAllowed = \$false/);
  assert.match(text, /gitMutationAllowed = \$false/);
  assert.match(text, /sourceMutationAllowed = \$false/);
  assert.match(text, /pcRestartAllowed = \$false/);
});
