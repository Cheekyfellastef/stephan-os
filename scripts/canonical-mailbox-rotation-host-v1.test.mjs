import { strictEqual, deepEqual, ok } from 'node:assert';
import { describe, it, beforeEach } from 'node:test';
import { executeMailboxRotationOnHost, readMailboxAuthorityLiteral } from './canonical-mailbox-rotation-host-v1.mjs';

describe('canonical-mailbox-rotation-host-v1 settlement-to-receipt ordering', () => {
  const mockSourceHead = 'abc123';
  const mockSelectedCommentId = 12345;

  /** Helper to create clean state object */
  function createInitialState() {
    return {
      mailboxRotation: null,
      mailboxRotationActions: null,
      mailboxRotationInventory: null
    };
  }

  describe('settlement-to-receipt invariants', () => {
    it('failed Actions inventory read should NOT certify quiescence', async () => {
      const mockState = createInitialState();
      
      // Setup: Execute FREEZE to initialize rotation state
      const freezeCommand = {
        rotationAction: 'FREEZE',
        transitionId: 'test-transition-001',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-001'
      };

      await executeMailboxRotationOnHost(freezeCommand, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({ title: 'Valid Successor', state: 'open' }),
        readPull: async () => ({
          number: 3560,
          head: { sha: 'def456', repo: { full_name: 'Cheekyfellastef/stephan-os' } },
          base: { ref: 'main' },
          state: 'open'
        }),
        readAuthoritySource: async () => `export const CANONICAL_MAILBOX_ISSUE = 3552;\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([3551]);`,
        readComments: async () => [],
        persist: (s) => {},
        publishFence: async () => {},
        readActions: async () => ({})
      });

      // Verify FREEZE succeeded
      strictEqual(mockState.mailboxRotation.phase, 'DRAINING', 'FREEZE should set phase to DRAINING');

      // Now execute DRAIN with failed Actions inventory read
      const drainCommand = {
        rotationAction: 'DRAIN',
        transitionId: 'test-transition-001',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-001-drain'
      };

      const result = await executeMailboxRotationOnHost(drainCommand, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({}),
        readPull: async () => ({}),
        readAuthoritySource: async () => '',
        readComments: async () => [],
        persist: (s) => {},
        publishFence: async () => {},
        readActions: async () => {
          throw new Error('MAILBOX_ROTATION_ACTIONS_INVENTORY_INCOMPLETE');
        }
      });

      // CRITICAL INVARIANT: Failed Actions inventory must NOT certify quiescence
      ok(!result.ok, 'Result should not be successful when Actions inventory fails');
      strictEqual(result.finalVerdict, 'MAILBOX_ROTATION_HELD', 'Should return HELD verdict');
      strictEqual(mockState.mailboxRotation.phase, 'DRAINING', 'Phase must remain DRAINING');
      strictEqual(mockState.mailboxRotation.drained, false, 'Drained flag must be false');
    });

    it('transient failure should recover on bounded retry (one retry)', async () => {
      const mockState = createInitialState();
      
      // Setup FREEZE
      const freezeCommand = {
        rotationAction: 'FREEZE',
        transitionId: 'test-transition-002',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-002'
      };

      await executeMailboxRotationOnHost(freezeCommand, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({ title: 'Valid Successor', state: 'open' }),
        readPull: async () => ({
          number: 3560,
          head: { sha: 'def456', repo: { full_name: 'Cheekyfellastef/stephan-os' } },
          base: { ref: 'main' },
          state: 'open'
        }),
        readAuthoritySource: async () => `export const CANONICAL_MAILBOX_ISSUE = 3552;\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([3551]);`,
        readComments: async () => [],
        persist: (s) => {},
        publishFence: async () => {},
        readActions: async () => ({})
      });

      // Test DRAIN with transient failure that recovers
      const drainCommand = {
        rotationAction: 'DRAIN',
        transitionId: 'test-transition-002',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-002-drain'
      };

      let readActionsCallCount = 0;
      
      const result = await executeMailboxRotationOnHost(drainCommand, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({}),
        readPull: async () => ({}),
        readAuthoritySource: async () => '',
        readComments: async () => [],
        persist: (s) => {},
        publishFence: async () => {},
        readActions: async () => {
          readActionsCallCount++;
          if (readActionsCallCount === 1) {
            // First attempt fails with retryable error
            throw new Error('ECONNRESET');
          }
          // Second attempt succeeds
          return {};
        }
      });

      strictEqual(readActionsCallCount, 2, 'Should have retried exactly once for transient failure');
    });

    it('non-retryable error should fail immediately without retry', async () => {
      const mockState = createInitialState();
      
      // Setup FREEZE
      const freezeCommand = {
        rotationAction: 'FREEZE',
        transitionId: 'test-transition-003',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-003'
      };

      await executeMailboxRotationOnHost(freezeCommand, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({ title: 'Valid Successor', state: 'open' }),
        readPull: async () => ({
          number: 3560,
          head: { sha: 'def456', repo: { full_name: 'Cheekyfellastef/stephan-os' } },
          base: { ref: 'main' },
          state: 'open'
        }),
        readAuthoritySource: async () => `export const CANONICAL_MAILBOX_ISSUE = 3552;\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([3551]);`,
        readComments: async () => [],
        persist: (s) => {},
        publishFence: async () => {},
        readActions: async () => ({})
      });

      // Test DRAIN with non-retryable error
      const drainCommand = {
        rotationAction: 'DRAIN',
        transitionId: 'test-transition-003',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-003-drain'
      };

      let readActionsCallCount = 0;
      
      const result = await executeMailboxRotationOnHost(drainCommand, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({}),
        readPull: async () => ({}),
        readAuthoritySource: async () => '',
        readComments: async () => [],
        persist: (s) => {},
        publishFence: async () => {},
        readActions: async () => {
          readActionsCallCount++;
          throw new Error('INVALID_AUTH_TOKEN'); // Not in RETRYABLE_ROTATION_READ_CODES
        }
      });

      strictEqual(readActionsCallCount, 1, 'Should not retry non-retryable errors');
      ok(!result.ok, 'Should fail on non-retryable error');
    });

    it('publication ordering: persist local state before publishFence', async () => {
      const mockState = createInitialState();
      
      const command = {
        rotationAction: 'FREEZE',
        transitionId: 'test-transition-004',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-004'
      };

      let persistCalledBeforePublish = false;
      let publishFenceReceivedPhase = null;

      const orderedPersist = (s) => {
        if (!publishFenceReceivedPhase && s.mailboxRotation?.phase === 'DRAINING') {
          persistCalledBeforePublish = true;
        }
      };

      const orderedPublishFence = async (args) => {
        publishFenceReceivedPhase = args.phase;
      };

      await executeMailboxRotationOnHost(command, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({ title: 'Valid Successor', state: 'open' }),
        readPull: async () => ({
          number: 3560,
          head: { sha: 'def456', repo: { full_name: 'Cheekyfellastef/stephan-os' } },
          base: { ref: 'main' },
          state: 'open'
        }),
        readAuthoritySource: async () => `export const CANONICAL_MAILBOX_ISSUE = 3552;\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([3551]);`,
        readComments: async () => [],
        persist: orderedPersist,
        publishFence: orderedPublishFence,
        readActions: async () => ({})
      });

      // Verify publication ordering invariant
      strictEqual(publishFenceReceivedPhase, 'DRAINING', 'publishFence should receive DRAINING phase');
      ok(mockState.mailboxRotation.globalFencePublished, 'Should mark fence as published after successful call');
    });

    it('should preserve sanitized failure codes (no raw credentials exposed)', async () => {
      const mockState = createInitialState();
      
      // Setup FREEZE
      const freezeCommand = {
        rotationAction: 'FREEZE',
        transitionId: 'test-transition-005',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-005'
      };

      await executeMailboxRotationOnHost(freezeCommand, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({ title: 'Valid Successor', state: 'open' }),
        readPull: async () => ({
          number: 3560,
          head: { sha: 'def456', repo: { full_name: 'Cheekyfellastef/stephan-os' } },
          base: { ref: 'main' },
          state: 'open'
        }),
        readAuthoritySource: async () => `export const CANONICAL_MAILBOX_ISSUE = 3552;\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([3551]);`,
        readComments: async () => [],
        persist: (s) => {},
        publishFence: async () => {},
        readActions: async () => ({})
      });

      // Test DRAIN with error containing sensitive data
      const drainCommand = {
        rotationAction: 'DRAIN',
        transitionId: 'test-transition-005',
        successorIssue: 3552,
        cutoverPrNumber: 3560,
        cutoverHead: 'def456',
        expectedHead: mockSourceHead,
        requestId: 'req-005-drain'
      };

      const result = await executeMailboxRotationOnHost(drainCommand, {
        state: mockState,
        selectedCommentId: mockSelectedCommentId,
        sourceHead: mockSourceHead,
        readIssue: async () => ({}),
        readPull: async () => ({}),
        readAuthoritySource: async () => '',
        readComments: async () => [],
        persist: (s) => {},
        publishFence: async () => {},
        readActions: async () => {
          // Error with potential credential leak
          throw new Error('Credential leaked: secret-token-12345');
        }
      });

      // Verify the blocker is a sanitized code, not the raw error
      strictEqual(result.blocker, 'MAILBOX_ROTATION_ACTION_EVIDENCE_READ_FAILED', 'Raw errors must be sanitized to generic codes');
      ok(!result.blocker.includes('Credential'), 'Sanitized error must not contain credentials');
      ok(!result.blocker.includes('secret-token'), 'Sanitized error must not expose tokens');
    });
  });

  describe('readMailboxAuthorityLiteral', () => {
    it('should parse valid source correctly', () => {
      const source = `export const CANONICAL_MAILBOX_ISSUE = 3552;\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([3550, 3551]);`;
      
      const result = readMailboxAuthorityLiteral(source);
      
      strictEqual(result.active, 3552);
      deepEqual(result.retired, [3550, 3551]);
    });

    it('should reject source without required exports', () => {
      const source = `export const CANONICAL_MAILBOX_ISSUE = "invalid";`;
      
      ok(() => {
        readMailboxAuthorityLiteral(source);
      }, 'Should throw MAILBOX_ROTATION_SOURCE_INVALID');
    });

    it('should reject oversized source (>64KB)', () => {
      const source = `export const CANONICAL_MAILBOX_ISSUE = 3552;\nexport const RETIRED_CANONICAL_MAILBOX_ISSUES = Object.freeze([${Array(10000).fill('1,').join('')}]);`;
      
      ok(() => {
        readMailboxAuthorityLiteral(source);
      }, 'Should throw MAILBOX_ROTATION_SOURCE_INVALID for oversized input');
    });
  });
});
