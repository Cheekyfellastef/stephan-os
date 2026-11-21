import fs from 'node:fs';
import path from 'node:path';
import { OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY } from './openClawWorkspaceHygiene.mjs';

export const OPENCLAW_GATEWAY_STARTUP_SOURCE = 'shared:openclaw-control-panel-start-gateway';
export const OPENCLAW_GATEWAY_APPROVED_PORT = 18789;
export const OPENCLAW_GATEWAY_APPROVED_ENDPOINT = `http://127.0.0.1:${OPENCLAW_GATEWAY_APPROVED_PORT}`;
export const OPENCLAW_GATEWAY_STARTUP_GUARDRAILS = Object.freeze({
  openClawTaskExecutionAllowed: false,
  mutationAllowed: true,
  codexDispatchAllowed: false,
  mergeReadinessChangeAllowed: false,
  paidApiUsageAllowed: false,
});

export const OPENCLAW_GATEWAY_STARTGATEWAY_APPROVAL = Object.freeze({
  required: true,
  actionId: 'approve-openclaw-control-panel-startgateway',
  reason: 'Battle Bridge/OpenClaw startup starts the Windows OpenClaw gateway service/process with openclaw gateway start --json; tokens are provided through the child process environment and OpenClaw config is not rewritten.',
  envFlag: 'STEPHANOS_APPROVE_OPENCLAW_CONTROL_PANEL_STARTGATEWAY',
});

export function resolveOpenClawGatewayStartToken({ env = process.env, token = '' } = {}) {
  return String(token || env.STEPHANOS_OPENCLAW_GATEWAY_TOKEN || env.OPENCLAW_GATEWAY_TOKEN || '').trim();
}

export function openClawGatewayStartApprovalGranted({ env = process.env, approved = false } = {}) {
  return approved === true || /^(1|true|yes|approved)$/i.test(String(env[OPENCLAW_GATEWAY_STARTGATEWAY_APPROVAL.envFlag] || ''));
}

export function getOpenClawGatewayStartupCommand() {
  return 'openclaw gateway start --json';
}

export function redactOpenClawGatewayStartupCommand(value = '') {
  return String(value || '').replace(/(OPENCLAW(?:_GATEWAY)?_TOKEN=)(?:'[^']*'|\S+)/gi, '$1<redacted-token>');
}

export function splitOpenClawGatewayStartupCommand(value = getOpenClawGatewayStartupCommand()) {
  const parts = String(value || '').match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.replace(/^"|"$/g, ''));
}

export function isFixedOpenClawGatewayStartCommand(value = '') {
  return String(value || '').trim() === getOpenClawGatewayStartupCommand();
}

export function npmGlobalBinCandidatesForOpenClaw({ env = process.env } = {}) {
  const candidates = [];
  const append = (value) => {
    const normalized = String(value || '').trim();
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
  };
  if (env.APPDATA) { append(path.win32.join(env.APPDATA, 'npm')); append(path.join(env.APPDATA, 'npm')); }
  if (env.NPM_CONFIG_PREFIX) { append(path.win32.join(env.NPM_CONFIG_PREFIX, 'bin')); append(path.join(env.NPM_CONFIG_PREFIX, 'bin')); }
  if (env.ProgramFiles) { append(path.win32.join(env.ProgramFiles, 'nodejs')); append(path.join(env.ProgramFiles, 'nodejs')); }
  if (env['ProgramFiles(x86)']) { append(path.win32.join(env['ProgramFiles(x86)'], 'nodejs')); append(path.join(env['ProgramFiles(x86)'], 'nodejs')); }
  return candidates;
}

function uniqueCandidates(candidates = []) {
  return candidates.filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
}

function windowsPathEntries({ env = process.env } = {}) {
  return String(env.Path || env.PATH || '').split(';').filter(Boolean);
}

