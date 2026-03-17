# Vite Entry Cleanup Report

## 1) Executive summary
Stephanos app validation and self-repair logic were cleaned up to trust manifest-driven entries and packaging mode instead of hardcoded root-index assumptions. This removes false warnings for `apps/stephanos/dist/index.html`, eliminates stale root-index probing behavior, and preserves launcher/discovery/workspace behavior.

## 2) Files changed
- `system/apps/entry_rules.js`
- `system/apps/app_validator.js`
- `system/agents/self_repair_agent/self_repair_agent.js`
- `scripts/validate-vite-entry-cleanup.mjs`
- `docs/reports/vite-entry-cleanup-report.md`

## 3) Root cause
The self-repair agent had legacy heuristics that treated `apps/<app>/index.html` as preferred and actively probed both root and dist entries. For Vite apps (like Stephanos), this generated false warnings and unnecessary requests for `apps/stephanos/index.html`, causing repeated 404 noise.

## 4) Cleanup applied
- Added a packaging-aware helper module (`entry_rules.js`) to normalize packaging and validate entry compatibility.
- Updated app validator to use packaging-aware entry validation and keep manifest entry as source of truth.
- Removed self-repair root/dist index fallback probing and root-index preference warnings.
- Kept diagnostics focused on real misconfigurations and unreachable manifest entries.
- Added a deterministic smoke test script covering Stephanos (`packaging=vite`, `entry=dist/index.html`) and document/classic-static cases.

## 5) Validation/testing performed
- Ran a smoke test script to validate packaging-aware entry rules against real Stephanos manifest.
- Verified stale warning/probing strings were removed from self-repair code.
- Checked git diff/stat for focused cleanup scope.

## 6) Remaining caveats
- The smoke test focuses on packaging-entry rule validation and deterministic manifest checks; it does not spin up an end-to-end browser session.
- Self-repair still validates runtime reachability of the resolved project entry; it now avoids guessing alternate paths.
