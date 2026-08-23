# Stephanos Ignition Cockpit Runbook

## Battle Bridge proof command

```bash
npm run stephanos:ignite
```

## Reading the cockpit

- **Green** means build passed, verify passed, the 4173 server is started, the served runtime marker matches the expected dist metadata, and module MIME probes passed. Only this state enables **Enter Stephanos**.
- **Blue** means ignition is actively working on a stage such as source update, build, verify, restart, or served proof.
- **Amber** means the server has started but final served-runtime proof is still pending or unavailable. Do not treat build/verify as browser proof; wait for marker and MIME proof or rerun the proof command.
- **Red** means a blocker exists. Follow the cockpit's exact next operator action before retrying.

## Stage/proof cards

- **Source update** shows whether local main was behind `origin/main`, the pull result, and before/after commits when available.
- **Build** shows running/passed/failed state plus runtime marker and git commit after build metadata exists.
- **Verify** shows running/passed/failed state from the canonical verify command.
- **Restart 4173** shows restart requested, server stopped/started, and health probe result.
- **Served runtime proof** shows served runtime marker match/mismatch and module MIME proof result.

## Local proof commands

```bash
npm run stephanos:ignite
node --test scripts/ignite-stephanos-local.test.mjs
node --test scripts/stephanos-ignition-preflight.test.mjs
node --test scripts/serve-stephanos-dist.test.mjs
node --test scripts/*ignition*.test.mjs
node --test shared/agents/ignition*.test.mjs
```

## Safety boundaries

Ignition must not use arbitrary shell beyond source-controlled ignition scripts, kill arbitrary processes, run `git reset --hard`, delete source, fake live proof, or treat build/verify success as served-browser proof.
