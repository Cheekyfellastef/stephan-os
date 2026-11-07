# Proof boundary

This lane intentionally starts regression-first. Until the production conveyor core changes, hosted proof is expected to fail on the new current-main admission tests. A green run without that production change is not acceptance.

After implementation, require focused tests plus the repository's ordinary exact-head hosted proof and independent review. Then exercise the existing #2158 Battle Bridge bootstrap/sync path and require physical #1622 acceptance. No source-only test can substitute for the live SELECT -> CLAIM -> SOURCE_CHANGED -> TESTED -> terminal receipt -> review handoff chain.
