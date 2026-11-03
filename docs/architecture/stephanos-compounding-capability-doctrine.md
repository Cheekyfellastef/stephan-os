# Stephanos Compounding Capability Doctrine

Status: Canonical architecture doctrine

## 1. Purpose

Stephanos is intended to compound capability, not merely accumulate features or completed tasks.

A completed goal should leave the platform better able to understand, plan, build, automate or verify future goals. The system should preserve useful knowledge about both the result and the process that produced it, while keeping the operator at the intent, judgement and approval layer wherever safely possible.

This doctrine governs the Continuous Improvement Flywheels programme and all later domain programmes that inherit its machinery.

## 2. The Compounding Principle

When two approaches provide comparable operator value, Stephanos should prefer the approach that also increases its future ability to:

- learn accurately;
- reuse successful methods;
- eliminate repeatable manual work;
- orchestrate goals;
- verify outcomes;
- preserve canonical state across workers and conversational surfaces.

Compounding is not permission to overbuild. The smallest safe implementation remains preferred. Reusable capability should be extracted when evidence shows that it will reduce future cost, risk, duplication or operator effort.

## 3. The four durable assets

Every substantial completed goal must be evaluated for four reusable assets. Each asset should be captured when relevant and proportionate.

### Knowledge

What was learned about the domain, system, dependency, failure mode or operator need.

Knowledge must preserve provenance, freshness, confidence and known uncertainty. Missing evidence must remain an explicit unknown rather than being filled by inference.

### Method

How the result was obtained, including successful research sequences, diagnostic approaches, decomposition patterns, prompts, tools, experiments and validation strategies.

Reusable methods belong in the Method Library so later goals can begin from a proven approach rather than rediscovering one.

### Automation

Which repeatable, deterministic, bounded and safely verifiable manual actions can be removed or reduced.

Manual repetition is automation debt. The governing design policy remains:

> The best click is no click.

Automation candidates must still respect risk, authority, rollback, verification and approval boundaries.

### Proof

What evidence demonstrates that the result is real, reproducible, safe and connected to the canonical system.

Proof must be machine-readable where practical and must feed the Verification Harness, Shared Agent Workspace and Mission Scheduler rather than remaining trapped in a chat or private worker state.

## 4. The three flywheels

### Mission Flywheel

The Mission Flywheel converts intent into ordered, dependency-aware, verifiable work.

```text
Goals
  -> planning
  -> execution
  -> proof
  -> completion receipt
  -> next eligible goal
```

Its primary question is:

> What should be done next?

The Mission Scheduler and Goal Flywheel V1 provide the orchestration foundation for this loop.

### Learning Flywheel

The Learning Flywheel converts discovery and execution evidence into better knowledge and better ways of learning.

```text
Discovery
  -> research
  -> verification
  -> extraction
  -> classification
  -> implementation or experiment
  -> reflection
  -> Method Library update
  -> improved future research
```

Its primary question is:

> How should Stephanos learn this more effectively next time?

Reflection is a first-class engineering activity. It must examine source quality, wasted effort, duplicated work, failed assumptions, useful experiments, effective methods and unresolved uncertainty.

### Automation Flywheel

The Automation Flywheel converts recurring operator or engineering work into bounded automation.

```text
Manual or repeated action
  -> repetition evidence
  -> automation candidate
  -> risk and value assessment
  -> bounded implementation
  -> verification
  -> reduced operator effort
  -> next candidate
```

Its primary question is:

> Which future manual action can safely disappear?

## 5. Reinforcement between flywheels

The flywheels must operate as one reinforcing system rather than three isolated subsystems.

- Mission execution produces knowledge, methods, automation opportunities and proof.
- Learning improves future decomposition, research and implementation choices.
- Automation accelerates learning and delivery while reducing courier work.
- Proof updates canonical state and allows the Mission Scheduler to select the next safe action.
- Completion receipts trigger reflection as well as dependency evaluation.

The Integrated Flywheel Orchestrator is responsible for routing these outputs into the appropriate canonical stores and candidate-goal queues.

## 6. Canonical architecture rules

