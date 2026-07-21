# Provider-Neutral Review Continuity V1

Issue: #1574 — Provider-neutral build and review continuity when Codex capacity is unavailable

## Purpose

Codex is a specialist option, not the programme's ignition key. When Codex implementation or code-review capacity is unavailable, bounded repository work must continue through the safest qualified provider-neutral route without opening a duplicate branch, pull request, implementation job, or review job.

This first source slice provides:

- a versioned exact-head review receipt;
- fail-closed review receipt validation;
- a meter-aware provider-neutral review route selector;
- duplicate review-job refusal for the same pull request and full head;
- implementer/reviewer separation rules;
- a deterministic quorum route for non-high-risk work;
- specialist-only review requirements for high-risk work;
- bounded GitHub-first and OpenClaw/local read-only adapter contracts;
- conversion into the canonical execution receipt introduced by #1568.

## Review receipt

Schema:

```text
stephanos.provider-neutral-review.v1
```

Every receipt binds the review to:

- repository;
- issue and pull request;
- branch;
- exact 40-character source head;
- authenticated reviewer identity, reviewer class, provider, model class, and session;
- implementer provider and session;
- risk tier and assurance mode;
- bounded review scope;
- P0/P1/P2 findings;
- verdict, timestamp, proof references, and blocker when applicable.

A head change invalidates the receipt. A clean verdict cannot contain findings. A findings verdict cannot omit findings. A blocked verdict requires a blocker. Malformed, unsafe, stale, or contradictory evidence fails closed.

## Assurance modes

### Independent

The reviewer session must be separate from the implementation session. The same provider may be used only when the session identity proves separation.

### Deterministic quorum

Allowed only for low and standard risk. It requires all of:

- `exact-head-ci`;
- `focused-tests`;
- `policy-review`.

It is not accepted for high-risk work.

### Specialist

High-risk work requires an authenticated specialist reviewer class. High risk includes authority such as credentials, destructive Git, live Windows or OpenClaw mutation, security boundaries, or money-spending capability. Deterministic checks alone cannot satisfy that gate.

## Route selection

The selector:

1. validates repository, pull request, branch, exact head, risk tier, and implementation identity;
2. refuses a duplicate dispatch when a non-terminal review job already exists for the same pull request and exact head;
3. considers only available providers qualified for the risk tier;
4. requires independent review or an allowed deterministic quorum;
5. ranks qualified routes by proof quality, cost, latency, and stable provider identity;
6. reports `PROVIDER_CAPACITY_UNAVAILABLE` when Codex is unavailable and a non-Codex fallback is selected;
7. reports `SPECIALIST_REVIEW_REQUIRED` when high-risk work has no available qualified specialist.

Codex exhaustion is therefore a routing condition, not an automatic programme stop.

## Adapter authority

The GitHub-first and local read-only adapter contracts require:

- exact-head binding;
- raw review output plus a normalized receipt;
- a canonical #1568 execution receipt;
- no mutation authority;
- no arbitrary shell or filesystem authority;
- no credential access.

## Safety

- exactly one active implementation lane;
- exactly one review job per pull request and exact head;
- no automatic merge approval;
- no approval reuse after head movement;
- no destructive Git;
- no live Windows, Battle Bridge, or OpenClaw mutation;
- no arbitrary shell, PowerShell, browser, filesystem, credential, or secret access;
- no claim that deterministic checks replace specialist review for high-risk work.

## Focused proof

```text
npm run stephanos:provider-neutral-review:test
```

The focused suite covers Codex exhaustion fallback, duplicate dispatch prevention, exact-head expiry, implementer/reviewer separation, deterministic quorum boundaries, malformed review rejection, specialist risk gates, provider switching, adapter authority, and canonical execution-receipt conversion.
