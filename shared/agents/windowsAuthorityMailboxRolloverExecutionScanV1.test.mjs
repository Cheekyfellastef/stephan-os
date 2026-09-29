import assert from 'node:assert/strict';
import test from 'node:test';

import { hasForbiddenMailboxInstallerExecutionForTest } from './windowsAuthoritySpecialistReviewV1.mjs';

test('mailbox rollover execution scan ignores descriptive Git prose', () => {
  assert.equal(hasForbiddenMailboxInstallerExecutionForTest("-Description 'No arbitrary shell, destructive Git, merge, push, or live OpenClaw update.'"), false);
});

test('mailbox rollover execution scan still rejects real source-control command execution', () => {
  assert.equal(hasForbiddenMailboxInstallerExecutionForTest('git status'), true);
  assert.equal(hasForbiddenMailboxInstallerExecutionForTest('& git.exe status'), true);
  assert.equal(hasForbiddenMailboxInstallerExecutionForTest('if ($true) { git rev-parse HEAD }'), true);
  assert.equal(hasForbiddenMailboxInstallerExecutionForTest('gh pr view 2164'), true);
});

test('mailbox rollover execution scan still rejects generic process and shell execution', () => {
  assert.equal(hasForbiddenMailboxInstallerExecutionForTest('Start-Process powershell.exe'), true);
  assert.equal(hasForbiddenMailboxInstallerExecutionForTest('Invoke-Expression $command'), true);
  assert.equal(hasForbiddenMailboxInstallerExecutionForTest('cmd.exe /c whoami'), true);
});
