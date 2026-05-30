import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OPENCLAW_SOURCE_PACK_CLI_PROMPT,
  buildOpenClawSourcePackRunnerProjection,
  isOpenClawSourcePackRouteEligible,
  judgeOpenClawSourcePackResult,
} from './openClawSourcePackRunner.mjs';

const SOURCE_PACK = `SOURCE PACK START
Topic: Runtime truth
Source 1 title: Support snapshot
Source 1 URL: https://example.test/support
Source 1 notes:
OpenClaw Workspace Hygiene Status is clean. Mutation authority is locked.
TASK:
Extract only what is supported by the source pack.
SOURCE PACK END`;

const GOOD_RESULT = `SOURCE_PACK_STATUS: bounded
SUMMARY:
The source pack says workspace hygiene is clean and mutation authority is locked.
USEFUL_FACTS:
- Workspace Hygiene Status is clean.
- Mutation authority is locked.
UNKNOWNS:
- Whether dashboard or qwen routes have separate proof is unknown.
RISKS:
- Treating this as mutation authority would be unsafe.
NEXT_RESEARCH_QUESTIONS:
- Is there newer route proof from the operator?
STEPHANOS_HANDOFF_PACKET:
status: bounded
route: stephanos-scout / llama3.2 CLI
source: https://example.test/support`;

test('source-pack prompt contains read-only no-mutation no-browse source-bound instructions', () => {
  assert.match(OPENCLAW_SOURCE_PACK_CLI_PROMPT, /Read-only analysis only/i);
  assert.match(OPENCLAW_SOURCE_PACK_CLI_PROMPT, /Do not run commands/i);
  assert.match(OPENCLAW_SOURCE_PACK_CLI_PROMPT, /Do not edit files/i);
  assert.match(OPENCLAW_SOURCE_PACK_CLI_PROMPT, /assume no browsing/i);
  assert.match(OPENCLAW_SOURCE_PACK_CLI_PROMPT, /Analyze only the pasted SOURCE PACK text/i);
  assert.match(OPENCLAW_SOURCE_PACK_CLI_PROMPT, /Do not invent sources/i);
  assert.match(OPENCLAW_SOURCE_PACK_CLI_PROMPT, /STEPHANOS_HANDOFF_PACKET/);
});

test('good source-pack result passes intake', () => {
  const result = judgeOpenClawSourcePackResult(GOOD_RESULT, { sourcePackText: SOURCE_PACK });
  assert.equal(result.sourcePackStatus, 'passed');
  assert.equal(result.sourceBounded, 'yes');
  assert.equal(result.hallucinatedSourcesDetected, 'no');
  assert.equal(result.handoffPacketPresent, 'yes');
  assert.equal(result.usefulFactCount, 2);
  assert.equal(result.unknownCount, 1);
});

test('result with invented URL fails', () => {
  const result = judgeOpenClawSourcePackResult(GOOD_RESULT.replace('https://example.test/support', 'https://invented.example/claim'), { sourcePackText: SOURCE_PACK });
  assert.equal(result.sourcePackStatus, 'failed');
  assert.equal(result.hallucinatedSourcesDetected, 'yes');
});

test('result with answer/response placeholders fails', () => {
  for (const marker of ['<answer>', '<response>', '<your response>']) {
    const result = judgeOpenClawSourcePackResult(`${GOOD_RESULT}\n${marker}`, { sourcePackText: SOURCE_PACK });
    assert.equal(result.sourcePackStatus, 'failed');
    assert.equal(result.templateLeakageDetected, 'yes');
  }
});

test('result saying ask away or next continuation boilerplate fails', () => {
  for (const phrase of ['ask away', 'say next', 'provide next']) {
    const result = judgeOpenClawSourcePackResult(`${GOOD_RESULT}\n${phrase}`, { sourcePackText: SOURCE_PACK });
    assert.equal(result.sourcePackStatus, 'failed');
    assert.equal(result.asksForNextDetected, 'yes');
  }
});

test('result claiming file edits, commands, commits, pushes, or PRs fails', () => {
  for (const phrase of ['I edited the file.', 'I ran npm test command.', 'git commit -m x', 'pushed the branch', 'created a pull request']) {
    const result = judgeOpenClawSourcePackResult(`${GOOD_RESULT}\n${phrase}`, { sourcePackText: SOURCE_PACK });
    assert.equal(result.sourcePackStatus, 'failed');
    assert.equal(result.mutationClaimDetected, 'yes');
  }
});

test('source-pack result lacking unknowns or handoff fails', () => {
  const noUnknowns = GOOD_RESULT.replace(/UNKNOWNS:[\s\S]*?RISKS:/, 'UNKNOWNS:\nnone\nRISKS:');
  assert.equal(judgeOpenClawSourcePackResult(noUnknowns, { sourcePackText: SOURCE_PACK }).sourcePackStatus, 'failed');
  const noHandoff = GOOD_RESULT.replace(/STEPHANOS_HANDOFF_PACKET:[\s\S]*/, '');
  assert.equal(judgeOpenClawSourcePackResult(noHandoff, { sourcePackText: SOURCE_PACK }).sourcePackStatus, 'failed');
});

test('dashboard and qwen routes remain blocked for source-pack routing', () => {
  assert.equal(isOpenClawSourcePackRouteEligible({ routeId: 'dashboard', exactResponseStatus: 'passed', sourcePackStatus: 'passed' }).eligible, 'no');
  assert.equal(isOpenClawSourcePackRouteEligible({ routeId: 'cli-qwen14', exactResponseStatus: 'passed', sourcePackStatus: 'passed' }).eligible, 'no');
});

test('llama3.2 CLI is only bounded source-pack eligible after proof', () => {
  assert.equal(isOpenClawSourcePackRouteEligible({ routeId: 'cli-llama3.2', exactResponseStatus: 'unknown', sourcePackStatus: 'passed' }).eligible, 'no');
  const eligible = isOpenClawSourcePackRouteEligible({ routeId: 'cli-llama3.2', exactResponseStatus: 'passed', sourcePackStatus: 'passed' });
  assert.equal(eligible.eligible, 'yes');
  assert.match(eligible.reason, /bounded read-only source-pack processing/i);
});

test('projection defaults trusted-for-canon and trusted-for-research to no', () => {
  const projection = buildOpenClawSourcePackRunnerProjection({ rawResult: GOOD_RESULT, sourcePackText: SOURCE_PACK });
  assert.equal(projection.trustedForCanon, 'no');
  assert.equal(projection.trustedForResearch, 'no');
  assert.equal(projection.mutationAuthority, 'locked');
});

test('projection judges the provided Source Pack output field with non-zero current output length', () => {
  const badOutput = `As a language model, ask away or say next.
<your response>`;
  const projection = buildOpenClawSourcePackRunnerProjection({
    openClawSourcePackOutput: badOutput,
    sourcePackText: badOutput,
    openClawSourcePackJudgedAt: '2026-05-30T00:00:00.000Z',
    openClawSourcePackLastJudgedText: badOutput,
    openClawSourcePackLastJudgedOutput: badOutput,
  });

  assert.equal(badOutput.length, 58);
  assert.equal(projection.sourcePackCurrentOutputLength, 58);
  assert.equal(projection.sourcePackLastJudgedOutputLength, 58);
  assert.equal(projection.sourcePackStatus, 'failed');
  assert.equal(projection.templateLeakageDetected, 'yes');
  assert.equal(projection.asksForNextDetected, 'yes');
});
