import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const members = [
  'splash_monitor_bridge.py',
  'run_native_eye_output_monitor.py',
  'start_native_eye_output_session.py',
  'analyze_native_eye_output_session.py',
];
const relativeDirectory = 'scripts/windows/starfield-native-monitor/';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

test('Windows-style automatic line conversion preserves every hashed monitor source byte', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'starfield-monitor-checkout-'));
  try {
    const attributes = await readFile(new URL('../.gitattributes', import.meta.url));
    await writeFile(join(directory, '.gitattributes'), attributes);
    const expected = new Map();
    for (const name of members) {
      const relative = relativeDirectory + name;
      const bytes = await readFile(new URL('./windows/starfield-native-monitor/' + name, import.meta.url));
      assert.equal(bytes.includes(13), false, name + ' must be frozen with LF bytes');
      const path = join(directory, relative);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, bytes);
      expected.set(relative, digest(bytes));
    }
    // The control proves that automatic conversion was actually active.
    await writeFile(join(directory, 'conversion-control.txt'), 'one\ntwo\n');
    const run = args => {
      const result = spawnSync('git', ['-c', 'core.autocrlf=true', ...args], {
        cwd: directory, encoding: 'utf8', timeout: 20_000,
      });
      assert.equal(result.status, 0, result.stderr || String(result.error || args.join(' ')));
    };
    run(['init', '--quiet']);
    run(['add', '--', '.gitattributes', ...expected.keys(), 'conversion-control.txt']);
    await mkdir(join(directory, 'checked-out'));
    run(['checkout-index', '--all', '--force', '--prefix=checked-out/']);
    for (const [relative, hash] of expected) {
      assert.equal(digest(await readFile(join(directory, 'checked-out', relative))), hash, relative);
    }
    assert.equal(await readFile(join(directory, 'checked-out/conversion-control.txt'), 'utf8'), 'one\r\ntwo\r\n');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
