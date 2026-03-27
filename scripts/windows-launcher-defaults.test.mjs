import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const WINDOWS_LAUNCHER_PS1 = new URL('../windows/Launch-Stephanos-Local.ps1', import.meta.url);
const WINDOWS_LAUNCHER_CMD = new URL('../windows/Launch-Stephanos-Local.cmd', import.meta.url);

test('launcher-root mode enables browser auto-open by default', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(
    script,
    /\$autoOpenEnabled = if \(\$Mode -eq 'launcher-root'\) \{\s*\$true\s*\}/m,
    'launcher-root mode must force auto-open enabled by default',
  );
});

test('launcher-root cmd default launch does not require explicit -AutoOpen switch', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_CMD, 'utf8');
  assert.doesNotMatch(
    script,
    /-Mode launcher-root -BootMode cockpit -AutoOpen/,
    'default launcher-root invocation should not require -AutoOpen',
  );
  assert.match(
    script,
    /-Mode launcher-root -BootMode cockpit/,
    'default launcher-root invocation must remain launcher-root cockpit',
  );
});

test('vite-dev localhost launch still uses explicit AutoOpen switch behavior', async () => {
  const script = await readFile(WINDOWS_LAUNCHER_PS1, 'utf8');
  assert.match(
    script,
    /elseif \(\$isLocalhostLaunch\) \{\s*\$AutoOpen\.IsPresent\s*\}/m,
    'non-launcher-root localhost launches should still require -AutoOpen',
  );
});
