# Post-specialist preservation lineage V1

## Problem

A clean qualified specialist review can become unusable after ordinary non-force preservation convergence even when the reviewed feature blobs and source estate are unchanged. The current retry selector requires the specialist review commit and body to match the new convergence head/base literally, so the bounded post-specialist retry remains closed and repeats the same unsupported-high-risk-surface findings.

## Required repair

Reuse specialist evidence only when all of the following are proven from authoritative GitHub state:

- same PR and branch identity;
- prior specialist review is clean and trusted;
- prior reviewed head/base are explicit;
- current head is an ordinary preservation merge whose parents bind the reviewed feature head and current protected main;
- specialist-owned feature blobs are byte-identical to the reviewed head;
- changed source estate is unchanged for the specialist-covered paths;
- current base equals protected main;
- no authority, source, path, or risk widening occurred.

Absent any predicate, remain fail closed. This repair must not create a second review plane or widen retry count beyond the existing one post-specialist attempt.
