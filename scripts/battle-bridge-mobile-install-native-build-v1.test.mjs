import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readMobileInstallerNativeSourceV1 } from './fixtures/sovereign-mobile-installer-native-source-v1.mjs';

test('the complete native mobile boundary compiles together without invoking an entry or protected factory',
  { skip: process.platform !== 'win32' }, () => {
    const units = readMobileInstallerNativeSourceV1();
    assert.equal(units.length, 16);
    const paths = units.map(unit => "'" + unit.absolutePath.replaceAll("'", "''") + "'");
    const script = "$ErrorActionPreference='Stop';$source=(@(" + paths.join(',')
      + ")|ForEach-Object{[IO.File]::ReadAllText($_)}) -join [Environment]::NewLine;"
      + "Add-Type -TypeDefinition $source -ReferencedAssemblies 'System.Web.Extensions','System.Core','System.Management' -ErrorAction Stop;"
      + "[Console]::Write('ALL_SIXTEEN_NATIVE_UNITS_COMPILE_ONLY_OK')";
    const result = spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
      { shell: false, windowsHide: true, encoding: 'utf8', timeout: 30000, maxBuffer: 8192 });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.stdout, 'ALL_SIXTEEN_NATIVE_UNITS_COMPILE_ONLY_OK');
  });
