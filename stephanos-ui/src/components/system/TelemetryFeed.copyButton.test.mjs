import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'TelemetryFeed.jsx'), 'utf8');

test('TelemetryFeed copy button enters success state only after clipboard success', () => {
  assert.match(source, /const result = await writeTextToClipboard\(copyPayload\);/);
  assert.match(source, /if \(result\.ok\) \{\s*setCopyState\(COPY_STATE\.SUCCESS\);/);
  assert.match(source, /setCopyNotice\('Mission trace copied\.'\);/);
});

test('TelemetryFeed copy button enters failure state and renders explicit failure notice', () => {
  assert.match(source, /setCopyState\(COPY_STATE\.FAILURE\);/);
  assert.match(source, /setCopyNotice\(describeCopyFailure\(result\.reason\)\);/);
  assert.match(source, /Copy failed: clipboard permission denied in this runtime\./);
});

test('TelemetryFeed copy button uses shared clipboard button state model for transient feedback', () => {
  assert.match(source, /import \{ COPY_STATE, useClipboardButtonState \} from '\.\.\/\.\.\/hooks\/useClipboardButtonState';/);
  assert.match(source, /className=\{`ghost-button telemetry-trace-copy-button \$\{copyState\}`\}/);
});
