import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const PROBE_URL = new URL('./starfield-vr-delivery-truth-probe.mjs', import.meta.url);

test('delivery truth probe normalizes the UTF-8 BOM emitted by Windows PowerShell 5.1 receipts', () => {
  const receipt = {
    schemaVersion: 'stephanos.starfield-vr-shortcut-install.v1',
    shortcutName: 'Starfield VR',
    created: true,
    finalVerdict: 'STARFIELD_VR_SHORTCUT_INSTALLED',
  };
  const bomReceipt = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(JSON.stringify(receipt), 'utf8'),
  ]);

  assert.throws(() => JSON.parse(bomReceipt.toString('utf8')), SyntaxError);
  const normalized = bomReceipt.toString('utf8').replace(/^\uFEFF/, '');
  assert.deepEqual(JSON.parse(normalized), receipt);

  const probeSource = readFileSync(PROBE_URL, 'utf8');
  assert.ok(
    probeSource.includes("bytes.toString('utf8').replace(/^\\uFEFF/, '')"),
    'the production bounded JSON reader must strip only a leading UTF-8 BOM before JSON.parse',
  );
  assert.doesNotMatch(probeSource, /node:child_process|\b(?:spawn|exec)Sync?\s*\(/);
});
