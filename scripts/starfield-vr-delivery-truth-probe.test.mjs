import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const PROBE_URL = new URL('./starfield-vr-delivery-truth-probe.mjs', import.meta.url);
const INSTALLER_SOURCE = readFileSync(new URL('./windows/install-starfield-vr-desktop-shortcut.ps1', import.meta.url), 'utf8');
const PRODUCER_SCHEMA = /schemaVersion = '(stephanos\.starfield-vr-shortcut-install\.v[0-9]+)'/.exec(INSTALLER_SOURCE)?.[1];
const HEAD = 'a'.repeat(40);
const SOURCE_PATHS = [
  'scripts/windows/install-starfield-vr-desktop-shortcut.ps1',
  'scripts/windows/launch-starfield-vr-with-splash.ps1',
  'scripts/windows/launch-starfield-vr.ps1',
];

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'starfield-delivery-v2-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = resolve(root, 'user');
  const systemRoot = resolve(root, 'Windows');
  const repository = resolve(home, 'Documents', 'GitHub', 'stephan-os');
  const workspace = resolve(home, 'Documents', 'Stephanos-openclaw-workspace');
  const splash = resolve(repository, SOURCE_PATHS[1]);
  const launcher = resolve(repository, SOURCE_PATHS[2]);
  const powershell = resolve(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const profile = resolve(workspace, 'vr', 'starfield-vr-launch-profile.json');
  const shortcut = resolve(home, 'Desktop', 'Starfield VR.lnk');
  const receiptPath = resolve(workspace, 'vr', 'starfield-vr-shortcut-install-current.json');
  const outputPath = resolve(workspace, 'vr', 'starfield-vr-delivery-current.json');
  const headPath = resolve(repository, '.git', 'HEAD');
  for (const path of [splash, launcher, powershell, shortcut, receiptPath, headPath]) mkdirSync(dirname(path), { recursive: true });
  const splashBytes = Buffer.from('# reviewed splash fixture\r\n');
  writeFileSync(splash, splashBytes);
  writeFileSync(launcher, '# launcher fixture\n');
  writeFileSync(powershell, 'inert fixture; never executed');
  writeFileSync(shortcut, 'inert shortcut fixture; COM inspection is a separate mailbox check');
  writeFileSync(headPath, `${HEAD}\n`);
  const receipt = {
    schemaVersion: PRODUCER_SCHEMA,
    writtenAtUtc: '2026-11-07T00:00:00.000Z',
    goal: 1591,
    workerGoal: 1595,
    shortcutName: 'Starfield VR',
    shortcutPath: shortcut,
    targetPath: powershell,
    arguments: `-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "${splash}" -ProfilePath "${profile}"`,
    workingDirectory: repository,
    splashLauncherScript: splash,
    splashLauncherSha256: createHash('sha256').update(splashBytes).digest('hex'),
    sourceHead: HEAD,
    sourceClean: true,
    sourcePaths: [...SOURCE_PATHS],
    launcherScript: launcher,
    profilePath: profile,
    iconPath: powershell,
    created: true,
    finalVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
  };
  return {
    home, systemRoot, repository, splash, shortcut, receipt, receiptPath, outputPath, headPath,
    writeReceipt(overrides = {}, { bom = true } = {}) {
      const bytes = Buffer.from(JSON.stringify({ ...receipt, ...overrides }), 'utf8');
      writeFileSync(receiptPath, bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]) : bytes);
    },
    run() {
      const result = spawnSync(process.execPath, [fileURLToPath(PROBE_URL)], {
        env: { ...process.env, USERPROFILE: home, SystemRoot: systemRoot, SYSTEMROOT: systemRoot },
        encoding: 'utf8', shell: false, timeout: 10_000, maxBuffer: 128 * 1024,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, '');
      const observation = JSON.parse(result.stdout);
      assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), observation);
      assert.equal(observation.schemaVersion, 'stephanos.starfield-vr-local-delivery-observation.v1');
      assert.deepEqual(Object.keys(observation).sort(), [
        'desktopIconPresent', 'installedSourceHead', 'installerReceiptPresent', 'installerReceiptVerdict',
        'observedAtUtc', 'schemaVersion', 'shortcutArguments', 'shortcutRoutesThroughSplash',
        'shortcutTargetPath', 'splashWrapperPresent',
      ]);
      assert.equal(observation.shortcutTargetPath, '');
      assert.equal(observation.shortcutArguments, '');
      assert.equal(JSON.stringify(observation).includes(home), false, 'probe output must not publish private paths');
      return observation;
    },
  };
}

test('actual probe accepts the current V2 PowerShell receipt including its UTF-8 BOM', (t) => {
  assert.equal(PRODUCER_SCHEMA, 'stephanos.starfield-vr-shortcut-install.v2');
  const f = fixture(t);
  f.writeReceipt();
  assert.throws(() => JSON.parse(readFileSync(f.receiptPath, 'utf8')), SyntaxError);
  const observation = f.run();
  assert.equal(observation.installerReceiptPresent, true);
  assert.equal(observation.desktopIconPresent, true);
  assert.equal(observation.splashWrapperPresent, true);
  assert.equal(observation.shortcutRoutesThroughSplash, true);
  assert.equal(observation.installedSourceHead, HEAD);
});

