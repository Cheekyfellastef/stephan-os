# Autonomy Gap Analysis V1

## Current capability

The project now has mission state, orchestration, live chat, return handling, update modeling, and runner classification.

The current stack can decide what should happen next.

## Gap

The stack cannot yet execute the final local Battle Bridge command sequence by itself.

The missing layer is a local executor bridge that can run a small approved set of commands, capture proof output, and return a transcript into Mission Operations.

## Required missing infrastructure

Battle Bridge Local Executor V1 should:

1. Receive a runner packet.
2. Verify repo path and branch.
3. Verify requested action is approved.
4. Run focused proof.
5. Capture stdout, stderr, exit code, cwd, branch, head, and timestamp.
6. Return the transcript to Return Conveyor and Mission Operations.
7. Block with exact action if the tree is dirty, a conflict exists, proof fails, head evidence is missing, or the command is not approved.

## Safety rules

- No arbitrary shell execution.
- No completion without proof pass.
- No completion with dirty working tree.
- No branch deletion unless the result is complete or duplicate-on-main is proven.
- Every blocked state must include exact unblock action.

## Conclusion

The runner classifier is the brain. The missing piece is the local hand.
