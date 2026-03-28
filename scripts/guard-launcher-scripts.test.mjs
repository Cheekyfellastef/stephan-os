import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLauncherScriptSource } from './guard-launcher-scripts.mjs';

test('PowerShell safe interpolation with ${Label}: is allowed', () => {
  const source = 'Write-LiveLog "Opening ${Label}: $Url"\n';
  const violations = analyzeLauncherScriptSource(source, 'windows/sample.ps1');
  assert.equal(violations.length, 0);
});

test('PowerShell unsafe interpolation with $Label: is flagged', () => {
  const source = 'Write-LiveLog "Opening $Label: $Url"\n';
  const violations = analyzeLauncherScriptSource(source, 'windows/sample.ps1');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'ps-interpolation-colon');
});

test('batch escaped parentheses are allowed inside IF block', () => {
  const source = [
    '@echo off',
    'if "%~1"=="" (',
    '  echo launcher-root default ^(auto-open is enabled^).',
    ')',
  ].join('\n');

  const violations = analyzeLauncherScriptSource(source, 'windows/sample.cmd');
  assert.equal(violations.length, 0);
});

test('batch raw parentheses are flagged inside IF block', () => {
  const source = [
    '@echo off',
    'if "%~1"=="" (',
    '  echo launcher-root default (auto-open is enabled).',
    ')',
  ].join('\n');

  const violations = analyzeLauncherScriptSource(source, 'windows/sample.cmd');
  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'batch-block-unescaped-parenthesis');
});
