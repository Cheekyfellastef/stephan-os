import { readFileSync } from 'node:fs';
import { buildGitHubOperatorBriefing, renderGitHubOperatorBriefing } from '../shared/agents/githubOperatorBriefing.mjs';

const args = process.argv.slice(2);
const inputIndex = args.indexOf('--input');
if (inputIndex === -1 || !args[inputIndex + 1]) {
  process.stderr.write('Usage: node scripts/github-operator-briefing.mjs --input <input.json> [--human]\n');
  process.exit(1);
}
const input = JSON.parse(readFileSync(args[inputIndex + 1], 'utf8'));
const briefing = buildGitHubOperatorBriefing(input);
process.stdout.write(renderGitHubOperatorBriefing(briefing, { human: args.includes('--human') }));
