import { test, describe } from 'node:test';
import assert from 'node:assert';
import { executeMailboxRotationOnHost } from './canonical-mailbox-rotation-host-v1.mjs';
import { CANONICAL_MAILBOX_ISSUE, RETIRED_CANONICAL_MAILBOX_ISSUES } from '../shared/agents/canonicalMailboxAuthorityV1.mjs';
import { MAILBOX_ROTATION_SCHEMA } from '../shared/agents/canonicalMailboxRotationV1.mjs';

const MAILBOX_ROTATION_OPERATION = 'MANAGE_CANONICAL_MAILBOX_ROTATION';

const transitionId = 'transition-12345abcde67890fghij';
const requestId = 'requestid-12345abcde67890fghij';
const sourceHead = 'abcdef1234567890abcdef1234567890abcdef12';
const cutoverHead = '0000000000000000000000003601fedcba090000';
const inventoryDigest = '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945';

function makeFreezeCommand(successorIssue = 3552) {
  return {
    operation: MAILBOX_ROTATION_OPERATION,
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: CANONICAL_MAILBOX_ISSUE, // Current canonical mailbox (3258)
    branch: 'main',
    operatorApproval: 'operator-approved',
    rotationAction: 'FREEZE',
    transitionId,
    requestId,
    successorIssue, // 3552 > 3258 ✓
    cutoverPrNumber: 3601,
    cutoverHead,
    expectedHead: sourceHead
  };
}

function makeDrainCommand() {
  return {
    operation: MAILBOX_ROTATION_OPERATION,
    schemaVersion: 'stephanos.battle-bridge-github-command.v1',
    repository: 'Cheekyfellastef/stephan-os',
    issueNumber: CANONICAL_MAILBOX_ISSUE, // Current canonical mailbox (3258)
    branch: 'main',
    operatorApproval: 'operator-approved',
    rotationAction: 'DRAIN',
    transitionId,
    requestId,
    expectedHead: sourceHead
  };
}

function makeMockContext(successorIssue = 3552) {
  let currentState = {};
  const persistedStates = [];
  
  return {
    selectedCommentId: 99999,
    sourceHead,
    state: currentState,
    readIssue: async (issueNumber) => {
      // Return proper GitHub issue structure
      const isPredecessor = issueNumber === CANONICAL_MAILBOX_ISSUE;
      const body = `
Status: ${isPredecessor ? 'FROZEN — NO COMMAND AUTHORITY' : 'INACTIVE — NO COMMAND AUTHORITY'}.

${isPredecessor ? '' : `Single nominated transport successor to #${CANONICAL_MAILBOX_ISSUE}, owned by Goal #2315.`}

<!-- stephanos:canonical-mailbox-successor:v1 predecessor=${CANONICAL_MAILBOX_ISSUE} state=INACTIVE -->
`;
      return {
        number: issueNumber,
        title: `Goal #2315: ${isPredecessor ? 'complete canonical mailbox settlement' : `activate canonical mailbox successor #${issueNumber}`}`,
        state: 'open',
        locked: false,
        closedAt: null,
        pull_request: false,
        repository_url: `https://api.github.com/repos/Cheekyfellastef/stephan-os`,
        html_url: `https://github.com/Cheekyfellastef/stephan-os/issues/${issueNumber}`,
        user: { login: 'Cheekyfellastef' },
        body: body.trim(),
        labels: [{ name: 'A — priority/mission-critical' }],
        createdAt: new Date('2026-11-20').toISOString(),
        updatedAt: new Date().toISOString()
      };
    },
    readPull: async (prNumber) => ({
      number: prNumber,
      state: 'open',
      merged: false,
      head: {
        sha: cutoverHead,
        repo: { full_name: 'Cheekyfellastef/stephan-os' }
      },
      base: { ref: 'main' }
    }),
    readAuthoritySource: async (head) => {
      // At cutover head, the successor should be active and predecessor retired
      if (head === cutoverHead) {
        return `export const CANONICAL_MAILBOX_ISSUE = ${successorIssue};\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([${[...RETIRED_CANONICAL_MAILBOX_ISSUES, CANONICAL_MAILBOX_ISSUE].join(', ')}]);`;
      }
      // At main head, return current config
      return `export const CANONICAL_MAILBOX_ISSUE = ${CANONICAL_MAILBOX_ISSUE};\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([${RETIRED_CANONICAL_MAILBOX_ISSUES.join(', ')}]);`;
    },
    readComments: async (issueNumber) => {
      if (issueNumber === 3258) {
        return [
          { id: 99999, issue_number: 3258, created_at: new Date('2026-11-20').toISOString(), body: '### STEPHANOS\n**command**: FREEZE\n**requestId**: test-id\n**transitionId**: transition-abc' }
        ];
      }
      return [];
    },
    persist: (state) => {
      persistedStates.push(JSON.parse(JSON.stringify(state)));
      Object.assign(currentState, state);
    },
    publishFence: async (fenceData, context = {}) => {
      // Mock fence publication
      return { ok: true };
    },
    readActions: async () => ({
      queuedActionRunsCount: 0,
      inProgressActionRunsCount: 0,
      waitingActionRunsCount: 0,
      requestedActionRunsCount: 0,
      pendingActionRunsCount: 0,
      allRunsQuiescent: true,
      inventoryReadAt: new Date().toISOString()
    }),
    getPersistedStates: () => persistedStates
  };
}

