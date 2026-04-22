import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const source = fs.readFileSync(path.join(__dirname, 'aiClient.js'), 'utf8');

test('resolveHostedCloudDispatch switches to executable hosted alternative when selected provider is unavailable', () => {
  assert.match(source, /const HOSTED_COGNITION_PROVIDER_ORDER = \['groq', 'gemini'\]/);
  assert.match(source, /const fallbackCandidate = executableNow[\s\S]*providerCandidates\.find\(\(candidate\) => candidate\.enabled/m);
  assert.match(source, /providerSwitchApplied/);
  assert.match(source, /selected-provider-unavailable-switched-to-hosted-alternative/);
  assert.match(source, /providerPath:\s*String\(routeDecision\?\.hostedCloudExecutionProvider \|\| 'hosted-cloud-worker'\)/);
  assert.match(source, /actualProviderUsed:\s*`\$\{activeProvider\}-hosted-cloud`/);
  assert.match(source, /if \(hostedDispatch\?\.providerSwitchApplied === true && hostedDispatch\?\.executableNow === true\) return true;/);
});

test('resolveHostedCloudDispatch surfaces blocked reason and operator action when no hosted provider is executable', () => {
  assert.match(source, /blockedReason = fallbackCandidate[\s\S]*'provider-disabled'[\s\S]*'no-hosted-provider-executable'/m);
  assert.match(source, /operatorAction = fallbackCandidate[\s\S]*Enable it or enable an alternate hosted provider with a healthy Worker endpoint\./m);
  assert.match(source, /No hosted provider is executable now\./);
  assert.match(source, /hostedProviderStatus:\s*providerCandidates\.map/);
});
