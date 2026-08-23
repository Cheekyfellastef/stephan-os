# Shared Workspace Dashboard Feed Runbook

The Shared Workspace dashboard feed is a read-only landing dashboard adapter. It reads current Shared Agent Workspace JSON records and projects them through the existing Landing Goal Dashboard projection. It does not create records, run shells, automate browsers, mutate the repository, or claim fake live proof.

## Polling contract

- Default poll interval: 30 seconds.
- Minimum poll interval: 15 seconds.
- Polls are read-only JSON directory reads from the configured Shared Agent Workspace root.
- Dashboard UI writes are forbidden; operators must publish/refresh records through the canonical Shared Agent Workspace writers.

## Feed states

- `loading`: first safe poll has not completed.
- `ready`: workspace records were read and the projection has no stale blockers.
- `stale`: at least one required live record is older than the stale threshold.
- `unavailable`: the workspace path is unset/unsafe or no records exist; missing records must remain `UNKNOWN`.
- `error`: a record cannot be parsed or fails Shared Agent Workspace validation.

## Operator next actions

- `UNKNOWN`: publish the missing status/proof/capability record through the canonical Shared Agent Workspace store.
- `STALE`: refresh the stale record and attach current proof refs before claiming live progress.
- `ERROR`: fix the invalid/unreadable record named in `feed.errors`, then wait for the next safe poll.
- `UNAVAILABLE`: set `STEPHANOS_SHARED_AGENT_WORKSPACE` to the existing workspace directory outside the repo and publish current records.

## Local browser proof instructions

After wiring a backend route to `readSharedWorkspaceDashboardFeed()`, launch the Goal Dashboard locally, open the landing live projection panel, and verify that the panel shows the feed state, poll interval, source truth, and exact next action. Capture a screenshot and console output. Do not report live health unless the Shared Agent Workspace records are current.
