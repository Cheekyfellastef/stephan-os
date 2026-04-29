import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const componentPath = path.join(path.dirname(new URL(import.meta.url).pathname), 'MissionDashboardPanel.jsx');

test('MissionDashboardPanel copy button uses shared clipboard state success/failure feedback', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.match(source, /useClipboardButtonState/);
  assert.match(source, /setMissionHandoffCopyState\(COPY_STATE\.SUCCESS\)/);
  assert.match(source, /setMissionHandoffCopyState\(COPY_STATE\.FAILURE\)/);
  assert.match(source, /className=\{`status-panel-copy-button \$\{missionHandoffCopyState\}`\}/);
});

test('MissionDashboardPanel copy payload includes next best actions from shared projection', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.match(source, /buildMissionHandoffText\(dashboardState, \{/);
  assert.match(source, /nextBestActions: handoffMilestoneProjection\.nextBestActions/);
  assert.match(source, /wiringGaps: handoffMilestoneProjection\.wiringGaps/);
});


test('MissionDashboardPanel preserves readonly endpoint summary fields for project progress normalization', async () => {
  const source = await fs.readFile(componentPath, 'utf8');
  assert.match(source, /deriveReadonlyEndpointSummary\(summary, projectionOperatorSurface\)/);
  assert.match(source, /openClawReadonlyValidationEndpointPath:[\s\S]*\/api\/openclaw\/health-handshake\/validate-readonly/);
  assert.match(source, /openClawReadonlyValidationEndpointMode:[\s\S]*local_readonly_probe/);
  assert.match(source, /openclaw-validation-endpoint'] === 'available'/);
});
