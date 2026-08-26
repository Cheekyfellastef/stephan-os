# Codex Dependency Current-Truth Persistence V1

Status: source-only, persistence-plan-only

## Purpose

Advance #1899 under #1898 by connecting the existing authenticated current-truth observation record to the existing Shared Agent Workspace state/evidence store without adding another database, writer daemon, scheduler, provider router or control plane.

The #1920 observation producer already emits a digest-bound persistable observation record. This slice turns that proven record into a deterministic persistence plan for the canonical `sharedAgentWorkspaceStore.mjs` writers.

## Persistence contract

A valid observation produces exactly two planned atomic JSON writes:

1. a replaceable current-status projection at `status/provider-independence-current.json`; and
2. one observation-addressed proof record at `proof/<observationId>.json`.

The proof filename is the full deterministic observation identity. Replaying the same observation therefore targets the same proof record, while a new observation gets a new proof path. This provides idempotent current state plus an append-only-by-identity evidence estate without inventing a second ledger.

Both planned records use the existing Shared Agent Workspace STATUS/PROOF schemas and are validated by the existing canonical record validator before the plan is returned ready.

## Truth rules

Persistence is about durable truth, not only green truth. Complete parity, current gaps and incomplete/blocking observations may all be persisted when the underlying #1920 observation record is structurally persistable and its report digest and identity bindings remain exact.

A caller cannot change the report after the observation identity was created: the persistence planner recomputes the report digest and fails closed on report/record identity or count drift.

## Authority boundary

This module does not call the filesystem writers. It only names the already-existing `writeAtomicJson` writer and the bounded target segments. Writer execution, source mutation, provider qualification, dispatch, merge, deployment, runtime/OpenClaw mutation, spending/account actions and lease seizure remain false.

Runtime execution of the persistence plan is a later separately governed host action.
