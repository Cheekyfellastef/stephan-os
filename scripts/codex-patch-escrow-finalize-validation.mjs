import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createValidatedPatchEscrowArtifact,
  validateValidatedPatchEscrowArtifact,
} from './codex-patch-escrow-validated-artifact.mjs';
import { validatePreparedPatchEscrow } from './codex-patch-escrow-validate-prepared.mjs';

const SHA40 = /^[a-f0-9]{40}$/;

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export function finalizePreparedPatchEscrowValidation(preparedPath, validationReportPath, validatedOutputPath) {
  const preparedSourcePath = resolve(preparedPath);
  const reportSourcePath = resolve(validationReportPath);
  const outputPath = resolve(validatedOutputPath);
  if (!existsSync(preparedSourcePath)) throw new Error('prepared patch escrow artifact is missing');
  if (!existsSync(reportSourcePath)) throw new Error('isolated validation report is missing');

  const preparedBytes = readFileSync(preparedSourcePath);
  const prepared = JSON.parse(preparedBytes.toString('utf8'));
  const preparedValidation = validatePreparedPatchEscrow(prepared);
  if (!preparedValidation.valid) {
    throw new Error(`prepared artifact is invalid: ${preparedValidation.blockers.join(', ')}`);
  }

  const validationResult = JSON.parse(readFileSync(reportSourcePath, 'utf8'));
  if (validationResult?.finalVerdict !== 'PATCH_ESCROW_TOKEN_FREE_VALIDATION_PASS') {
    throw new Error('isolated token-free validation pass is required');
  }
  if (validationResult.bundleId !== prepared.bundleId) throw new Error('validation report bundle does not match prepared artifact');
  if (validationResult.patchSha256 !== prepared.patchSha256) throw new Error('validation report patch hash does not match prepared artifact');
  if (!SHA40.test(text(validationResult.expectedTreeSha))) throw new Error('validation report expected tree SHA is invalid');
  if (validationResult?.ancestry?.safe !== true || (validationResult?.ancestry?.blockers || []).length !== 0) {
    throw new Error('validation report credential ancestry evidence is not clean');
  }
  if (!validationResult?.testEvidence || typeof validationResult.testEvidence !== 'object') {
    throw new Error('validation report test evidence is missing');
  }

  const artifact = createValidatedPatchEscrowArtifact({ preparedBytes, validationResult });
  const artifactValidation = validateValidatedPatchEscrowArtifact(artifact);
  if (!artifactValidation.valid) {
    throw new Error(`final validated artifact is invalid: ${artifactValidation.blockers.join(', ')}`);
  }
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze({ artifact, outputPath });
}

async function main() {
  const preparedPath = text(process.argv[2] || process.env.PATCH_ESCROW_PREPARED_PATH);
  const reportPath = text(process.argv[3] || process.env.PATCH_ESCROW_VALIDATION_REPORT_PATH);
  const outputPath = text(process.argv[4] || process.env.PATCH_ESCROW_VALIDATED_PATH);
  if (!preparedPath || !reportPath || !outputPath) {
    throw new Error('Usage: node scripts/codex-patch-escrow-finalize-validation.mjs <prepared.json> <validation-report.json> <validated.json>');
  }
  const result = finalizePreparedPatchEscrowValidation(preparedPath, reportPath, outputPath);
  process.stdout.write(`${JSON.stringify({
    finalVerdict: 'PATCH_ESCROW_TRUSTED_FINALIZATION_PASS',
    bundleId: result.artifact.bundleId,
    patchSha256: result.artifact.patchSha256,
    expectedTreeSha: result.artifact.expectedTreeSha,
    artifactSha256: result.artifact.artifactSha256,
    outputPath: result.outputPath,
  }, null, 2)}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      finalVerdict: 'PATCH_ESCROW_TRUSTED_FINALIZATION_BLOCKED',
      message: text(error.message, 'unknown error'),
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
