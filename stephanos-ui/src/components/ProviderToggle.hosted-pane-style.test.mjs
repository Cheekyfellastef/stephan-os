import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cssSource = fs.readFileSync(path.join(__dirname, '..', 'styles.css'), 'utf8');

test('Hosted Cloud Cognition pane uses full-width form controls', () => {
  assert.match(cssSource, /\.hosted-provider-card input,[\s\S]*\.hosted-provider-card select,[\s\S]*\.hosted-cloud-form-grid input,[\s\S]*\.hosted-cloud-form-grid select \{[\s\S]*width:\s*100%/m);
});
