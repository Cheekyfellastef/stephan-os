import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPreparedPatchEscrowValidation } from './codex-patch-escrow-validate-prepared.mjs';
import { createValidatedPatchEscrowArtifact } from './codex-patch-escrow-validated-artifact.mjs';

function text(value, fallback = '') {
  if (value === null || value === undefined) return fallback;
  const normalized = String(value).trim();
  return normalized || fallback;
}

export async function attestPreparedPatchEscrow(preparedPath, validatedOutputPath, options = {}) {
  const sourcePath = resolve(preparedPath);
  const outputPath = resolve(validatedOutputPath);
  if (!existsSync(sourcePath)) throw new Error('prepared patch escrow artifact is missing');
  const preparedBytes = readFileSync(sourcePath);
  const validationResult = await runPreparedPatchEscrowValidation(sourcePath, options);
  const artifact = createValidatedPatchEscrowArtifact({ preparedBytes, validationResult });
  writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, { mode: 0o600 });
  return Object.freeze({ artifact, outputPath });
}

async function main() {
  const preparedPath = text(process.argv[2] || process.env.PATCH_ESCROW_PREPARED_PATH);
  const outputPath = text(process.argv[3] || process.env.PATCH_ESCROW_VALIDATED_PATH);
  if (!preparedPath || !outputPath) throw new Error('Usage: node scripts/codex-patch-escrow-attest.mjs <prepared.json> <validated.json>');
  const result = await attestPreparedPatchEscrow(preparedPath, outputPath, { repositoryRoot: process.env.GITHUB_WORKSPACE });
  process.stdout.write(`${JSON.stringify({
    finalVerdict: 'PATCH_ESCROW_ATTESTATION_PASS',
    bundleId: result.artifact.bundleId,
    patchSha256: result.artifact.patchSha256,
    preparedArtifactSha256: result.artifact.preparedArtifactSha256,
    expectedTreeSha: result.artifact.expectedTreeSha,
    artifactSha256: result.artifact.artifactSha256,
    outputPath: result.outputPath,
  }, null, 2)}\n`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === resolve(currentFile)) {
  main().catch((error) => {
    process.stderr.write(`${JSON.stringify({
      finalVerdict: 'PATCH_ESCROW_ATTESTATION_BLOCKED',
      message: text(error.message, 'unknown error'),
      details: error.details,
    }, null, 2)}\n`);
    process.exitCode = 1;
  });
}
