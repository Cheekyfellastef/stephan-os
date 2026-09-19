# Stephanos Memory Adequacy Evidence Collectors V1

## Outcome

This source slice fills the bounded collector gap left by merged #1648 without introducing external polling, another memory store or a second adequacy model. It converts already-observed evidence metadata into the observation shape consumed by Stephanos Memory Adequacy V1 for four missing families:

- GitHub goals, decisions and active PR evidence → `goal-decision-memory`;
- Mission Operations/runtime proof → `runtime-proof-memory`;
- lesson and continuity relationship edges → `lessons-incident-memory`;
- Shared Workspace receipt inventory/freshness evidence → `project-architecture-memory`.

The collector is a pure projection. It does not call GitHub, Shared Workspace or runtime endpoints itself.

## Authority preservation

Evidence carries the existing canonical Memory Adequacy authority class. The collector never upgrades it. When several records contribute to one family observation, the observation receives the weakest authority in that set. `UNKNOWN` therefore stays unknown and a local mirror prevents a mixed family from being presented as shared authority.

The oldest evidence timestamp is used for the family observation so stale coverage cannot be hidden behind a newer sibling record.

## Conservative lifecycle posture

Source presence alone never proves lifecycle adequacy. The collector leaves deletion, conflict convergence and backup state as `UNKNOWN`. Retention is only `DECLARED` when every contributing evidence item explicitly declares a retention policy; it is never promoted to `ENFORCED` here.

This allows the existing Memory Adequacy evaluator to combine source coverage with the separate retention, archive, correction/forget and cross-device proof contracts without circular self-certification.

## Bounded evidence only

Inputs are allowlisted metadata: evidence identity/family/subject/state, existing authority class, observation time, source, proof refs, relationship refs and a retention-declared boolean. Raw conversation content, payloads, prompts, responses, secrets and unrestricted logs are not accepted fields.

Proof refs use the existing Memory Adequacy proof-ref families and reject traversal or absolute-path shapes. Inputs are bounded, dense, plain data-only arrays/records; accessors, symbols, duplicates, future-dated evidence and unexpected fields fail closed.

## Authority boundary

The collector grants no source or memory mutation, authority upgrade, Shared Workspace/GitHub/runtime mutation, command, approval, merge or deployment authority. Live collectors that obtain these evidence records remain separately governed owners.
