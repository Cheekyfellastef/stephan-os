# Elastic five-lane proof cache shadow V1

Issue #1637 calls for cost and latency reduction without weakening proof. This bounded source-only slice defines when a deterministic proof could be reused in shadow. It creates no cache service, controller, worker, scheduler, queue, lease store or mutation path.

## Exact reuse identity

A reusable proof is valid only when every identity field is identical:

- repository, source commit and source tree;
- reusable proof class (`DETERMINISTIC_TEST` or `STATIC_ANALYSIS` only);
- test-definition version and SHA-256 digest;
- environment identity and SHA-256 digest;
- toolchain version and SHA-256 digest;
- policy version and SHA-256 digest;
- terminal result SHA-256 digest.

The receipt must be signed, successful, time-ordered and unexpired at observation. A changed identity field produces a cache miss and requires fresh proof. Two exact matches, duplicate cache keys, duplicate receipt IDs, forged records, hidden properties, hostile reflection or malformed arrays fail closed to `SAFE_HOLD`.

Operator approval, independent-review verdicts, deployment receipts and live-runtime acceptance are deliberately non-reusable. Their authority and freshness boundaries cannot be replaced by a proof cache.

## Authority boundary

The projection reports only `CACHE_HIT_SHADOW`, `CACHE_MISS_SHADOW` or `SAFE_HOLD`. Even an exact hit grants no cache read/write, proof execution, dispatch, source/runtime mutation, deployment, approval reuse, merge, controller transfer or five-lane cutover authority.

The current #1557 native controller remains canonical. This contract does not edit #1999's routing estate and does not make #1637 live. Real cache implementation, canonical storage, production admission, closed-chat execution, cutover and rollback proof remain separate gates.
