import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const missionConsoleTilePath = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'MissionConsoleTile.jsx');

test('MissionConsoleTile renders compact agent task verification return summary from projection fields', async () => {
  const source = await fs.readFile(missionConsoleTilePath, 'utf8');
  const requiredLabels = [
    'Agent Task Verification Return (compact)',
    'verification return status:',
    'verification decision:',
    'merge readiness:',
    'verification return next action:',
    'highest priority blocker/warning:',
    'manual-only handoff:',
    'openclaw readiness:',
    'openclaw integration mode:',
    'openclaw safe-to-use:',
    'openclaw kill switch:',
    'openclaw kill-switch mode:',
    'openclaw execution allowed:',
    'openclaw top blocker:',
    'openclaw next action:',
    'openclaw adapter next action:',
    'openclaw adapter can execute:',
    'openclaw adapter execution mode:',
    'openclaw adapter connection:',
    'openclaw adapter readiness:',
    'openclaw adapter mode:',
    'openclaw policy notice:',
  ];
  requiredLabels.forEach((label) => assert.equal(source.includes(label), true, `missing compact verification label: ${label}`));
  assert.equal(source.includes('const summary = agentTaskProjection?.readinessSummary || {};'), true);
  assert.equal(source.includes('const operatorSurface = agentTaskProjection?.operatorSurface || {};'), true);
});
