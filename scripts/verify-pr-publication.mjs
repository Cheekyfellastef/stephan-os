#!/usr/bin/env node
import { runVerifier, validateVerifierResult } from '../shared/agents/verificationHarness.mjs';

const env = process.env;
const packet = {
  prNumber: env.PR || env.PR_NUMBER || env.GITHUB_PR_NUMBER,
  branch: env.BRANCH || env.HEAD_REF || env.GITHUB_HEAD_REF,
  remoteHead: env.REMOTE_HEAD || env.HEAD_SHA || env.GITHUB_SHA,
  expectedPr: env.EXPECTED_PR || env.PR,
  expectedBranch: env.EXPECTED_BRANCH || env.BRANCH,
  expectedRemoteHead: env.EXPECTED_REMOTE_HEAD || env.REMOTE_HEAD,
  targetExistingPr: true,
  publishAllowed: false,
  timestampUtc: new Date().toISOString(),
};

const result = runVerifier('PRPublicationVerifier', packet, { timestampUtc: packet.timestampUtc });
const validation = validateVerifierResult(result);
const output = { ...result, validation, publishAttempted: false };
console.log(JSON.stringify(output, null, 2));

if (result.status !== 'PASS' || !validation.valid) {
  process.exitCode = 1;
}