test('actual probe also accepts a V2 receipt without a BOM', (t) => {
  const f = fixture(t);
  f.writeReceipt({}, { bom: false });
  assert.equal(f.run().shortcutRoutesThroughSplash, true);
});

const invalidReceipts = [
  ['legacy schema', () => ({ schemaVersion: 'stephanos.starfield-vr-shortcut-install.v1' })],
  ['unknown schema', () => ({ schemaVersion: 'stephanos.starfield-vr-shortcut-install.v3' })],
  ['stale source head', () => ({ sourceHead: 'b'.repeat(40) })],
  ['missing source head', () => ({ sourceHead: undefined })],
  ['dirty source', () => ({ sourceClean: false })],
  ['truthy source claim', () => ({ sourceClean: 'true' })],
  ['missing source paths', () => ({ sourcePaths: undefined })],
  ['extra source path', () => ({ sourcePaths: [...SOURCE_PATHS, 'other.ps1'] })],
  ['different source path', () => ({ sourcePaths: [SOURCE_PATHS[0], 'other.ps1', SOURCE_PATHS[2]] })],
  ['wrong splash path', (f) => ({ splashLauncherScript: resolve(f.repository, 'other.ps1') })],
  ['wrong splash hash', () => ({ splashLauncherSha256: '0'.repeat(64) })],
  ['missing splash hash', () => ({ splashLauncherSha256: undefined })],
  ['wrong launcher path', (f) => ({ launcherScript: f.splash })],
  ['wrong profile path', (f) => ({ profilePath: resolve(f.repository, 'other.json') })],
  ['wrong working directory', (f) => ({ workingDirectory: f.home })],
  ['wrong target', (f) => ({ targetPath: resolve(f.systemRoot, 'notepad.exe') })],
  ['wrong arguments', (f) => ({ arguments: f.receipt.arguments + ' -NoExit' })],
  ['relative shortcut path', () => ({ shortcutPath: 'Desktop/Starfield VR.lnk' })],
  ['outside-home shortcut path', (f) => ({ shortcutPath: resolve(f.home, '..', 'Starfield VR.lnk') })],
  ['wrong shortcut name', (f) => ({ shortcutPath: resolve(f.home, 'Desktop', 'Other.lnk') })],
  ['preview receipt', () => ({ created: false, finalVerdict: 'STARFIELD_VR_SHORTCUT_PREVIEWED' })],
];

for (const [label, changes] of invalidReceipts) {
  test(`actual probe refuses ${label}`, (t) => {
    const f = fixture(t);
    f.writeReceipt(changes(f));
    const observation = f.run();
    assert.equal(observation.installerReceiptPresent, true);
    assert.equal(observation.shortcutRoutesThroughSplash, false);
    assert.equal(observation.desktopIconPresent, false);
    assert.equal(observation.installedSourceHead, HEAD);
  });
}

test('actual probe binds the receipt hash to current splash bytes', (t) => {
  const f = fixture(t);
  f.writeReceipt();
  writeFileSync(f.splash, '# changed since installation\r\n');
  assert.equal(f.run().shortcutRoutesThroughSplash, false);
});

test('actual probe binds the receipt head to current repository HEAD', (t) => {
  const f = fixture(t);
  f.writeReceipt();
  writeFileSync(f.headPath, `${'b'.repeat(40)}\n`);
  const observation = f.run();
  assert.equal(observation.shortcutRoutesThroughSplash, false);
  assert.equal(observation.installedSourceHead, 'b'.repeat(40));
});

test('receipt presence cannot replace a missing actual shortcut or splash', (t) => {
  const f = fixture(t);
  f.writeReceipt();
  rmSync(f.shortcut);
  assert.equal(f.run().shortcutRoutesThroughSplash, false);
  rmSync(f.splash);
  const observation = f.run();
  assert.equal(observation.splashWrapperPresent, false);
  assert.equal(observation.shortcutRoutesThroughSplash, false);
});

test('malformed or missing receipt never projects delivery success', (t) => {
  const f = fixture(t);
  assert.equal(existsSync(f.receiptPath), false);
  assert.equal(f.run().shortcutRoutesThroughSplash, false);
  writeFileSync(f.receiptPath, '{not JSON');
  const observation = f.run();
  assert.equal(observation.installerReceiptPresent, true);
  assert.equal(observation.shortcutRoutesThroughSplash, false);
});

test('production probe remains a bounded file observer with no child process authority', () => {
  const probeSource = readFileSync(PROBE_URL, 'utf8');
  assert.ok(probeSource.includes("bytes.toString('utf8').replace(/^\\uFEFF/, '')"));
  assert.doesNotMatch(probeSource, /node:child_process|\b(?:spawn|exec)Sync?\s*\(/);
});
