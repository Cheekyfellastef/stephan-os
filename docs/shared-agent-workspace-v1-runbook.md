# Shared Agent Workspace V1 Runbook

This source slice adds the smallest filesystem-backed Shared Agent Workspace utilities for issue #1290.

## Safety boundaries

- Resolve a configured workspace root before writing.
- Refuse workspace roots inside the source repository.
- Create only the Shared Agent Workspace directory layout under the resolved workspace root.
- Reject traversal path segments and unsafe record identifiers.
- Reject records containing secret, env, token, session, key, cache, or log-shaped fields/values.
- Write JSON records with same-directory temp files followed by rename.
- Append JSONL events one validated record per line.
- Aggregate latest status read-only; aggregation does not claim live Battle Bridge proof or live Codex dispatch.

## OpenClaw capability default

OpenClaw is represented as `design_only` with `boundedWritePath` `/courier-open`, `trustedBuilder` `false`, no merge authority, and no arbitrary shell authority unless a future capability proof safely promotes it.

## Missing or stale capability records

- Missing capability record: `BLOCKED_BY_MISSING_CAPABILITY_RECORD`.
- Stale capability record: `NEEDS_CAPABILITY_REFRESH`.
- Stale non-capability records are classified as stale rather than guessed current.

## Focused tests

```bash
node --test shared/agents/sharedAgentWorkspaceStore.test.mjs
node --test shared/agents/*.test.mjs
```
