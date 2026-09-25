import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createSanitizedMailboxReceiptProjection } from '../scripts/battle-bridge-github-command-mailbox.mjs';

const root = resolve(process.cwd());
const navigation = readFileSync(resolve(root, 'scripts/windows/codex-banked-reset-ui-navigation.psm1'), 'utf8');

test('profile lookup failure records bounded structural discovery evidence without adding an invocation route', () => {
  assert.match(navigation, /profile-control-discovery-snapshot/);
  assert.match(navigation, /profileDiscoveryCandidates\.Count -ge 12/);
  assert.match(navigation, /ControlType\\\.\(Button\|MenuItem\|Hyperlink\|ListItem\|Custom\|Group\)/);
  assert.match(navigation, /profileDiagnosticForbidden/);
  assert.match(navigation, /size=/);
  assert.match(navigation, /profileCandidates = @\(\$profileDiscoveryCandidates\)/);

  const failureStart = navigation.indexOf('if (-not $profileSelection.Ok)');
  const failureEnd = navigation.indexOf('$profileControl = $profileSelection.Selected');
  const failurePath = navigation.slice(failureStart, failureEnd);
  assert.doesNotMatch(failurePath, /Invoke-CodexUiElement/);
});

test('mailbox receipt projection carries only bounded sanitized Codex navigation diagnostics', () => {
  const projection = createSanitizedMailboxReceiptProjection({
    schemaVersion: 'stephanos.battle-bridge-github-command-receipt.v1',
    requestId: 'profile-discovery-test-v1',
    operation: 'READ_CODEX_BANKED_RESET_STATUS',
    state: 'BLOCKED',
    result: {
      result: {
        ok: false,
        blocker: 'BLOCKED_RESET_PROFILE_CONTROL_NOT_FOUND',
        finalVerdict: 'CODEX_BANKED_RESET_STATUS_BLOCKED',
        matchedWindow: 'ChatGPT',
        navigationAttempted: true,
        desktopInteractive: true,
        appWindowFound: true,
        usageSurfaceMatched: false,
        profileCandidates: [
          'type=ControlType.Custom | size=36x36 | id=account-avatar',
          'type=ControlType.Button | size=32x32 | name=Profile',
        ],
      },
    },
  });

  assert.equal(projection.operationResult.matchedWindow, 'ChatGPT');
  assert.equal(projection.operationResult.navigationAttempted, true);
  assert.equal(projection.operationResult.desktopInteractive, true);
  assert.equal(projection.operationResult.appWindowFound, true);
  assert.equal(projection.operationResult.usageSurfaceMatched, false);
  assert.deepEqual(projection.operationResult.profileCandidates, [
    'type=ControlType.Custom | size=36x36 | id=account-avatar',
    'type=ControlType.Button | size=32x32 | name=Profile',
  ]);
});
