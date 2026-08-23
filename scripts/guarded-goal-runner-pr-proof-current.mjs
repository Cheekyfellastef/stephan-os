#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { GUARDED_GOAL_RUNNER_PR_PROOF_SCHEMA_ID } from '../shared/agents/guardedGoalRunnerV1.mjs';
import { GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH, isDirectCliEntrypoint } from './guarded-goal-runner-current.mjs';

const BOOLEAN_FLAGS = new Set(['mergeable', 'conflicting', 'draft', 'testsGreen', 'operatorApprovalRequired']);

function clean(value) { return String(value ?? '').trim(); }

function parseBoolean(value, flagName) {
  if (typeof value === 'boolean') return value;
  const normalized = clean(value).toLowerCase();
  if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  throw new Error(`--${flagName} must be true or false.`);
}

function nullableString(value) {
  const result = clean(value);
  return result || null;
}

function nullableNumber(value) {
  const result = clean(value);
  if (!result || result.toLowerCase() === 'null' || result.toLowerCase() === 'none') return null;
  const parsed = Number.parseInt(result, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error('--prNumber must be a positive integer, null, or omitted.');
  return parsed;
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const next = argv[i + 1];
    if (BOOLEAN_FLAGS.has(key) && (next === undefined || next.startsWith('--'))) {
      args[key] = true;
      continue;
    }
    if (next === undefined) throw new Error(`Missing value for --${key}.`);
    args[key] = next;
    i += 1;
  }
  return args;
}

function readJsonInput(inputFile) {
  if (!inputFile) return {};
  return JSON.parse(fs.readFileSync(inputFile, 'utf8'));
}

function mergeInput({ args, jsonInput }) {
  return { ...jsonInput, ...Object.fromEntries(Object.entries(args).filter(([key]) => key !== 'inputFile')) };
}

function changedFilesSummary(input) {
  if (input.changedFiles && typeof input.changedFiles === 'object') return input.changedFiles;
  const files = Array.isArray(input.changedFilePaths) ? input.changedFilePaths : [];
  const count = input.changedFilesCount ?? input.changedFileCount ?? files.length;
  return {
    count: Number.isInteger(Number(count)) ? Number(count) : 0,
    ...(files.length ? { files } : {}),
    summary: clean(input.changedFilesSummary) || 'PR proof supplied by explicit operator metadata.',
  };
}

function testsRunSummary(input) {
  if (input.testsRun && typeof input.testsRun === 'object') return input.testsRun;
  const testsGreen = parseBoolean(input.testsGreen ?? false, 'testsGreen');
  return {
    allGreen: testsGreen,
    summary: testsGreen ? 'Required tests reported green by explicit operator metadata.' : 'Required tests are not reported green.',
  };
}

function requireField(input, key) {
  if (input[key] === undefined || input[key] === null || clean(input[key]) === '') throw new Error(`--${key} is required.`);
  return input[key];
}

export function buildGuardedGoalRunnerPrProofPacket(input, { now = new Date().toISOString() } = {}) {
  const publicationState = clean(requireField(input, 'publicationState'));
  const packet = {
    schema: GUARDED_GOAL_RUNNER_PR_PROOF_SCHEMA_ID,
    generatedAt: now,
    issue: requireField(input, 'issue'),
    prNumber: nullableNumber(input.prNumber),
    prUrl: nullableString(input.prUrl),
    publicationState,
    baseBranch: clean(requireField(input, 'baseBranch')),
    baseSha: clean(requireField(input, 'baseSha')),
    expectedBaseSha: nullableString(input.expectedBaseSha),
    headSha: clean(requireField(input, 'headSha')),
    expectedHeadSha: nullableString(input.expectedHeadSha),
    mergeable: parseBoolean(requireField(input, 'mergeable'), 'mergeable'),
    conflicting: parseBoolean(requireField(input, 'conflicting'), 'conflicting'),
    draft: parseBoolean(requireField(input, 'draft'), 'draft'),
    changedFiles: changedFilesSummary(input),
    testsRun: testsRunSummary(input),
    operatorApprovalRequired: input.operatorApprovalRequired === undefined ? true : parseBoolean(input.operatorApprovalRequired, 'operatorApprovalRequired'),
    performsMerge: false,
    performsShellExecution: false,
  };
  if (publicationState === 'published' && (!packet.prNumber || !packet.prUrl)) throw new Error('published PR proof requires prNumber and prUrl.');
  return packet;
}

export function writeGuardedGoalRunnerPrProofCurrent({ sharedWorkspaceRoot, packet }) {
  if (!sharedWorkspaceRoot) throw new Error('--sharedWorkspaceRoot is required.');
  const outputPath = path.join(sharedWorkspaceRoot, GUARDED_GOAL_RUNNER_PR_CURRENT_RELATIVE_PATH);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(packet, null, 2)}\n`);
  return outputPath;
}

export function runGuardedGoalRunnerPrProofCurrent({ argv = process.argv.slice(2), now } = {}) {
  const args = parseArgs(argv);
  const input = mergeInput({ args, jsonInput: readJsonInput(args.inputFile) });
  const packet = buildGuardedGoalRunnerPrProofPacket(input, { now });
  const outputPath = writeGuardedGoalRunnerPrProofCurrent({ sharedWorkspaceRoot: input.sharedWorkspaceRoot, packet });
  return { outputPath, packet };
}

if (isDirectCliEntrypoint({ metaUrl: import.meta.url })) {
  const result = runGuardedGoalRunnerPrProofCurrent();
  process.stdout.write(`${result.outputPath}\n`);
}
