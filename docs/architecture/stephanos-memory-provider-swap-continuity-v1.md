# Stephanos Memory Provider-Swap Continuity Evaluation V1

## Outcome

This contract advances the cross-provider acceptance requirement in #1645. It answers one bounded question: when the conversational/model provider changes and no canonical memory change is being asserted, did Stephanos preserve the same identity, operator relationship reference, active intent/mission, memory authority, current thread and canonical memory record set?

It is an evaluator, not a model router, provider adapter, memory store or migration executor.

## Provider-neutral invariant

The provider is transport metadata only. A successful evaluation requires different `providerId` values before and after, while these canonical continuity fields remain invariant:

- Stephanos identity version;
- operator relationship context reference;
- active intent identity;
- active mission identity;
- canonical memory authority reference;
- execution surface;
- current surface thread reference; and
- the complete bounded canonical record inventory by record ID, content digest, state and authority class.

Canonical records are deterministically sorted before comparison, so provider-specific ordering cannot fabricate drift or continuity.

## Verdicts

- `PASS`: the provider changed while canonical identity, thread and memory remained invariant;
- `HOLD_NOT_A_SWAP`: provider identity did not actually change;
- `HOLD_AUTHORITY`: one side lacks authority-confirmed canonical memory evidence;
- `HOLD_EVIDENCE`: one side has no bounded proof references;
- `FAIL_IDENTITY_DRIFT`: Stephanos identity/relationship/intent/mission/memory-authority or surface changed;
- `FAIL_THREAD_DRIFT`: the current conversation thread changed;
- `FAIL_MEMORY_DRIFT`: canonical record identity, digest, state or authority changed.

A local mirror, pending intent, model inference or unknown authority cannot establish provider-swap continuity. Provider-specific summaries are deliberately outside the canonical memory comparison and may vary without becoming memory truth.

## Truth boundary

This source contract does not claim that a live provider swap occurred. It creates the deterministic proof shape needed for a later live acceptance round using two real provider observations with evidence references. A legitimate canonical correction or forget that occurs between observations must be evaluated as a separate governed memory change rather than hidden inside a provider swap.

## Authority boundary

Providers receive no canonical memory, identity or thread authority. The evaluator grants no source mutation, memory write, correction/forget, provider-prompt use, routing mutation, command execution, approval, merge, deployment or runtime authority.
