import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const PROBE_PATH = fileURLToPath(new URL('./starfield-vr-delivery-truth-probe.mjs', import.meta.url));
const HEAD = 'a'.repeat(40);

function ensureParent(path) {
  mkdirSync(dirname(path), { recursive: true });
}

test('delivery truth probe accepts the UTF-8 BOM emitted by Windows PowerShell 5.1 receipts', () => {
  const root = mkdtempSync(join(tmpdir(), 'starfield-vr-delivery-probe-'));
  try {
    const home = join(root, 'home');
    const repositoryRoot = join(home, 'Documents', 'GitHub', 'stephan-os');
    const workspaceRoot = join(home, 'Documents', 'Stephanos-openclaw-workspace');
    const splashPath = join(repositoryRoot, 'scripts', 'windows', 'launch-starfield-vr-with-splash.ps1');
    const shortcutPath = join(home, 'Desktop', 'Starfield VR.lnk');
    const receiptPath = join(workspaceRoot, 'vr', 'starfield-vr-shortcut-install-current.json');
    const outputPath = join(workspaceRoot, 'vr', 'starfield-vr-delivery-current.json');

    ensureParent(join(repositoryRoot, '.git', 'HEAD'));
    writeFileSync(join(repositoryRoot, '.git', 'HEAD'), `${HEAD}\n`, 'utf8');
    ensureParent(splashPath);
    writeFileSync(splashPath, '# bounded test splash\n', 'utf8');
    ensureParent(shortcutPath);
    writeFileSync(shortcutPath, 'shortcut-fixture\n', 'utf8');

    const receipt = {
      schemaVersion: 'stephanos.starfield-vr-shortcut-install.v1',
      writtenAtUtc: '2026-09-19T20:00:00.000Z',
      goal: 1591,
      workerGoal: 1595,
      shortcutName: 'Starfield VR',
      shortcutPath,
      splashLauncherScript: splashPath,
      launcherScript: join(repositoryRoot, 'scripts', 'windows', 'launch-starfield-vr.ps1'),
      profilePath: join(workspaceRoot, 'vr', 'starfield-vr-launch-profile.json'),
      iconPath: join(home, 'starfield.exe'),
      created: true,
      finalVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
    };
    ensureParent(receiptPath);
    writeFileSync(receiptPath, Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(JSON.stringify(receipt), 'utf8'),
    ]));

    const run = spawnSync(process.execPath, [PROBE_PATH], {
      encoding: 'utf8',
      env: { ...process.env, USERPROFILE: home, HOME: home },
      timeout: 30_000,
    });
    assert.equal(run.status, 0, run.stderr || run.stdout);

    const observation = JSON.parse(run.stdout);
    assert.equal(observation.desktopIconPresent, true);
    assert.equal(observation.splashWrapperPresent, true);
    assert.equal(observation.shortcutRoutesThroughSplash, true);
    assert.equal(observation.installerReceiptPresent, true);
    assert.equal(observation.installerReceiptVerdict, 'STARFIELD_VR_SHORTCUT_INSTALLED');
    assert.equal(observation.installedSourceHead, HEAD);

    const persisted = JSON.parse(readFileSync(outputPath, 'utf8'));
    assert.deepEqual(persisted, observation);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
