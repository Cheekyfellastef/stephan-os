#!/usr/bin/env node
// Offline operator staging: pipe a separately downloaded SKILL.md through stdin.
// Never downloads, executes, installs, edits source, or publishes authority.
import { assessExternalSkillIntakeV1 } from '../../shared/skill-forge/externalSkillIntakeV1.mjs';

const HELP = [
  'Usage: node scripts/skills/stage-external-skill-review.mjs',
  '  --registry github|clawhub|skills-sh|openai|anthropic',
  '  --repo https://github.com/owner/repository',
  '  --revision <exact 40 or 64 hex commit>',
  '  --path path/to/SKILL.md --publisher <claim> --license <SPDX claim>',
  '  --name <display name> < staged-SKILL.md',
  '',
  'Prints a review-only JSON packet. Metadata are unverified claims.',
  'No download, source mutation, install, approval, or runtime execution.',
].join('\n');

function optionsFromArgs(args) {
  if (args.includes('--help') || args.includes('-h')) return { help: true };
  if (args.length % 2) throw new Error('Expected flag/value pairs.');
  const allowed = new Set(['--registry', '--repo', '--revision', '--path', '--publisher', '--license', '--name']);
  const parsed = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || Object.hasOwn(parsed, args[i])) throw new Error('Unknown or repeated flag.');
    parsed[args[i]] = args[i + 1];
  }
  return parsed;
}

async function run() {
  const opts = optionsFromArgs(process.argv.slice(2));
  if (opts.help) { process.stdout.write(HELP + '\n'); return; }
  const chunks = [];
  let length = 0;
  for await (const chunk of process.stdin) {
    length += chunk.length;
    if (length > 65536) throw new Error('SKILL.md exceeds 64 KiB maximum.');
    chunks.push(chunk);
  }
  const review = assessExternalSkillIntakeV1({
    name: opts['--name'],
    targetActor: 'openclaw-local',
    skillMd: Buffer.concat(chunks).toString('utf8'),
    source: {
      registry: opts['--registry'],
      repositoryUrl: opts['--repo'],
      revision: opts['--revision'],
      skillPath: opts['--path'],
      publisher: opts['--publisher'],
      licenseSpdx: opts['--license'],
    },
  });
  process.stdout.write(JSON.stringify({ externalSkillIntake: review }, null, 2) + '\n');
  if (review.verdict !== 'REVIEW_REQUIRED') process.exitCode = 2;
}

run().catch(error => {
  // Never echo file contents, paths, arguments, credentials or untrusted text.
  process.stderr.write('External skill review staging failed: invalid input or size limit.\n');
  process.exitCode = 2;
});
