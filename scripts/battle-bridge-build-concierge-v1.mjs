import { readFileSync } from 'node:fs';
import { buildConciergePlan, buildConciergeProofPacket, validateExactHeadMergeApproval } from '../shared/agents/battleBridgeBuildConciergeV1.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const mode = process.argv[2] || 'plan';
const inputPath = process.argv[3];
const input = inputPath ? readJson(inputPath) : {};

let packet;
if (mode === 'plan') packet = buildConciergePlan(input);
else if (mode === 'proof-packet') packet = buildConciergeProofPacket(input);
else if (mode === 'validate-merge') packet = validateExactHeadMergeApproval(input);
else packet = { finalVerdict: 'BLOCKED_OR_UNKNOWN', blockers: [`Unknown Battle Bridge Concierge mode: ${mode}`] };

process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
process.exit(packet.finalVerdict && /BLOCKED|UNKNOWN/.test(packet.finalVerdict) ? 1 : 0);
