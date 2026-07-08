import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runBattleBridgePreflightVerifier } from './verificationHarness.mjs';

export const BATTLE_BRIDGE_PREFLIGHT_VERIFIER_VERSION = 'battle-bridge-preflight-verifier.v1';
export const DEFAULT_BATTLE_BRIDGE_PREFLIGHT_TARGETS = Object.freeze({
  backendHealthUrl: 'http://127.0.0.1:8787/api/health',
  openClawGatewayHealthUrl: 'http://127.0.0.1:8790/health',
  pluginId: 'stephanos-whatsapp-command',
  pluginRoot: 'integrations/openclaw/stephanos-whatsapp-command',
  missionWorkerQueueRootEnv: 'STEPHANOS_MISSION_ORCHESTRATOR_DIR',
});

function timestamp(clock = () => new Date()) {
  const value = clock();
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function runCommand(command, args, options = {}) {
  const runner = options.spawnSync || spawnSync;
  const result = runner(command, args, { cwd: options.cwd, encoding: 'utf8', timeout: options.timeoutMs || 5000 });
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: String(result.stdout || '').trim(),
    stderr: String(result.stderr || '').trim(),
    error: result.error?.message || '',
  };
}

async function probeJson(url, options = {}) {
  const fetchImpl = options.fetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { reachable: false, httpStatus: 0, payload: null, reason: 'fetch unavailable' };
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMs || 2500) : null;
  try {
    const response = await fetchImpl(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' }, signal: controller?.signal });
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    return { reachable: true, httpStatus: response.status, payload, reason: response.ok ? '' : `HTTP ${response.status}` };
  } catch (error) {
    return { reachable: false, httpStatus: 0, payload: null, reason: error?.name === 'AbortError' ? 'probe timed out' : (error?.message || 'probe failed') };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function safeSnippet(value, max = 120) {
  return String(value || '').replace(/[\r\n]+/g, ' ').slice(0, max);
}

export class VerificationRunner {
  constructor({ timestampUtc, clock, verifierVersion = BATTLE_BRIDGE_PREFLIGHT_VERIFIER_VERSION } = {}) {
    this.timestampUtc = timestampUtc || timestamp(clock);
    this.verifierVersion = verifierVersion;
  }

  async run(verifier, packet = {}, options = {}) {
    if (!verifier || typeof verifier.verify !== 'function') throw new Error('Reusable verifier interface requires verify(packet, options).');
    return verifier.verify(packet, { ...options, timestampUtc: options.timestampUtc || this.timestampUtc, verifierVersion: options.verifierVersion || this.verifierVersion });
  }
}

export class BattleBridgePreflightVerifier {
  constructor(options = {}) {
    this.repoRoot = options.repoRoot || process.cwd();
    this.targets = { ...DEFAULT_BATTLE_BRIDGE_PREFLIGHT_TARGETS, ...(options.targets || {}) };
    this.spawnSync = options.spawnSync;
    this.fetch = options.fetch;
    this.env = options.env || process.env;
    this.clock = options.clock;
    this.timeoutMs = options.timeoutMs || 2500;
  }

  async verify(packet = {}, options = {}) {
    const started = Date.now();
    const timestampUtc = options.timestampUtc || timestamp(this.clock);
    const collected = {
      git: this.verifyRepositoryState(packet.git),
      backend: await this.verifyBackendHealth(packet.backend),
      openClawGateway: await this.verifyOpenClawGateway(packet.openClawGateway),
      worker: this.verifyMissionWorker(packet.worker),
      files: this.verifyRequiredFiles(packet.files),
      plugin: this.verifyPluginAvailability(packet.plugin),
      task: this.verifyMissionWorker(packet.task),
    };
    return {
      ...runBattleBridgePreflightVerifier(collected, { timestampUtc, durationMs: Date.now() - started }),
      verifierVersion: options.verifierVersion || BATTLE_BRIDGE_PREFLIGHT_VERIFIER_VERSION,
      collectedAtUtc: timestampUtc,
      collectedEvidence: collected,
    };
  }

  verifyRepositoryState(overrides = {}) {
    const branch = runCommand('git', ['branch', '--show-current'], this).stdout;
    const head = runCommand('git', ['rev-parse', '--short=12', 'HEAD'], this).stdout;
    const status = runCommand('git', ['status', '--porcelain'], this).stdout;
    const rev = runCommand('git', ['rev-list', '--left-right', '--count', 'origin/main...HEAD'], this);
    const [behind = '0', ahead = '0'] = rev.status === 0 ? rev.stdout.split(/\s+/) : ['0', '0'];
    const repoExists = runCommand('git', ['rev-parse', '--is-inside-work-tree'], this).stdout === 'true';
    return { repoExists, branch, head, originMain: 'origin/main', repoClean: status.length === 0, ahead: Number(ahead) || 0, behind: Number(behind) || 0, ...overrides };
  }

  async verifyBackendHealth(overrides = {}) {
    const endpoint = overrides.endpoint || this.targets.backendHealthUrl;
    const probe = await probeJson(endpoint, this);
    return { backendHealthy: probe.httpStatus === 200 && probe.payload?.service === 'stephanos-server', httpStatus: probe.httpStatus, endpoint, service: probe.payload?.service || 'unknown', reason: probe.reason, ...overrides };
  }

  async verifyOpenClawGateway(overrides = {}) {
    const endpoint = overrides.endpoint || this.targets.openClawGatewayHealthUrl;
    const probe = await probeJson(endpoint, this);
    const identity = probe.payload?.service || probe.payload?.identity || probe.payload?.name || 'unknown';
    const command = probe.payload?.command || probe.payload?.gatewayCommand || '';
    return { endpoint, httpStatus: probe.httpStatus, endpointIdentity: identity, canExecute: probe.payload?.canExecute === true || probe.payload?.executionEnabled === true, command, safeRestartTarget: probe.payload?.safeRestartTarget || 'none', safeRestartTargetVerified: probe.payload?.safeRestartTargetVerified === true, reason: probe.reason, ...overrides };
  }

  verifyMissionWorker(overrides = {}) {
    const configuredRoot = this.env[this.targets.missionWorkerQueueRootEnv] || '';
    const workerQueue = configuredRoot ? path.join(configuredRoot, 'worker-queue') : '';
    const serviceSource = path.join(this.repoRoot, 'stephanos-server/services/missionOrchestratorWorkerService.js');
    return { workerRunning: Boolean(configuredRoot && existsSync(workerQueue)), workerMode: configuredRoot ? 'durable-queue' : 'unconfigured', taskState: existsSync(serviceSource) ? 'service-source-present' : 'service-source-missing', stephanosBackendTask: existsSync(serviceSource) ? 'ready' : 'missing', taskReady: existsSync(serviceSource), ...overrides };
  }

  verifyRequiredFiles(overrides = {}) {
    const pluginRoot = path.join(this.repoRoot, this.targets.pluginRoot);
    const required = ['openclaw.plugin.json', 'index.js', 'package.json'].map((name) => path.join(pluginRoot, name));
    return { filesPresent: required.every((file) => existsSync(file)), sourcePresent: existsSync(path.join(this.repoRoot, 'shared/agents/verificationHarness.mjs')), targetPluginSourcePresent: existsSync(pluginRoot), ...overrides };
  }

  verifyPluginAvailability(overrides = {}) {
    const pluginRoot = path.join(this.repoRoot, this.targets.pluginRoot);
    const manifestPath = path.join(pluginRoot, 'openclaw.plugin.json');
    let manifestId = 'missing';
    try { manifestId = JSON.parse(readFileSync(manifestPath, 'utf8')).id || 'unknown'; } catch {}
    const openclaw = runCommand('openclaw', ['plugins', 'inspect', this.targets.pluginId, '--runtime', '--json'], this);
    const runtimePresent = openclaw.status === 0 || overrides.pluginRuntimePresent === true;
    return { pluginRuntimePresent: runtimePresent, targetPluginSourcePresent: existsSync(pluginRoot), manifestId, inspectStatus: openclaw.status, inspectOutput: safeSnippet(openclaw.stdout || openclaw.stderr), ...overrides };
  }
}

export async function runBattleBridgePreflightProduction(options = {}) {
  const runner = new VerificationRunner(options);
  return runner.run(new BattleBridgePreflightVerifier(options), options.packet || {}, options);
}
