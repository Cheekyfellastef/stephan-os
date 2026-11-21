# Stephanos Shared Participant Live Q&A V1

## Purpose

This slice closes the source-level seam identified by product goals #1290 and #1308 under programme controller #1776. The already-merged Shared Workspace conversation adapter can encode and validate `conversation-question` and `conversation-answer` records, and the existing #1506 ChatGPT relay provides the bounded transport. What was missing was a product adapter that consumes one validated question for `stephanos`, asks through the existing Stephanos AI route, and returns the existing correlated answer record.

This module does not create a new chatbot, transport, mailbox, worker, scheduler, model router, truth store, memory store, approval path or command surface.

## Input contract

`answerStephanosWorkspaceQuestionRecord(record, options)` accepts only a record that already passes `decodeStephanosWorkspaceQuestionRecord()`. The record must target participant `stephanos`. Existing round, question, asker, recipient, timestamp, freshness, proof-reference and authority checks remain owned by the merged conversation adapter and capability ladder.

Invalid, stale, future, malformed, authority-bearing or mis-targeted records fail before the Stephanos AI query is called.

## Existing cognition path

The default query is the existing `queryStephanosAI()` client and therefore the existing `/api/ai/chat` backend route. It keeps the repository default provider plus `routeMode=auto` and existing fallback policy. The Shared Workspace caller gains no provider-selection authority.

The bounded question context carries only the existing round/question class and supplied context/novelty references. It grants no mutation or execution authority.

## Grounding truth

The adapter never treats successful model text as grounded merely because an AI call succeeded.

A response can become `ANSWERED_GROUNDED` only when the existing AI response contains standardized evidence signals and the resulting freshness is `FRESH` or `RECENT`. Recognized evidence classes are:

- an exact `stephanos.live-goal-projection.v1` response;
- local retrieval explicitly reported as used, with retrieved sources represented only by deterministic SHA-256 evidence tokens;
- durable-memory hits represented only by deterministic SHA-256 evidence tokens;
- provider grounding explicitly reported as active for the request.

Evidence source material, provider payloads and runtime paths are not copied into the conversation answer. The answer record carries bounded evidence tokens and source-class labels only.

Successful text without standardized evidence becomes `ANSWERED_PARTIAL`, not `ANSWERED_GROUNDED`. A failed existing AI route becomes `GAP_TOOL_OR_DATA_ACCESS`, so the capability ladder can classify a real buildable gap rather than a fake success.

Secret-shaped or oversized answer text is blocked before Shared Workspace publication.

## Correlation and publication

The output is built exclusively through `createStephanosWorkspaceAnswerRecord()`. It preserves:

- exact `roundId` as Shared Workspace `correlationId`;
- exact `questionId` as `subjectId`;
- responder `stephanos`;
- recipient equal to the original asker participant;
- original related issue/PR lineage;
- caller-supplied proof references required by the existing conversation adapter.

The adapter itself returns an inert answer record. Wiring that record into the already-existing #1506 relay/Shared Workspace persistence path is the next bounded integration step. No second transport or worker is authorized by this slice.

## Authority boundary

Every result keeps these false:

- source mutation;
- command execution;
- approval;
- merge;
- deployment;
- scheduler creation;
- worker creation;
- mailbox creation;
- provider-selection authority added.

No Windows/Battle Bridge mutation, OpenClaw mutation, provider/account access, credential write, spend, merge, deployment or live-runtime claim is made by this source slice.

## Acceptance ladder

Source admission requires focused deterministic tests plus the repository's applicable exact-head hosted checks and independent semantic/security review.

After protected admission, a separate runtime proof must show one real #1308 initial-round `conversation-question` entering through the existing #1506 path, a real Stephanos answer being produced by the existing AI route, the correlated `conversation-answer` being persisted/published through Shared Workspace, and the exact receipt/evidence chain surviving replay/freshness checks. Ten-question round acceptance remains a later product proof and must not be inferred from source merge.
