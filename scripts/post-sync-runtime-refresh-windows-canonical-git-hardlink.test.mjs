import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const restartSource = await readFile(
  new URL('./windows/restart-approved-stephanos-runtime.ps1', import.meta.url),
  'utf8',
);

function canonicalGitGuard(source) {
  const start = source.indexOf("if (-not (Test-Path -LiteralPath $canonicalGit -PathType Leaf))");
  const end = source.indexOf("if (-not (Test-Path -LiteralPath $canonicalNode -PathType Leaf))", start);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

function canonicalNodeGuard(source) {
  const start = source.indexOf('$canonicalNodeItem = Get-Item -LiteralPath $canonicalNode -Force');
  const end = source.indexOf('$branchOutput = @(& $canonicalGit', start);
  return start >= 0 && end > start ? source.slice(start, end) : '';
}

function identityAccepted({ psIsContainer = false, linkType = '', reparsePoint = false } = {}) {
  return !psIsContainer
    && (!linkType || linkType === 'HardLink')
    && !reparsePoint;
}

test('canonical Git identity admits only an ordinary file or exact HardLink without reparse semantics', () => {
  assert.equal(identityAccepted(), true);
  assert.equal(identityAccepted({ linkType: 'HardLink' }), true);
  assert.equal(identityAccepted({ linkType: 'SymbolicLink' }), false);
  assert.equal(identityAccepted({ linkType: 'Junction' }), false);
  assert.equal(identityAccepted({ linkType: 'OtherLink' }), false);
  assert.equal(identityAccepted({ linkType: 'HardLink', reparsePoint: true }), false);
  assert.equal(identityAccepted({ psIsContainer: true, linkType: 'HardLink' }), false);
});

test('restart adapter implements the exact bounded HardLink exception and retains canonical Git path proof', () => {
  const guard = canonicalGitGuard(restartSource);
  assert.ok(guard, 'canonical Git guard must be present');
  assert.ok(restartSource.includes("$canonicalGit = 'C:\\Program Files\\Git\\cmd\\git.exe'"));
  assert.ok(guard.includes('Test-Path -LiteralPath $canonicalGit -PathType Leaf'));
  assert.ok(guard.includes('Get-Item -LiteralPath $canonicalGit -Force'));
  assert.ok(guard.includes('$canonicalGitItem.PSIsContainer'));
  assert.ok(guard.includes('$canonicalGitLinkType = [string]$canonicalGitItem.LinkType'));
  assert.ok(guard.includes('-not [string]::IsNullOrEmpty($canonicalGitLinkType)'));
  assert.ok(guard.includes("$canonicalGitLinkType -ne 'HardLink'"));
  assert.equal((guard.match(/\$canonicalGitItem\.LinkType/g) || []).length, 1);
  assert.ok(guard.includes('[System.IO.FileAttributes]::ReparsePoint'));
  assert.ok(guard.includes("Stop-WithBlocker 'CANONICAL_GIT_IDENTITY_INVALID'"));
  assert.ok(guard.includes('$resolvedCanonicalGit = [System.IO.Path]::GetFullPath($canonicalGitItem.FullName)'));
  assert.ok(guard.includes('[string]::Equals($resolvedCanonicalGit, $canonicalGit, [System.StringComparison]::OrdinalIgnoreCase)'));
  assert.ok(guard.includes("Stop-WithBlocker 'CANONICAL_GIT_PATH_MISMATCH'"));
  assert.doesNotMatch(guard, /-or\s+\$canonicalGitItem\.LinkType\s+`/);
});

test('Git executable selection remains fixed and PATH or caller-selected alternatives stay impossible', () => {
  assert.ok(restartSource.includes('& $canonicalGit -C $repoRoot symbolic-ref --quiet --short HEAD'));
  assert.ok(restartSource.includes('& $canonicalGit -C $repoRoot rev-parse --verify HEAD'));
  assert.doesNotMatch(restartSource, /Get-Command\s+(?:git|git\.exe)\b/i);
  assert.doesNotMatch(restartSource, /\$git\.Source|&\s+\$env:(?:PATH|GIT)/i);
  assert.doesNotMatch(restartSource, /\bGitExecutable\s*=\s*\$env:/i);
});

test('canonical Node identity guard remains unchanged and does not inherit the Git HardLink exception', () => {
  const guard = canonicalNodeGuard(restartSource);
  assert.ok(guard, 'canonical Node guard must be present');
  assert.ok(guard.includes('$canonicalNodeItem.LinkType'));
  assert.ok(guard.includes('[System.IO.FileAttributes]::ReparsePoint'));
  assert.ok(guard.includes("Stop-WithBlocker 'CANONICAL_NODE_IDENTITY_INVALID'"));
  assert.doesNotMatch(guard, /HardLink/);
});
