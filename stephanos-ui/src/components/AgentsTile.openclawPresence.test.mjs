import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const tilePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'AgentsTile.jsx');

test('AgentsTile renders OpenClaw bounded presence and integration topology fields', async () => {
  const source = await fs.readFile(tilePath, 'utf8');
  const requiredLabels = [
    'OpenClaw Governed Presence',
    'Agent Name:',
    'Role:',
    'Mode:',
    'Authority:',
    'Approval Required:',
    'Workspace Path / Repo Scope:',
    'Sandbox Status:',
    'Skill Policy / Allowlist Status:',
    'Plugin Trust Posture:',
    'Session State:',
    'Current Activity:',
    'Last Scan Type:',
    'Last Inspection Scope:',
    'Last Proposed Prompt:',
    'Blocked Capabilities:',
    'Zero-Cost Guardrails Status:',
    'OpenClaw Integration Topology',
  ];
  requiredLabels.forEach((label) => assert.equal(source.includes(label), true, `missing label: ${label}`));
  assert.equal(source.includes('Mission Console'), false);
  assert.equal(source.includes("join(' -> ')"), true);
});