function findWindowsProgram({ names = [], env = process.env, existsSync = fs.existsSync } = {}) {
  for (const dir of windowsPathEntries({ env })) {
    for (const name of names) {
      for (const candidate of uniqueCandidates([path.win32.join(dir, name), path.join(dir, name)])) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return '';
}

function findOpenClawWindowsShim({ env = process.env, existsSync = fs.existsSync } = {}) {
  const searchDirs = [...windowsPathEntries({ env }), ...npmGlobalBinCandidatesForOpenClaw({ env })];
  const names = ['openclaw.cmd', 'openclaw.bat', 'openclaw.exe', 'openclaw.ps1', 'openclaw'];
  for (const dir of searchDirs) {
    for (const name of names) {
      for (const candidate of uniqueCandidates([path.win32.join(dir, name), path.join(dir, name)])) {
        if (existsSync(candidate)) return { shim: candidate, searchedDirs: searchDirs };
      }
    }
  }
  return { shim: '', searchedDirs: searchDirs };
}

export function resolveOpenClawGatewayWindowsExecutable({ commandText = getOpenClawGatewayStartupCommand(), env = process.env, existsSync = fs.existsSync } = {}) {
  if (!isFixedOpenClawGatewayStartCommand(commandText)) {
    return { ok: false, reason: 'startup-command-not-fixed-allowlisted', command: '', commandArgs: [] };
  }
  const { shim, searchedDirs } = findOpenClawWindowsShim({ env, existsSync });
  const appDataNpm = env.APPDATA ? path.win32.join(env.APPDATA, 'npm') : '';
  const openClawMjs = appDataNpm ? path.win32.join(appDataNpm, 'node_modules', 'openclaw', 'openclaw.mjs') : '';
  const nodeExe = findWindowsProgram({ names: ['node.exe'], env, existsSync });
  if (openClawMjs && nodeExe && existsSync(openClawMjs)) {
    return { ok: true, source: 'windows-appdata-npm-node-entrypoint', strategy: 'node-entrypoint', command: nodeExe, commandArgs: [openClawMjs, 'gateway', 'start', '--json'], commandText: getOpenClawGatewayStartupCommand(), executesArbitraryShell: false, resolvedOpenClawPath: openClawMjs, resolvedExecutable: nodeExe, searchedDirs };
  }
  if (/\.cmd$/i.test(shim)) {
    return { ok: true, source: 'windows-cmd-shim', strategy: 'cmd-shim', command: 'cmd.exe', commandArgs: ['/d', '/s', '/c', `""${shim}" gateway start --json"`], commandText: getOpenClawGatewayStartupCommand(), executesArbitraryShell: false, resolvedOpenClawPath: shim, resolvedExecutable: 'cmd.exe', searchedDirs };
  }
  if (shim && !/\.(?:bat|cmd|ps1)$/i.test(shim) && path.win32.extname(shim)) {
    return { ok: true, source: 'windows-native-executable', strategy: 'native-executable', command: shim, commandArgs: ['gateway', 'start', '--json'], commandText: getOpenClawGatewayStartupCommand(), executesArbitraryShell: false, resolvedOpenClawPath: shim, resolvedExecutable: shim, searchedDirs };
  }
  return { ok: false, reason: 'openclaw-executable-not-found', command: '', commandArgs: [], commandText: getOpenClawGatewayStartupCommand(), searchedDirs };
}

export function resolveOpenClawGatewayStartupExecution({ target, env = process.env, platform = process.platform, existsSync = fs.existsSync } = {}) {
  if (!target?.available) return { ok: false, reason: target?.reason || 'startup-target-unavailable', command: '', commandArgs: [] };
  if (!isFixedOpenClawGatewayStartCommand(target.commandText)) return { ok: false, reason: 'startup-command-not-fixed-allowlisted', command: '', commandArgs: [] };
  if (platform === 'win32') return resolveOpenClawGatewayWindowsExecutable({ commandText: target.commandText, env, existsSync });
  return { ok: true, source: 'posix-path', command: 'openclaw', commandArgs: ['gateway', 'start', '--json'], commandText: getOpenClawGatewayStartupCommand(), executesArbitraryShell: false };
}

export function hasForbiddenOpenClawGatewayStartupToken(value = '') {
  return /\b(codex|dispatch|task|execute|mutation|mutate|merge-ready|merge\s+readiness|git\s+(?:push|merge|commit)|openai|anthropic|paid)\b/i.test(String(value || ''));
}

export function mutatesOpenClawGatewayConfig(value = '') {
  return /\bopenclaw\s+config\s+(?:set|write|put|update)\b/i.test(String(value || ''));
}

export function buildOpenClawGatewayStartupTarget({ commandText = '', source = OPENCLAW_GATEWAY_STARTUP_SOURCE, env = process.env, token = '', approved = false } = {}) {
  const resolvedToken = resolveOpenClawGatewayStartToken({ env, token });
  const approvalGranted = openClawGatewayStartApprovalGranted({ env, approved });
  const text = String(commandText || getOpenClawGatewayStartupCommand() || '').trim();
  const argv = splitOpenClawGatewayStartupCommand(text);
  const startsApprovedGateway = /openclaw\s+gateway\s+start\s+--json/i.test(text);
  const legacyForceRunGateway = /openclaw\s+gateway\s+run\s+--force/i.test(text);
  const configMutation = mutatesOpenClawGatewayConfig(text);
  const portMatch = text.match(/(?:^|\s)--port(?:=|\s+)(\d{2,5})(?:\s|$)/i);
  const port = (startsApprovedGateway || legacyForceRunGateway) ? OPENCLAW_GATEWAY_APPROVED_PORT : Number(portMatch?.[1] || 0);
  const blockedReason = !text
    ? 'startup-command-missing'
    : argv.length === 0
      ? 'startup-command-empty'
      : hasForbiddenOpenClawGatewayStartupToken(text)
        ? 'startup-command-violates-guardrails'
        : configMutation && !resolvedToken
          ? 'startup-token-missing'
          : configMutation
            ? 'startup-command-violates-guardrails'
            : !approvalGranted
              ? 'startup-approval-required'
              : port !== OPENCLAW_GATEWAY_APPROVED_PORT
                ? 'startup-command-port-not-approved'
                : '';
  return {
    id: 'gateway',
    source,
    commandText: redactOpenClawGatewayStartupCommand(text),
    command: text.startsWith('$') ? 'powershell.exe' : (argv[0] || ''),
    commandArgs: text.startsWith('$') ? ['-NoProfile', '-Command', text] : argv.slice(1),
    port,
    endpoint: OPENCLAW_GATEWAY_APPROVED_ENDPOINT,
    workspacePath: OPENCLAW_WORKSPACE_EXTERNAL_DIRECTORY,
    available: !blockedReason,
    blocked: Boolean(blockedReason),
    reason: blockedReason,
    guardrails: OPENCLAW_GATEWAY_STARTUP_GUARDRAILS,
    approval: { ...OPENCLAW_GATEWAY_STARTGATEWAY_APPROVAL, granted: approvalGranted },
    mutatesOpenClaw: true,
    killsProcesses: legacyForceRunGateway,
    startsOpenClawGatewayServiceOrProcess: startsApprovedGateway,
    mayMutateOpenClawGatewayServiceOrRuntimeState: true,
    mutatesOpenClawConfig: configMutation,
    repoMutationAllowed: false,
    mergePushInstallAllowed: false,
  };
}
