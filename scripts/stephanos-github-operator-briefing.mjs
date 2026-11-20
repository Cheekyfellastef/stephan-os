#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { buildGitHubOperatorBriefing, renderGitHubOperatorBriefingHuman } from '../shared/agents/githubOperatorAssistantV1.mjs';
const args=process.argv.slice(2); const idx=args.indexOf('--input'); const inputPath=idx>=0?args[idx+1]:new URL('../tests/fixtures/github-operator-assistant/input.json', import.meta.url);
const payload=JSON.parse(await readFile(inputPath,'utf8'));
const briefing=buildGitHubOperatorBriefing(payload);
if(args.includes('--human')) console.log(renderGitHubOperatorBriefingHuman(briefing));
else console.log(JSON.stringify(briefing,null,2));
