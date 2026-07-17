# Next wiring after source review

1. Feed sanitized live meter observations into `buildCodexCapacityProjection`.
2. Write capacity and consumption receipts to the Shared Agent Workspace.
3. Wrap the canonical Automated Codex Dispatcher with `createMeterAwareDispatchDecision`.
4. Render `buildCodexCapacityDashboardProjection` in Landing Page Goal Dashboard V2.
5. Register Meter-Aware Builder Mesh in the Stephanos capability registry.
6. Prove one real four-reset observation and one bounded earliest-expiry redemption.

These are post-merge acceptance steps. They are not claimed by the source-only PR.
