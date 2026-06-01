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
    hardBlockPaths: ['.openclaw/', 'DREAMS.md', 'HEARTBEAT.md', 'IDENTITY.md', 'SOUL.md', 'TOOLS.md', 'USER.md', 'memory/'],
    ignitionBlockedReason: 'Hard-block dirt detected',
  });
  assert.equal(projection.workspaceDirtDetected, 'yes');
  assert.equal(projection.workspaceBlocksIgnition, 'yes');
  assert.deepEqual(projection.workspaceDirtPaths, OPENCLAW_WORKSPACE_DIRT_PATHS);
  assert.equal(projection.workspaceDirtCount, 8);
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

test('migration command only targets known OpenClaw workspace paths and never arbitrary source files', () => {
  assert.match(OPENCLAW_WORKSPACE_CLEANUP_COMMAND, /New-Item -ItemType Directory/);
  assert.match(OPENCLAW_WORKSPACE_CLEANUP_COMMAND, /Move-Item -Force/);
  assert.match(OPENCLAW_WORKSPACE_CLEANUP_COMMAND, /runtime\\openclaw-workspace/);
  assert.equal(OPENCLAW_WORKSPACE_DIRT_PATHS.every((path) => OPENCLAW_WORKSPACE_CLEANUP_COMMAND.includes(path)), true);
  assert.equal(OPENCLAW_WORKSPACE_CLEANUP_COMMAND.includes('stephanos-ui/src'), false);
  assert.equal(OPENCLAW_WORKSPACE_CLEANUP_COMMAND.includes('git stash pop'), false);
  assert.equal(OPENCLAW_WORKSPACE_CLEANUP_COMMAND.includes('Remove-Item'), false);
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
  assert.match(mesh.nextBestAction, /PowerShell command|migration command|recommended/i);
  assert.match(mesh.codexReason, /Codex remains fallback implementation capacity/i);
});
