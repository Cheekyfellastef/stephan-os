import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const atlasRoot = resolve(root, 'apps/vr-capability-atlas');
const manifest = JSON.parse(await readFile(resolve(atlasRoot, 'app.json'), 'utf8'));
const entry = await readFile(resolve(atlasRoot, manifest.entry), 'utf8');
const css = await readFile(resolve(atlasRoot, 'atlas-v2.css'), 'utf8');
const methodRule = css.match(/\.method\{([^}]*)\}/)?.[1] || '';
const statusRule = css.match(/\.method>\.status\{([^}]*)\}/)?.[1] || '';

test('active VR Atlas entry inherits compact non-stretching method status pills', () => {
  assert.match(entry, /href=["']\.\/atlas-v2\.css["']/);
  assert.match(methodRule, /align-items:center/);
  for (const declaration of [
    'justify-self:start',
    'align-self:center',
    'width:max-content',
    'max-width:135px',
    'text-align:center',
    'white-space:normal',
    'overflow-wrap:anywhere',
  ]) {
    assert.ok(statusRule.includes(declaration), `missing shared status-pill declaration: ${declaration}`);
  }
});
