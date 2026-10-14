#!/usr/bin/env node
// One verified pinned-source read. No scripts executed and no installation.
import { fetchPinnedGithubSkillV2 } from '../../shared/skill-forge/pinnedGithubSkillIntakeV2.mjs';

const HELP = [
  'Usage: node scripts/skills/fetch-pinned-github-skill-v2.mjs',
  ' --repo https://github.com/owner/repo --revision <40-char commit>',
  ' --path skills/any/SKILL.md --registry github|openai|anthropic',
  ' --publisher <claimed publisher> --license <claimed SPDX identifier>',
  ' --name <display title>',
  '',
  'One exact GitHub API GET, no recursive downloads or installations.',
  'This returns source-byte proof and a review-only candidate.',
  'License and publisher strings are claims until independently reviewed.',
].join('\n');

const allowed = new Map([
  ['--repo', 'repositoryUrl'], ['--revision', 'revision'],
  ['--path', 'skillPath'], ['--registry', 'registry'],
  ['--publisher', 'publisher'], ['--license', 'licenseSpdx'],
  ['--name', 'name'],
]);
function parseArgs(args) {
  if (args.length === 1 && ['-h', '--help'].includes(args[0])) return { help: true };
  if (args.length % 2) throw new Error('BAD_ARGUMENT_COUNT');
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = allowed.get(args[i]);
    if (!name || Object.hasOwn(parsed, name) || !args[i + 1]) throw new Error('BAD_ARGUMENT_FIELD');
    parsed[name] = args[i + 1];
  }
  return parsed;
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  if (input.help) { process.stdout.write(HELP + '\n'); return; }
  const result = await fetchPinnedGithubSkillV2(input);
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  if (result.verdict !== 'GITHUB_SOURCE_OBSERVED_REVIEW_REQUIRED') process.exitCode = 2;
}
main().catch(() => {
  // Never echo a fetch exception, arbitrary response text, token, or local path.
  process.stderr.write('PINNED_GITHUB_SKILL_INTAKE_BLOCKED\n');
  process.exitCode = 2;
});
