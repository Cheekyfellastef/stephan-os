#!/usr/bin/env node
// Local Ollama candidate calibration: fixed ten adversarial cases only.
// No GitHub, arbitrary command, Windows witness, approval or merge capability.
import { fileURLToPath } from 'node:url';
import { evaluateSovereignCalibrationV1 } from '../shared/agents/sovereignCalibrationV1.mjs';

const MODEL_RE = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;
const NO_AUTHORITY = Object.freeze({
  independentHostAttestation: false, signatureVerified: false,
  specialistAuthority: false, independentReviewSatisfied: false,
  protectedMergeAuthority: false, sourceMutationAuthority: false,
  leaseReleaseAuthority: false, windowsCommissioningAuthority: false,
  physicalPickupProven: false,
});
function held(reason) {
  return Object.freeze({
    status: 'CALIBRATION_HELD', reason, ...NO_AUTHORITY,
  });
}
export async function runSovereignOllamaCalibrationV1(env = process.env, {
  fetchImpl = fetch,
} = {}) {
  const model = String(env.STEPHANOS_SOVEREIGN_REVIEW_MODEL || 'qwen:14b').trim();
  if (!MODEL_RE.test(model) || typeof fetchImpl !== 'function') {
    return held('LOCAL_MODEL_NOT_CONFIGURED');
  }
  const input = {
    repository: env.STEPHANOS_REVIEW_REPOSITORY,
    sourceHead: env.STEPHANOS_REVIEW_EXACT_HEAD,
    baseSha: env.STEPHANOS_REVIEW_EXACT_BASE,
    implementerPrincipal: env.STEPHANOS_REVIEW_IMPLEMENTER_SESSION,
    reviewerPrincipal: env.STEPHANOS_REVIEW_SESSION,
    implementerProvider: env.STEPHANOS_REVIEW_IMPLEMENTER_PROVIDER,
    reviewerProvider: 'sovereign-local-ollama',
    reviewerSessionId: env.STEPHANOS_REVIEW_SESSION,
  };
  return evaluateSovereignCalibrationV1(input, {
    invokeModel: async prompt => {
      // No prompt, source, model output or token enters a GitHub receipt.
      const response = await fetchImpl('http://127.0.0.1:11434/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model, prompt, stream: false, format: 'json',
          options: { temperature: 0, num_ctx: 8192 },
        }),
        signal: AbortSignal.timeout(45_000), // 10 cases, bounded within 570s WSL wall clock
      });
      if (!response?.ok || typeof response.text !== 'function') {
        throw new Error('LOCAL_OLLAMA_RESPONSE_UNAVAILABLE');
      }
      const bytes = await response.text();
      if (typeof bytes !== 'string' || Buffer.byteLength(bytes, 'utf8') > 64 * 1024) {
        throw new Error('LOCAL_OLLAMA_RESPONSE_UNBOUNDED');
      }
      const result = JSON.parse(bytes);
      if (typeof result?.response !== 'string'
        || Buffer.byteLength(result.response, 'utf8') > 12_288) {
        throw new Error('LOCAL_OLLAMA_RESPONSE_INVALID');
      }
      return result.response;
    },
  });
}
export function projectSovereignOllamaCalibrationV1(result = {}) {
  const ok = result.status === 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED';
  const sha40 = /^[a-f0-9]{40}$/;
  const sha64 = /^[a-f0-9]{64}$/;
  return Object.freeze({
    status: ok ? 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED' : 'CALIBRATION_HELD',
    reason: ok ? '' : String(result.reason || 'CALIBRATION_UNQUALIFIED').slice(0, 120),
    repository: result.repository === 'Cheekyfellastef/stephan-os' ? result.repository : '',
    sourceHead: sha40.test(result.sourceHead ?? '') ? result.sourceHead : '',
    baseSha: sha40.test(result.baseSha ?? '') ? result.baseSha : '',
    completedCases: Number.isSafeInteger(result.completedCases) && result.completedCases >= 0
      && result.completedCases <= 10 ? result.completedCases : 0,
    passedCases: Number.isSafeInteger(result.passedCases) && result.passedCases >= 0
      && result.passedCases <= 10 ? result.passedCases : 0,
    manifestSha256: sha64.test(result.manifestSha256 ?? '') ? result.manifestSha256 : '',
    observationsSha256: sha64.test(result.observationsSha256 ?? '') ? result.observationsSha256 : '',
    ...NO_AUTHORITY,
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] !== '--once') {
    process.stderr.write('SOVEREIGN_CALIBRATION_HELD=FIXED_ONCE_ONLY\n');
    process.exitCode = 2;
  } else {
    runSovereignOllamaCalibrationV1()
      .then(result => {
        const summary = projectSovereignOllamaCalibrationV1(result);
        process.stdout.write('SOVEREIGN_REVIEW_CALIBRATION_RESULT=' + JSON.stringify(summary) + '\n');
        if (summary.status !== 'CALIBRATION_CANDIDATE_PASSED_UNATTESTED') process.exitCode = 2;
      })
      .catch(() => {
        process.stdout.write('SOVEREIGN_REVIEW_CALIBRATION_RESULT='
          + JSON.stringify(projectSovereignOllamaCalibrationV1(held('LOCAL_MODEL_EXECUTION_FAILED'))) + '\n');
        process.exitCode = 2;
      });
  }
}
