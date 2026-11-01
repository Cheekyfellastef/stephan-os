import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { executeExactHeadBattleBridgePreservationSync } from '../../scripts/battle-bridge-exact-head-preservation-sync.mjs';
import { executeBattleBridgeGitHubCommand } from './battleBridgeGitHubCommandMailbox.mjs';
import { DEFAULT_CODEX_DISPATCH_REPO_ROOT, syncCodexDispatchBridge } from './codexDispatchHostOps.mjs';
import { BATTLE_BRIDGE_RUNTIME_DATA_PATHS } from './battleBridgeDirtyDataPreservationV1.mjs';
import {
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_MARKER,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_OPERATION,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_SCHEMA,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG,
  BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_VERDICT,
  buildFixedBattleBridgeBootstrapEncodedCommand,
  buildFixedBattleBridgeBootstrapPowerShell,
  extractBattleBridgeTailscaleBootstrap,
  validateBattleBridgeTailscaleBootstrap,
  validateBattleBridgeTailscaleBootstrapReceipt,
} from './battleBridgeTailscaleBootstrapPipeV1.mjs';

const HEAD = 'a'.repeat(40);
const NOW = new Date('2026-08-07T13:45:00.000Z');
const CANONICAL_MAILBOX_ISSUE = 3149;

function command(overrides = {}) {
  return {
    schemaVersion: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_SCHEMA,
    requestId: 'tailscale-bootstrap-72d4e79-20260807T1345Z',
    operation: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_OPERATION,
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: CANONICAL_MAILBOX_ISSUE,
    operatorApproval: 'operator-approved',
    expectedHead: HEAD,
    expiresAt: '2026-08-07T14:00:00.000Z',
    ...overrides,
  };
}

function body(value = command()) {
  return `\`\`\`${BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_MARKER}\n${JSON.stringify(value, null, 2)}\n\`\`\``;
}

test('owner-authored exact-head request is accepted and Codex is not required', () => {
  const extracted = extractBattleBridgeTailscaleBootstrap(body());
  assert.equal(extracted.ok, true);
  const result = validateBattleBridgeTailscaleBootstrap(extracted.command, {
    authorLogin: 'Cheekyfellastef',
    issueNumber: CANONICAL_MAILBOX_ISSUE,
    now: NOW,
    currentMainHead: HEAD,
  });
  assert.equal(result.ok, true);
  assert.equal(result.request.expectedHead, HEAD);
  assert.equal(result.codexRequired, false);
  assert.equal(result.arbitraryCommandAllowed, false);
  assert.equal(result.arbitraryPathAllowed, false);
  assert.equal(result.arbitraryTaskNameAllowed, false);
  assert.equal(BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_TAG, 'tag:stephanos-github-recovery');
});

