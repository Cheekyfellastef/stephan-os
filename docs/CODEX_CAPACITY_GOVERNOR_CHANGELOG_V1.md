# Codex Capacity Governor V1 change summary

- Added deterministic meter observations with availability, remaining capacity, natural reset, banked reset expiry, source and confidence.
- Added per-task consumption receipts and observed P50/P80 cost learning.
- Added initial protected reserves for emergency repair, exact-head review and Windows runtime proof.
- Added route selection that suppresses status, planning and other zero-cost-capable work from Codex.
- Added natural-reset deferral and task splitting when a task would consume protected capacity.
- Added earliest-expiring banked reset selection and a fixed Remote Codex redemption action.
- Added a standing operator policy and a bounded Codex skill that presses one matching reset once.
- Added stack velocity forecasts based only on verified capability slices.
- Added a human-readable dashboard projection suitable for Goal Dashboard V2.
- Added deterministic source tests and a dedicated GitHub Actions proof workflow.
