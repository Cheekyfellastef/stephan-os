#!/usr/bin/env node
import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { planLauncherReadiness } from './launcher-readiness-planner.mjs';

export const LAUNCHER_READINESS_REPORT_SCHEMA = 'stephanos.launcher-readiness-report.v1';

export const READINESS_STATUS = Object.freeze({
  ready: 'READY',
  'partial-ui-missing': 'PARTIAL_UI_MISSING',
  'stale-workspace': 'STALE_WORKSPACE',
  'partial-openclaw-missing': 'PARTIAL_OPENCLAW_MISSING',
  'blocked-dirty-source': 'BLOCKED_DIRTY_SOURCE',
  'blocked-needs-supervisor-repair': 'BLOCKED_NEEDS_SUPERVISOR_REPAIR',
  'blocked-unsafe-launcher-command': 'BLOCKED_NEEDS_SUPERVISOR_REPAIR',
  'partial-backend-only': 'BLOCKED_NEEDS_SUPERVISOR_REPAIR',
});

export const PROOF_COMMANDS = Object.freeze({
  backend8787: Object.freeze({
    id: 'port-8787-backend',
    purpose: 'Prove backend 8787 listener/health without starting services.',
    command: 'powershell.exe -NoProfile -Command "Test-NetConnection 127.0.0.1 -Port 8787; Invoke-RestMethod http://127.0.0.1:8787/api/health"',
  }),
  ui4173: Object.freeze({
    id: 'port-4173-stephanos-ui',
    purpose: 'Prove Stephanos UI 4173 listener without starting services.',
    command: 'powershell.exe -NoProfile -Command "Test-NetConnection 127.0.0.1 -Port 4173; Invoke-WebRequest http://127.0.0.1:4173/ -UseBasicParsing"',
  }),
  openclaw18789: Object.freeze({
    id: 'port-18789-openclaw-gateway',
    purpose: 'Prove OpenClaw gateway 18789 listener/readiness without starting services.',
    command: 'powershell.exe -NoProfile -Command "Test-NetConnection 127.0.0.1 -Port 18789; Invoke-RestMethod http://127.0.0.1:18789/health"',
  }),
  sharedWorkspaceCurrent: Object.freeze({
    id: 'shared-workspace-current-records',
    purpose: 'Inspect shared workspace current records freshness without mutating runtime state.',
    command: 'powershell.exe -NoProfile -Command "Get-ChildItem .\\runtime-activity\\shared-workspace\\current -File | Select-Object Name,LastWriteTime,Length"',
  }),
});

const FORBIDDEN_COMMAND_TEXT = /\b(?:rm\s+-rf|kill|taskkill|Start-Process|npm\s+run\s+(?:dev|stephanos|stephanos:serve|stephanos:ignite)|git\s+(?:merge|push|reset|clean)|powershell(?:\.exe)?\s+.*(?:Start-Service|Stop-Process))\b/i;

export function assertSafeDescriptiveCommand(command) {
  if (typeof command !== 'string' || !command.trim()) throw new Error('Proof command must be non-empty descriptive text.');
  if (FORBIDDEN_COMMAND_TEXT.test(command)) throw new Error(`Unsafe proof command text rejected: ${command}`);
  return command;
}

export function createLauncherReadinessReport(facts = {}) {
  const requestedProofCommands = Object.values(PROOF_COMMANDS).map((proof) => ({
    ...proof,
    command: assertSafeDescriptiveCommand(proof.command),
  }));
  const plan = planLauncherReadiness(facts);
  const status = READINESS_STATUS[plan.finalVerdict] || 'BLOCKED_NEEDS_SUPERVISOR_REPAIR';
  const uiMissingAction = 'Operator: repair/start Stephanos UI 4173 using an allowlisted launcher path only after proof confirms backend 8787 and OpenClaw 18789, then rerun npm run ignition:readiness with fresh observed facts.';

  return {
    schema: LAUNCHER_READINESS_REPORT_SCHEMA,
    status,
    verdict: plan.finalVerdict,
    observedServices: plan.observedServices,
    missingServices: plan.missingServices,
    staleWorkspaceRecords: plan.staleWorkspaceRecords,
    safetyBlockers: plan.safetyBlockers,
    caveats: plan.caveats,
    nextOperatorAction: status === 'PARTIAL_UI_MISSING' ? uiMissingAction : plan.smallestNextOperatorAction,
    proofCommands: requestedProofCommands,
    authority: {
      executesCommands: false,
      startsServices: false,
      killsProcesses: false,
      mergesOrPushes: false,
      mutatesRuntime: false,
    },
    plan,
  };
}

function parseArgs(argv) {
  const args = { facts: null, pretty: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--facts') args.facts = argv[++i];
    else if (argv[i] === '--json') args.pretty = false;
    else if (argv[i] === '--help') args.help = true;
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return args;
}

function loadFacts(factsArg) {
  if (!factsArg) return {};
  const raw = factsArg.trim().startsWith('{') ? factsArg : fs.readFileSync(factsArg, 'utf8');
  return JSON.parse(raw);
}

export function main(argv = process.argv.slice(2), stdout = process.stdout) {
  const args = parseArgs(argv);
  if (args.help) {
    stdout.write('Usage: node scripts/launcher-readiness-report.mjs --facts <fixture-or-json> [--json]\n');
    return 0;
  }
  const report = createLauncherReadinessReport(loadFacts(args.facts));
  stdout.write(`${JSON.stringify(report, null, args.pretty ? 2 : 0)}\n`);
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