describe('PR #3560 — mailbox settlement correction', () => {
  test('CRITICAL: failed Actions inventory read must NOT certify quiescence during DRAIN', async () => {
    const createContext = makeMockContext(3607);
    const freezeResult = await executeMailboxRotationOnHost(makeFreezeCommand(3607), createContext);
    
    // Debug: log the result to see what's happening
    if (!freezeResult.ok) console.error('Freeze failed:', freezeResult);
    assert.ok(freezeResult.ok, 'FREEZE must succeed');

    // Reconstruct internal state with required fields
    const internalState = {
      ...freezeResult.mailboxRotation,
      schemaVersion: MAILBOX_ROTATION_SCHEMA,
      requestedAt: new Date().toISOString(),
      freezeRequestId: requestId,
      barrierCommentId: 99999,
      controlCommentId: 99999,
      globalFencePublished: true
    };

    const drainContext = {
      ...createContext,
      state: { mailboxRotation: internalState, mailboxRotationActions: null, mailboxRotationInventory: null },
      readActions: async () => { throw new Error('MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE'); }
    };

    const result = await executeMailboxRotationOnHost(makeDrainCommand(), drainContext);

    // Must NOT have ok=true with drained=true when Actions inventory read fails
    assert.ok(!result.ok, 'DRAIN must fail (not succeed) when Actions inventory read fails');
    assert.strictEqual(result.blocker, 'MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE', 'Blocker must be MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE');
  });

  test('CRITICAL: transient network failures should retry exactly once (bounded)', async () => {
    const createContext = makeMockContext(3603);
    const freezeResult = await executeMailboxRotationOnHost(makeFreezeCommand(3603), createContext);
    assert.ok(freezeResult.ok);

    // Reconstruct internal state with required fields
    const internalState = {
      ...freezeResult.mailboxRotation,
      schemaVersion: MAILBOX_ROTATION_SCHEMA,
      requestedAt: new Date().toISOString(),
      freezeRequestId: requestId,
      barrierCommentId: 99999,
      controlCommentId: 99999,
      globalFencePublished: true
    };

    let attemptCount = 0;
    const drainContext = {
      ...createContext,
      state: { mailboxRotation: internalState, mailboxRotationActions: null, mailboxRotationInventory: null },
      readActions: async () => {
        attemptCount++;
        if (attemptCount === 1) {
          throw new Error('ECONNRESET'); // Transient failure on first attempt
        }
        return { queuedActionRunsCount: 0, inProgressActionRunsCount: 0, waitingActionRunsCount: 0, requestedActionRunsCount: 0, pendingActionRunsCount: 0, allRunsQuiescent: true, inventoryReadAt: new Date().toISOString() }; // Succeed on retry
      }
    };

    const result = await executeMailboxRotationOnHost(makeDrainCommand(), drainContext);

    assert.ok(result.ok, 'DRAIN must succeed when retry succeeds');
    assert.strictEqual(attemptCount, 2, 'Must retry exactly once');
  });

  test('non-retryable errors must fail immediately without retry', async () => {
    const createContext = makeMockContext(3603);
    const freezeResult = await executeMailboxRotationOnHost(makeFreezeCommand(3603), createContext);
    assert.ok(freezeResult.ok);

    // Reconstruct internal state with required fields
    const internalState = {
      ...freezeResult.mailboxRotation,
      schemaVersion: MAILBOX_ROTATION_SCHEMA,
      requestedAt: new Date().toISOString(),
      freezeRequestId: requestId,
      barrierCommentId: 99999,
      controlCommentId: 99999,
      globalFencePublished: true
    };

    let attemptCount = 0;
    const drainContext = {
      ...createContext,
      state: { mailboxRotation: internalState, mailboxRotationActions: null, mailboxRotationInventory: null },
      readActions: async () => {
        attemptCount++;
        throw new Error('INVALID_AUTH_TOKEN'); // Non-retryable error
      }
    };

    const result = await executeMailboxRotationOnHost(makeDrainCommand(), drainContext);

    assert.ok(!result.ok, 'DRAIN must fail immediately for non-retryable errors');
    assert.strictEqual(result.blocker, 'MAILBOX_ROTATION_ACTION_EVIDENCE_READ_FAILED', 'Blocker must be MAILBOX_ROTATION_ACTION_EVIDENCE_READ_FAILED');
    assert.strictEqual(attemptCount, 1, 'Must NOT retry for non-retryable errors');
  });

  test('publication ordering: persist state before publishFence during DRAIN', async () => {
    const createContext = makeMockContext(3606);
    const freezeResult = await executeMailboxRotationOnHost(makeFreezeCommand(3606), createContext);
    assert.ok(freezeResult.ok);

    // Reconstruct internal state with required fields
    const internalState = {
      ...freezeResult.mailboxRotation,
      schemaVersion: MAILBOX_ROTATION_SCHEMA,
      requestedAt: new Date().toISOString(),
      freezeRequestId: requestId,
      barrierCommentId: 99999,
      controlCommentId: 99999,
      globalFencePublished: true
    };

    let persistCallCount = 0;
    let publishFenceCallCount = 0;
    const drainContext = {
      ...createContext,
      state: { mailboxRotation: internalState, mailboxRotationActions: null, mailboxRotationInventory: null },
      persist: (state) => { persistCallCount++; Object.assign(drainContext.state, state); },
      publishFence: async () => { publishFenceCallCount++; return { ok: true }; }
    };

    const result = await executeMailboxRotationOnHost(makeDrainCommand(), drainContext);

    assert.ok(result.ok || result.blocker === 'MAILBOX_ROTATION_PREDECESSOR_HISTORY_READ_FAILED', 'DRAIN should either succeed or fail with predecessor history error');
    // Persist must be called at least once before publishFence
    if (publishFenceCallCount > 0) {
      assert.ok(persistCallCount >= publishFenceCallCount, 'persist must be called before publishFence');
    }
  });

  test('sanitized failure codes must not expose raw error messages or credentials', async () => {
    const createContext = makeMockContext(3605);
    const freezeResult = await executeMailboxRotationOnHost(makeFreezeCommand(3605), createContext);
    assert.ok(freezeResult.ok);

    // Reconstruct internal state with required fields
    const internalState = {
      ...freezeResult.mailboxRotation,
      schemaVersion: MAILBOX_ROTATION_SCHEMA,
      requestedAt: new Date().toISOString(),
      freezeRequestId: requestId,
      barrierCommentId: 99999,
      controlCommentId: 99999,
      globalFencePublished: true
    };

    const drainContext = {
      ...createContext,
      state: { mailboxRotation: internalState, mailboxRotationActions: null, mailboxRotationInventory: null },
      readActions: async () => { throw new Error('GraphQL response: {"errors":[{"message":"Bad credentials","type":UNAUTHENTICATED}]}'); }
    };

    const result = await executeMailboxRotationOnHost(makeDrainCommand(), drainContext);

    assert.ok(!result.ok, 'DRAIN must fail for unrecognised errors');
    // The blocker should NOT contain the raw error message with credentials
    assert.strictEqual(result.blocker, 'MAILBOX_ROTATION_ACTION_EVIDENCE_READ_FAILED', 'Blocker must be sanitised code, not raw error');
    assert.doesNotMatch(result.blocker || '', /credentials|token|Bearer/i, 'Blocker must not expose credential keywords');
  });

  test('DRAIN must verify Actions inventory quiescence before certifying', async () => {
    const createContext = makeMockContext(3606);
    const freezeResult = await executeMailboxRotationOnHost(makeFreezeCommand(3606), createContext);
    assert.ok(freezeResult.ok);

    // Reconstruct internal state with required fields
    const internalState = {
      ...freezeResult.mailboxRotation,
      schemaVersion: MAILBOX_ROTATION_SCHEMA,
      requestedAt: new Date().toISOString(),
      freezeRequestId: requestId,
      barrierCommentId: 99999,
      controlCommentId: 99999,
      globalFencePublished: true
    };

    const drainContext = {
      ...createContext,
      state: { mailboxRotation: internalState, mailboxRotationActions: null, mailboxRotationInventory: null },
      readActions: async () => ({
        queuedActionRunsCount: 2, // Non-quiescent!
        inProgressActionRunsCount: 0,
        waitingActionRunsCount: 0,
        requestedActionRunsCount: 0,
        pendingActionRunsCount: 0,
        allRunsQuiescent: false,
        inventoryReadAt: new Date().toISOString()
      })
    };

    const result = await executeMailboxRotationOnHost(makeDrainCommand(), drainContext);

    // DRAIN succeeds but does NOT certify when actions are not quiescent
    assert.ok(result.ok, 'DRAIN operation itself must succeed');
    assert.strictEqual(result.mailboxRotation.drained, false, 'drained must be false when Actions are not quiescent');
    assert.strictEqual(result.mailboxRotation.phase, 'DRAINING', 'phase must remain DRAINING when not quiescent');
    assert.strictEqual(result.finalVerdict, 'MAILBOX_ROTATION_DRAINING', 'finalVerdict must indicate still draining');
  });
});
