import { readFile } from 'node:fs/promises';
import { assessOpenClawAgentCommandInventory } from '../shared/agents/openClawAgentCommandAudit.mjs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/assess-openclaw-agent-command-inventory.mjs <inventory.json>');
  process.exit(2);
}

try {
  const inventory = JSON.parse(await readFile(inputPath, 'utf8'));
  const assessment = assessOpenClawAgentCommandInventory(inventory);
  process.stdout.write(`${JSON.stringify(assessment, null, 2)}\n`);
  process.exitCode = assessment.allCommandsGrounded ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
