# Stephanos Memory Archive Index and Restore Plan V1

## Outcome

This contract advances memory portability and recovery under #1645 without adding another memory store or granting archive/restore execution authority. It creates two deterministic read-only products:

1. a bounded, metadata-only archive index with a canonical SHA-256 manifest digest; and
2. a restore plan that classifies archived records against a current memory snapshot without writing anything.

The contract is intentionally narrower than a backup engine. It does not copy memory payloads, create archives, delete records, write restored records, reconcile Shared Workspace state, or claim a restore has happened.

## Archive index boundary

The archive index contains only allowlisted metadata required to find, explain and verify a record later: identity, namespace/type/cognitive class, authority, current-vs-historical state, timestamps, supersession links, source/proof references, bounded tags and relationship keys, content digest, sensitivity classification and retention disposition.

Raw content, prompts, responses, unrestricted logs, credentials, sessions, cookies and local paths are not archive-index fields. Sensitive classifications may remain visible only as metadata and are marked `sensitiveContentOmitted=true`.

Indexes are deterministic, record-id sorted, bounded to 256 entries and 512 KiB, and hashed over canonical JSON metadata. Duplicate identities with conflicting digest/state/authority fail closed.

## Restore planning boundary

A restore plan never means restoration is authorized or executed. Each archived identity receives exactly one disposition:

- `RESTORE_CANDIDATE` — missing current record with sufficient archive authority;
- `RETAIN_TOMBSTONE` — forgotten/deleted state remains authoritative metadata and payload must not be resurrected;
- `SKIP_ALREADY_PRESENT` — same digest/state already exists;
- `SKIP_SUPERSEDED` — archived history is superseded or expired;
- `HOLD_CONFLICT` — current identity exists with different digest/state and requires adjudication;
- `HOLD_AUTHORITY` — local mirror, pending intent, inference or unknown authority cannot establish canonical memory;
- `HOLD_SENSITIVE` — sensitive/omitted material is not eligible for automatic restore.

A current tombstone always outranks archived content. Current supersession always outranks historical archive state. A model or local mirror cannot use archive recovery to promote itself into shared authority.

## Hostile-input and integrity boundary

Public inputs must be plain data records and dense standard arrays. Accessors, symbols, sparse arrays, custom prototypes, unexpected fields, malformed dates, unsafe identities, malformed digests, oversized collections and conflicting duplicate IDs fail closed. Restore planning verifies the archive manifest digest before making any classification.

## Authority boundary

The contract grants no authority to mutate source, write/promote/correct/delete/forget memory, compact, archive, restore, evict, send provider context, execute commands, approve, merge, deploy or mutate a runtime.

A later implementation may consume `RESTORE_CANDIDATE` only through the existing governed memory authority and adjudication path. Live export/import, encrypted backup storage, Shared Workspace reconciliation, actual restore execution and restore testing remain later separately governed acceptance work.