test('request rejects foreign author, retired/foreign issue, head, expiry and any extra authority field', () => {
  const fixtures = [
    { value: command(), options: { authorLogin: 'someone-else', issueNumber: CANONICAL_MAILBOX_ISSUE, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_AUTHOR_NOT_ALLOWED' },
    { value: command(), options: { authorLogin: 'Cheekyfellastef', issueNumber: 1507, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_ISSUE_MISMATCH' },
    { value: command(), options: { authorLogin: 'Cheekyfellastef', issueNumber: 2159, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_ISSUE_MISMATCH' },
    { value: command(), options: { authorLogin: 'Cheekyfellastef', issueNumber: CANONICAL_MAILBOX_ISSUE, now: NOW, currentMainHead: 'b'.repeat(40) }, blocker: 'TAILSCALE_BOOTSTRAP_MAIN_HEAD_MISMATCH' },
    { value: command({ expiresAt: '2026-08-07T15:00:00.000Z' }), options: { authorLogin: 'Cheekyfellastef', issueNumber: CANONICAL_MAILBOX_ISSUE, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_EXPIRY_TOO_FAR_AHEAD' },
    { value: { ...command(), command: 'whoami' }, options: { authorLogin: 'Cheekyfellastef', issueNumber: CANONICAL_MAILBOX_ISSUE, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_FIELDS_NOT_EXACT' },
    { value: { ...command(), path: 'C:\\Windows' }, options: { authorLogin: 'Cheekyfellastef', issueNumber: CANONICAL_MAILBOX_ISSUE, now: NOW, currentMainHead: HEAD }, blocker: 'TAILSCALE_BOOTSTRAP_FIELDS_NOT_EXACT' },
  ];
  for (const fixture of fixtures) {
    const result = validateBattleBridgeTailscaleBootstrap(fixture.value, fixture.options);
    assert.equal(result.ok, false);
    assert.equal(result.blocker, fixture.blocker);
  }
});

test('fixed remote PowerShell binds preservation and fast-forward to the approved exact head', () => {
  const source = buildFixedBattleBridgeBootstrapPowerShell(HEAD);
  assert.match(source, /battle-bridge-exact-head-preservation-sync\.mjs/);
  assert.match(source, /battle-bridge-runtime-data-v1/);
  assert.match(source, /exactHeadBound -ne \$true/);
  assert.match(source, /\$sync\.expectedHead -ne \$expectedHead/);
  assert.match(source, /\$sync\.afterHead -ne \$expectedHead/);
  assert.match(source, /preservation\.receipt\.itemCount -ne 6/);
  assert.match(source, /preservation\.receipt\.allHashesVerified -ne \$true/);
  assert.match(source, /preservation\.destructiveCleanupPerformed -ne \$false/);
  assert.ok(source.includes(String.raw`C:\Program Files\nodejs\node.exe`));
  assert.ok(source.includes(String.raw`C:\Program Files\Git\cmd\git.exe`));
  assert.match(source, /install-battle-bridge-github-sync\.ps1/);
  assert.match(source, /status-battle-bridge-github-sync\.ps1/);
  assert.match(source, /Stephanos Battle Bridge GitHub Sync/);
  assert.match(source, /-StartNow/);
  assert.match(source, new RegExp(HEAD));
  assert.match(source, /BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_READY/);
  assert.match(source, /liveOpenClawUpdateAllowed -ne \$false/);
  assert.match(source, /codexRequired = \$false/);
  assert.match(source, /try \{ \$syncOutput = @\(& \$node \$preservationSync \$expectedHead\) \} catch \{ throw 'TAILSCALE_BOOTSTRAP_PRESERVATION_SYNC_FAILED' \}/);
  assert.match(source, /try \{ \$installerOutput = @\(& \$installer -StartNow\) \} catch \{ throw 'TAILSCALE_BOOTSTRAP_SYNC_INSTALLER_FAILED' \}/);
  assert.match(source, /try \{ \$statusOutput = @\(& \$statusScript\) \} catch \{ throw 'TAILSCALE_BOOTSTRAP_SYNC_STATUS_FAILED' \}/);
  assert.doesNotMatch(source, /stephanos-codex-dispatch-mcp\.mjs|sync_codex_dispatch_bridge/);
  assert.doesNotMatch(source, /reset --hard|git clean|git stash|git rebase|git push|Restart-Computer|Stop-Computer|Invoke-Expression/i);
  assert.doesNotMatch(source, /codex\.exe|codex\.cmd|codex\s+(?:exec|run|dispatch)|openclaw-gateway|gateway\.cmd|\.openclaw/i);
  const encoded = buildFixedBattleBridgeBootstrapEncodedCommand(HEAD);
  assert.match(encoded, /^[A-Za-z0-9+/=]+$/);
  assert.ok(encoded.length > 100);
});

test('bootstrap installer receipt gate matches the canonical GitHub Sync task cadence', () => {
  const installer = readFileSync(new URL('../../scripts/windows/install-battle-bridge-github-sync.ps1', import.meta.url), 'utf8');
  const bootstrap = buildFixedBattleBridgeBootstrapPowerShell(HEAD);
  const trigger = installer.match(/-RepetitionInterval\s+\(New-TimeSpan\s+-Minutes\s+(\d+)\)/);
  const receipt = installer.match(/^\s*intervalMinutes\s*=\s*(\d+)\s*$/m);
  const expected = bootstrap.match(/\[int\]\$installerReceipt\.intervalMinutes\s+-ne\s+(\d+)/);
  assert.ok(trigger, 'canonical installer must retain a fixed repetition interval');
  assert.ok(receipt, 'canonical installer must report its fixed cadence');
  assert.ok(expected, 'bootstrap must retain an exact cadence receipt gate');
  assert.equal(Number(trigger[1]), 1, 'canonical sync remains a one-minute task');
  assert.equal(Number(receipt[1]), Number(trigger[1]), 'receipt must describe the actual scheduled cadence');
  assert.equal(Number(expected[1]), Number(receipt[1]), 'bootstrap must accept its canonical installer receipt');
});

test('bootstrap adapter rejects a superseding main through the real canonical sync chain before preservation', async () => {
  const previousHead = 'b'.repeat(40);
  const supersedingHead = 'c'.repeat(40);
  const calls = [];
  const replies = new Map([
    ['branch --show-current', 'main'],
    ['rev-parse HEAD', previousHead],
    ['status --porcelain=v1 --untracked-files=all', ''],
    ['rev-parse --show-toplevel', DEFAULT_CODEX_DISPATCH_REPO_ROOT],
    ['remote get-url origin', 'https://github.com/Cheekyfellastef/stephan-os.git'],
    ['fetch origin main', ''],
    ['rev-parse origin/main', supersedingHead],
    [`rev-list --left-right --count HEAD...${supersedingHead}`, '0\t1'],
  ]);
  const result = await executeExactHeadBattleBridgePreservationSync(HEAD, {
    executeCommand: (command) => executeBattleBridgeGitHubCommand(command, {
      spawnSyncFn: (executable, args) => {
        assert.equal(executable, 'git', 'the blocked path must not reach a process beyond mocked Git reads');
        const key = args.join(' ');
        calls.push(key);
        assert.ok(replies.has(key), `unexpected Git operation: ${key}`);
        return { status: 0, stdout: replies.get(key), stderr: '' };
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'REMOTE_STATE_READ_FAILED');
  assert.equal(calls.filter((call) => call === 'rev-parse HEAD').length, 1, 'preservation entry must not be reached');
  assert.equal(calls.some((call) => call.startsWith('merge ')), false);
  assert.notEqual(result.exactHeadBound, true);
});

test('bootstrap retains actual six-file preservation after later verification fails', async () => {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), 'stephanos-bootstrap-preservation-'));
  const repoRoot = path.join(fixtureRoot, 'repo');
  const workspaceRoot = path.join(fixtureRoot, 'workspace');
  let syncResult;
  let statusReads = 0;
  try {
    await mkdir(repoRoot);
    await mkdir(workspaceRoot);
    for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
      const filePath = path.join(repoRoot, relativePath);
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, `${JSON.stringify({ relativePath })}\n`);
    }
    const result = await executeExactHeadBattleBridgePreservationSync(HEAD, {
      executeCommand: (command) => executeBattleBridgeGitHubCommand(command, {
        spawnSyncFn: (executable, args) => {
          if (executable !== 'git') {
            assert.equal(executable, process.execPath);
            assert.equal(args[0], '--test');
            return { status: 1, stdout: 'TAP version 13\nnot ok 1 - simulated verification failure\n1..1\n# tests 1\n# pass 0\n# fail 1\n', stderr: '' };
          }
          const key = args.join(' ');
          if (key === 'status --porcelain=v1 --untracked-files=all') {
            statusReads += 1;
            return { status: 0, stdout: statusReads === 1 ? BATTLE_BRIDGE_RUNTIME_DATA_PATHS.map((item) => `?? ${item}`).join('\n') : '', stderr: '' };
          }
          const replies = new Map([
            ['branch --show-current', 'main'],
            ['rev-parse HEAD', HEAD],
            ['rev-parse --show-toplevel', repoRoot],
            ['remote get-url origin', 'https://github.com/Cheekyfellastef/stephan-os.git'],
            ['fetch origin main', ''],
            ['rev-parse origin/main', HEAD],
            [`rev-list --left-right --count HEAD...${HEAD}`, '0\t0'],
          ]);
          assert.ok(replies.has(key), `unexpected Git operation: ${key}`);
          return { status: 0, stdout: replies.get(key), stderr: '' };
        },
        syncCodexDispatchBridgeFn: (options) => {
          syncResult = syncCodexDispatchBridge({
            ...options, repoRoot, workspaceRoot,
            expectedPreservationPaths: { repoRoot, workspaceRoot },
            nowFn: () => NOW,
          });
          return syncResult;
        },
      }),
    });
    assert.equal(syncResult.preservation.fileMovePerformed, true);
    assert.equal(syncResult.preservation.receipt.itemCount, 6);
    assert.equal(syncResult.preservation.receipt.allHashesVerified, true);
    for (const relativePath of BATTLE_BRIDGE_RUNTIME_DATA_PATHS) {
      await assert.rejects(readFile(path.join(repoRoot, relativePath)), { code: 'ENOENT' });
      assert.equal(await readFile(path.join(syncResult.preservation.preservationRoot, relativePath), 'utf8'), `${JSON.stringify({ relativePath })}\n`);
    }
    assert.equal(result.ok, false);
    assert.equal(result.blocker, 'POST_SYNC_VERIFICATION_TEST_FAILURE');
    assert.equal(result.fileMovePerformed, true, 'failure must retain the actual preserved-file moves');
    assert.equal(result.destructiveCleanupPerformed, false);
    assert.notEqual(result.exactHeadBound, true);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

test('post-execution effect projection preserves true and keeps absent evidence unknown', async () => {
  const cases = [
    { name: 'absent failed response', response: undefined, moved: null, cleanup: null },
    { name: 'absent invalid proof', response: { ok: true, preservationSync: { ok: true } }, moved: null, cleanup: null },
    { name: 'explicit known false', response: { ok: false, result: { fileMovePerformed: false, destructiveCleanupPerformed: false } }, moved: false, cleanup: false },
    {
      name: 'nested true dominates contradictory false',
      response: { ok: false, fileMovePerformed: false, destructiveCleanupPerformed: false, result: { fileMovePerformed: false, preservation: { fileMovePerformed: true, destructiveCleanupPerformed: true } }, preservationSync: { fileMovePerformed: false, destructiveCleanupPerformed: false } },
      moved: true, cleanup: true,
    },
    {
      name: 'outer true remains observable',
      response: { ok: false, fileMovePerformed: true, destructiveCleanupPerformed: true, result: { preservation: { fileMovePerformed: false, destructiveCleanupPerformed: false } } },
      moved: true, cleanup: true,
    },
    {
      name: 'preservationSync evidence survives invalid proof',
      response: { ok: true, result: { fileMovePerformed: false }, preservationSync: { ok: true, afterHead: 'b'.repeat(40), preservation: { fileMovePerformed: true, destructiveCleanupPerformed: false } } },
      moved: true, cleanup: false,
    },
  ];
  for (const { name, response, moved, cleanup } of cases) {
    const result = await executeExactHeadBattleBridgePreservationSync(HEAD, { executeCommand: async () => response });
    assert.equal(result.ok, false, name);
    assert.equal(result.fileMovePerformed, moved, name);
    assert.equal(result.destructiveCleanupPerformed, cleanup, name);
    assert.notEqual(result.exactHeadBound, true, name);
  }
});

test('contradictory destructive-cleanup evidence cannot yield an accepted bootstrap proof', async () => {
  const result = await executeExactHeadBattleBridgePreservationSync(HEAD, {
    executeCommand: async () => ({
      ok: true,
      result: { destructiveCleanupPerformed: true },
      preservationSync: {
        ok: true,
        afterHead: HEAD,
        destructiveCleanupPerformed: false,
        preservation: { ok: true, fileMovePerformed: true, destructiveCleanupPerformed: false, receipt: { itemCount: 6, allHashesVerified: true } },
      },
    }),
  });
  assert.equal(result.ok, false);
  assert.equal(result.blocker, 'EXACT_HEAD_PRESERVATION_SYNC_INVALID');
  assert.equal(result.fileMovePerformed, true);
  assert.equal(result.destructiveCleanupPerformed, true);
  assert.notEqual(result.exactHeadBound, true);
});

test('receipt validation requires preservation proof, exact head and bounded safety posture', () => {
  const receipt = {
    schemaVersion: 'stephanos.battle-bridge-tailscale-bootstrap-receipt.v1',
    repository: 'Cheekyfellastef/stephan-os',
    taskName: 'Stephanos Battle Bridge GitHub Sync',
    expectedHead: HEAD,
    observedHead: HEAD,
    taskInstalled: true,
    taskState: 'Ready',
    lastTaskResult: 0,
    preservationProfile: 'battle-bridge-runtime-data-v1',
    preservationItemCount: 6,
    preservationHashesVerified: true,
    codexRequired: false,
    arbitraryCommandAllowed: false,
    arbitraryPathAllowed: false,
    arbitraryTaskNameAllowed: false,
    sourceMutationOutsideCanonicalSyncAllowed: false,
    destructiveGitAllowed: false,
    pcRestartAllowed: false,
    finalVerdict: BATTLE_BRIDGE_TAILSCALE_BOOTSTRAP_VERDICT,
  };
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt(receipt, HEAD), true);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, observedHead: 'b'.repeat(40) }, HEAD), false);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, preservationItemCount: 5 }, HEAD), false);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, preservationHashesVerified: false }, HEAD), false);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, codexRequired: true }, HEAD), false);
  assert.equal(validateBattleBridgeTailscaleBootstrapReceipt({ ...receipt, destructiveGitAllowed: true }, HEAD), false);
});
