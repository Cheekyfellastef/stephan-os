import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, '../routes/ai.js'), 'utf8');

test('/api/ai/chat preserves live goal projection on ordinary success responses', () => {
  const successStart = source.indexOf('const successPayload = buildSuccessResponse({');
  assert.notEqual(successStart, -1);
  const successSlice = source.slice(successStart, successStart + 2200);
  assert.match(successSlice, /data:\s*\{[\s\S]*?liveGoalProjection,[\s\S]*?provider:/);
});

test('/api/ai/chat preserves live goal projection on provider failure responses', () => {
  const failureStart = source.indexOf('const failurePayload = buildErrorResponse({');
  assert.notEqual(failureStart, -1);
  const failureSlice = source.slice(failureStart, failureStart + 2200);
  assert.match(failureSlice, /data:\s*\{[\s\S]*?liveGoalProjection,[\s\S]*?provider:/);
});
