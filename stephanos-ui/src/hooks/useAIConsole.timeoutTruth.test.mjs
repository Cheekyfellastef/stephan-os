import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'useAIConsole.js'), 'utf8');

test('timeout failures persist canonical timeout truth into lastExecutionMetadata', () => {
  assert.match(source, /const timeoutFailureMetadata = buildTimeoutFailureExecutionMetadata\(/);
  assert.match(source, /setLastExecutionMetadata\(timeoutFailureMetadata\)/);
  assert.match(source, /ui_request_timeout_ms:\s*uiError\.timeoutMs\s*\|\|\s*timeoutFailureMetadata\.ui_request_timeout_ms\s*\|\|\s*null/);
  assert.match(source, /backend_route_timeout_ms:\s*timeoutFailureMetadata\.backend_route_timeout_ms\s*\|\|\s*null/);
  assert.match(source, /timeout_policy_source:\s*uiError\.timeoutPolicySource\s*\|\|\s*timeoutFailureMetadata\.timeout_policy_source\s*\|\|\s*null/);
});

test('timeout failure metadata derives from canonical timeout resolver', () => {
  assert.match(source, /const canonicalTimeoutPolicy = resolveUiRequestTimeoutPolicy\(/);
  assert.match(source, /ui_request_timeout_ms:\s*timeoutDetails\.timeoutMs\s*\?\?\s*timeoutDetails\.uiRequestTimeoutMs\s*\?\?\s*canonicalTimeoutPolicy\.uiRequestTimeoutMs/);
  assert.match(source, /model_timeout_ms:\s*timeoutDetails\.modelTimeoutMs\s*\?\?\s*canonicalTimeoutPolicy\.modelTimeoutMs\s*\?\?\s*null/);
});
