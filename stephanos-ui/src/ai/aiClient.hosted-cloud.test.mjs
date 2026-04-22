import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'aiClient.js'), 'utf8');

test('hosted cloud branch defines canonical request contract and normalization layer', () => {
  assert.match(source, /HOSTED_COGNITION_CONTRACT_VERSION\s*=\s*'stephanos\.hosted-cognition\.v1'/);
  assert.match(source, /function buildHostedCloudPayload\(/);
  assert.match(source, /requestKind:\s*'hosted-cloud-cognition-chat'/);
  assert.match(source, /executionDeferred:\s*true/);
  assert.match(source, /function normalizeHostedCloudResponseData\(/);
  assert.match(source, /authority_level:[\s\S]*'cloud-cognition-only'/m);
  assert.match(source, /selected_provider_truth/);
  assert.match(source, /executable_provider_truth/);
});

test('sendPrompt can prefer hosted dispatch before backend when authority is deferred', () => {
  assert.match(source, /function shouldPreferHostedDispatch\(/);
  assert.match(source, /hostedDispatch\?\.provider === hostedDispatch\?\.selectedProvider && hostedDispatch\?\.executableNow/);
  assert.match(source, /routeDecision\?\.battleBridgeAuthorityAvailable === false/);
  assert.match(source, /if \(shouldPreferHostedDispatch\(hostedDispatch, routeDecision\)\) \{/);
  assert.match(source, /requestHostedCloudChat\(/);
  assert.match(source, /hostedConfig\?\.providers\?\.\[provider\]\?\.baseURL/);
  assert.match(source, /optimisticExecutionAllowed/);
});

test('getProviderHealth falls back to hosted probe path when backend provider health fails', () => {
  assert.match(source, /async function probeHostedProviderHealth\(/);
  assert.match(source, /requestKind:\s*'hosted-cloud-cognition-health-probe'/);
  assert.match(source, /const \[groqHealth, geminiHealth\] = await Promise\.all\(/);
  assert.match(source, /status:\s*207/);
  assert.match(source, /executionPath:\s*`\$\{provider\}-hosted-cloud`/);
});

test('aiClient exposes direct hosted worker connectivity probe for operator test actions', () => {
  assert.match(source, /export async function testHostedCloudWorkerConnection\(/);
  assert.match(source, /requestKind:\s*'hosted-cloud-cognition-health-probe'/);
  assert.match(source, /parseSuccess/);
  assert.match(source, /resolveHostedWorkerEndpoint/);
});

test('hosted worker transport failures are labeled with canonical hosted error codes', () => {
  assert.match(source, /hosted-worker-timeout/);
  assert.match(source, /hosted-worker-invalid-response/);
  assert.match(source, /hosted-worker-unreachable/);
});
