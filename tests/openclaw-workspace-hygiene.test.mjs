import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_WORKSPACE_CLEANUP_COMMAND,
  OPENCLAW_WORKSPACE_DIRT_PATHS,
  buildOpenClawWorkspaceHygieneProjection,
  isOpenClawWorkspaceDirtPath,
} from '../shared/agents/openClawWorkspaceHygiene.mjs';
import { deriveOperatorReliefProjection } from '../stephanos-ui/src/state/operatorReliefProjection.js';

test('detects known OpenClaw repo-root workspace hard-block paths', () => {
  const projection = buildOpenClawWorkspaceHygieneProjection({
    hardBlockPaths: ['.openclaw/', 'HEARTBEAT.md', 'IDENTITY.md', 'SOUL.md', 'TOOLS.md', 'USER.md'],
    ignitionBlockedReason: 'Hard-block dirt detected',
  });
  assert.equal(projection.workspaceDirtDetected, 'yes');
  assert.equal(projection.workspaceBlocksIgnition, 'yes');
  assert.deepEqual(projection.workspaceDirtPaths, OPENCLAW_WORKSPACE_DIRT_PATHS);
  assert.equal(projection.workspaceDirtCount, 6);
  assert.equal(projection.workspaceMutationAuthority, 'locked');
});

test('does not classify unrelated source files as OpenClaw workspace dirt', () => {
  const projection = buildOpenClawWorkspaceHygieneProjection({
    gitStatusText: ' M stephanos-ui/src/state/operatorReliefProjection.js\n?? docs/notes.md',
    ignitionBlockedReason: 'Source dirt detected',
  });
  assert.equal(projection.workspaceDirtDetected, 'no');
  assert.equal(projection.workspaceDirtCount, 0);
  assert.equal(isOpenClawWorkspaceDirtPath('stephanos-ui/src/App.jsx'), false);
});

test('cleanup command only targets known OpenClaw workspace paths and never arbitrary source files', () => {
  assert.equal(OPENCLAW_WORKSPACE_CLEANUP_COMMAND, 'git stash push -u -m "stash-openclaw-workspace-dirt-before-ignition" -- .openclaw HEARTBEAT.md IDENTITY.md SOUL.md TOOLS.md USER.md');
  assert.equal(OPENCLAW_WORKSPACE_CLEANUP_COMMAND.includes('stephanos-ui/src'), false);
  assert.equal(OPENCLAW_WORKSPACE_CLEANUP_COMMAND.includes('git stash pop'), false);
  assert.equal(OPENCLAW_WORKSPACE_CLEANUP_COMMAND.includes(' rm '), false);
});

test('Builder Mesh blocks OpenClaw routing when workspace dirt blocks ignition', () => {
  const projection = deriveOperatorReliefProjection({
    supportSnapshot: {
      localAiConnected: false,
      builderWorkbenchInput: {
        openClawWorkspaceDirtPaths: ['.openclaw', 'HEARTBEAT.md'],
        ignitionBlockedReason: 'Hard-block dirt detected',
      },
    },
  });
  const mesh = projection.builderMeshProjection;
  assert.equal(mesh.openClawCanHelp, 'blocked-workspace-dirt');
  assert.notEqual(mesh.recommendedBuilder, 'openclaw');
  assert.equal(mesh.builderWorkbenchProjection.openClawWorkspaceHygiene.workspaceBlocksIgnition, 'yes');
  assert.match(mesh.nextBestAction, /stash command/i);
  assert.match(mesh.codexReason, /Codex remains fallback implementation capacity/i);
});
