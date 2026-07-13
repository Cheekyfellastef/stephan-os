import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import {
  createPatchEscrowBundle,
  renderPatchEscrowChunkComment,
  renderPatchEscrowManifestComment,
  renderPatchEscrowPublishComment,
  validatePatchEscrowManifest,
} from '../shared/agents/codexPatchEscrow.mjs';

function fail(message) {
  process.stderr.write(`${JSON.stringify({ finalVerdict: 'PATCH_ESCROW_EXPORT_BLOCKED', message }, null, 2)}\n`);
  process.exit(1);
}

const configPath = process.argv[2];
const patchPath = process.argv[3];
const outputPath = process.argv[4];
if (!configPath || !patchPath || !outputPath) {
  fail('Usage: node scripts/codex-patch-escrow-export.mjs <config.json> <patch.diff> <output-directory>');
}

let config;
let patch;
try {
  config = JSON.parse(readFileSync(resolve(configPath), 'utf8'));
  patch = readFileSync(resolve(patchPath));
} catch (error) {
  fail(`Could not read patch export input: ${error.message}`);
}

const bundle = createPatchEscrowBundle({ ...config, patch });
const validation = validatePatchEscrowManifest(bundle.manifest);
if (!validation.valid) fail(`Patch escrow manifest blocked: ${validation.errors.join(', ')}`);

const outputDirectory = resolve(outputPath);
mkdirSync(outputDirectory, { recursive: true });
writeFileSync(join(outputDirectory, 'manifest.comment.md'), `${renderPatchEscrowManifestComment(bundle.manifest)}\n`);
bundle.chunks.forEach((chunk) => {
  writeFileSync(
    join(outputDirectory, `chunk-${String(chunk.index).padStart(3, '0')}-of-${String(chunk.count).padStart(3, '0')}.comment.md`),
    `${renderPatchEscrowChunkComment(chunk)}\n`,
  );
});
writeFileSync(join(outputDirectory, 'publish.comment.md'), `${renderPatchEscrowPublishComment(bundle.manifest.bundleId)}\n`);
writeFileSync(join(outputDirectory, 'bundle.json'), `${JSON.stringify(bundle, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  finalVerdict: 'PATCH_ESCROW_EXPORT_PASS',
  bundleId: bundle.manifest.bundleId,
  patchSha256: bundle.manifest.patchSha256,
  patchByteLength: bundle.manifest.patchByteLength,
  chunkCount: bundle.manifest.chunkCount,
  outputDirectory,
}, null, 2)}\n`);
