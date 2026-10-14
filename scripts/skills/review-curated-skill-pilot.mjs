#!/usr/bin/env node
// Operator-supplied bytes only; no fetch, write, exec or privilege changes.
import { reviewCuratedSourcePilotV1 } from '../../shared/skill-forge/curatedExternalSkillPilotV1.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== 'openai-skill-creator') {
    process.stderr.write('Usage: node scripts/skills/review-curated-skill-pilot.mjs openai-skill-creator < staged-SKILL.md\n');
    process.exitCode = 2;
    return;
  }
  const parts = [];
  let count = 0;
  for await (const part of process.stdin) {
    count += part.length;
    if (count > 65536) {
      process.stderr.write('Review blocked: input exceeds 64 KiB.\n');
      process.exitCode = 2;
      return;
    }
    parts.push(part);
  }
  const review = reviewCuratedSourcePilotV1(args[0], Buffer.concat(parts));
  process.stdout.write(JSON.stringify({ curatedExternalSkillPilot: review }, null, 2) + '\n');
  if (review.verdict !== 'SOURCE_BYTES_PIN_MATCHED_REVIEW_REQUIRED') process.exitCode = 2;
}
main().catch(() => { process.stderr.write('Review blocked: invalid input.\n'); process.exitCode = 2; });
