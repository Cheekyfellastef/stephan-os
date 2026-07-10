import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { bootstrapSharedWorkspaceRuntimeLayout, getDefaultSharedWorkspaceRoot, resolveSharedWorkspaceRuntimeConfig, validateExistingSharedWorkspaceRuntimeConfig, SHARED_WORKSPACE_BLOCKERS, SHARED_WORKSPACE_RUNTIME_DIRECTORIES } from './sharedWorkspaceRuntimeConfig.mjs';

test('safe default external path resolves under user documents', () => {
  const repoRoot = resolve('/tmp/repo');
  const home = resolve('/tmp/operator-home');
  const root = getDefaultSharedWorkspaceRoot({ env: { HOME: home } });
  assert.equal(root, resolve(home, 'Documents', 'Stephanos-openclaw-workspace'));
  const resolved = resolveSharedWorkspaceRuntimeConfig({ env: { HOME: home }, repoRoot });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.source, 'default-documents');
  assert.equal(resolved.root, root);
});

test('env override safe external path is accepted', () => {
  const root = resolve(tmpdir(), 'stephanos-runtime-config-safe');
  const resolved = resolveSharedWorkspaceRuntimeConfig({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root }, repoRoot: process.cwd() });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.source, 'env');
  assert.equal(resolved.root, root);
});

test('repo path and traversal/secrets paths are rejected', () => {
  const repoPath = join(process.cwd(), 'workspace');
  assert.equal(resolveSharedWorkspaceRuntimeConfig({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: repoPath }, repoRoot: process.cwd() }).reason, SHARED_WORKSPACE_BLOCKERS.INSIDE_REPO);
  assert.equal(resolveSharedWorkspaceRuntimeConfig({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: '../workspace' }, repoRoot: process.cwd() }).reason, SHARED_WORKSPACE_BLOCKERS.UNSAFE);
  assert.equal(resolveSharedWorkspaceRuntimeConfig({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: join(tmpdir(), '.ssh', 'workspace') }, repoRoot: process.cwd() }).reason, SHARED_WORKSPACE_BLOCKERS.UNSAFE);
});

test('missing workspace returns unavailable with exact next action', async () => {
  const root = join(tmpdir(), `stephanos-missing-${Date.now()}-nope`);
  const result = await validateExistingSharedWorkspaceRuntimeConfig({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: root }, repoRoot: process.cwd() });
  assert.equal(result.ok, false);
  assert.equal(result.reason, SHARED_WORKSPACE_BLOCKERS.MISSING);
  assert.match(result.exactNextAction, /STEPHANOS_SHARED_AGENT_WORKSPACE/);
});

test('bootstrap creates only approved Shared Workspace layout', async () => {
  const root = await mkdtemp(join(tmpdir(), 'stephanos-bootstrap-workspace-'));
  const result = await bootstrapSharedWorkspaceRuntimeLayout({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: join(root, 'workspace') }, repoRoot: process.cwd() });
  assert.equal(result.ok, true);
  const names = (await readdir(result.root)).sort();
  assert.deepEqual(names, [...SHARED_WORKSPACE_RUNTIME_DIRECTORIES].sort());
});

test('configured repo workspace root is rejected without exposing raw path', () => {
  const repoRoot = process.cwd();
  const repoPath = join(repoRoot, 'shared-agent-workspace');
  const resolved = resolveSharedWorkspaceRuntimeConfig({ env: { STEPHANOS_SHARED_AGENT_WORKSPACE: repoPath }, repoRoot });
  const serialized = JSON.stringify(resolved);
  assert.equal(resolved.ok, false);
  assert.equal(resolved.reason, SHARED_WORKSPACE_BLOCKERS.INSIDE_REPO);
  assert.equal(resolved.workspaceRoot, 'UNKNOWN');
  assert.equal(resolved.safeDisplayPath, 'UNKNOWN');
  assert.equal(serialized.includes(repoPath), false);
});