1. One Stephanos identity and one canonical shared mission state.
2. Do not create private domain-specific realities, schedulers or memory systems when shared infrastructure exists.
3. Knowledge, methods, automation candidates and proof must be retrievable across authorised conversational and execution surfaces.
4. Workers may produce evidence, but no worker owns the authoritative mission state.
5. Consequential mutations remain bounded by operator authority, approval gates, rollback and verification.
6. GitHub-first engineering remains the default; Battle Bridge execution is used for work that genuinely requires live Windows or runtime access.
7. Autonomous progress must survive chat closure, worker handoff and restart without losing state or silently promoting unverified claims.
8. Compounding work must not displace a higher-priority critical-path goal merely because it is reusable.

## 7. Method Library

The Method Library stores evidence-backed ways of learning and building.

A method record should include, where applicable:

- intended problem class;
- prerequisites and dependencies;
- ordered procedure;
- tools and data sources;
- evidence of effectiveness;
- known failure modes;
- confidence and freshness;
- domains where the method is reusable;
- superseded or rejected alternatives.

Methods are recommendations, not unquestionable rules. Runtime evidence may revise, narrow or retire them.

## 8. Domain inheritance

VR is the first proving domain for the Learning Flywheel, but the machinery belongs to Stephanos core.

New research and operating domains should inherit:

- canonical research schemas;
- provenance and freshness controls;
- capability and dependency graph patterns;
- the Method Library;
- reflection receipts;
- automation-candidate routing;
- verification and completion-receipt handling.

A new domain must not build a parallel learning flywheel unless a verified architectural requirement proves the shared machinery insufficient.

## 9. Programme and goal design questions

Every major programme or goal proposal should answer, proportionately:

1. What operator outcome does this create?
2. Which existing goal or dependency makes it eligible now?
3. Which flywheel or flywheels does it strengthen?
4. What knowledge may become reusable?
5. What method may become reusable?
6. What manual work might become automation debt?
7. What proof will establish completion?
8. How will the outputs return to canonical shared state?
9. Does this increase Stephanos' future capability without unnecessary scope?

A goal is not invalid merely because it does not strengthen all three flywheels. The questions exist to expose compounding opportunities and prevent isolated work, not to manufacture artificial complexity.

## 10. Adoption requirements

This doctrine becomes operational when:

- it is included in canonical architecture and context assembly;
- the Mission Scheduler can reference its principles during programme evaluation;
- major goals identify relevant flywheel contributions;
- completion receipts can generate reflection records and automation candidates;
- the Method Library is queryable by authorised planners and workers;
- architecture reviews can detect parallel state, duplicated learning machinery and avoidable manual courier work;
- at least one proving programme demonstrates a full mission-learning-automation reinforcement loop.

## 11. Current scope boundary

The current doctrine defines the Mission, Learning and Automation Flywheels.

A separate Confidence Flywheel is not part of the present build programme. Stephanos should first realise the existing layers and build the operator's goals through them. Any later autonomy or confidence abstraction must arise from observed runtime evidence and a separately authorised goal.

## 12. Governing relationship

```text
Stephanos vision and operator authority
                |
                v
Compounding Capability Doctrine
                |
                v
Continuous Improvement Flywheels programme
                |
     +----------+----------+
     |          |          |
  Mission    Learning   Automation
  Flywheel   Flywheel    Flywheel
     +----------+----------+
                |
                v
Canonical knowledge, methods, proof and bounded automation
                |
                v
Better realisation of future operator goals
```

## 13. Doctrine verdict

```text
STEPHANOS_COMPOUNDS_CAPABILITY_NOT_FEATURE_COUNT
KNOWLEDGE_METHOD_AUTOMATION_AND_PROOF_ARE_DURABLE_ASSETS
MISSION_LEARNING_AND_AUTOMATION_FLYWHEELS_REINFORCE_EACH_OTHER
OPERATOR_REMAINS_AT_INTENT_JUDGEMENT_AND_APPROVAL_LAYER
CONFIDENCE_FLYWHEEL_DEFERRED_PENDING_RUNTIME_EVIDENCE
```