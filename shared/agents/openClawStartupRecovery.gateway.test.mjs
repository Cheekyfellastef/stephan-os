import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenClawStartupRecoveryPacket,
  classifyOpenClawReadiness,
  findVerifiedOpenClawStandaloneGatewayCandidate,
} from './openClawStartupRecovery.mjs';

const liveGatewayProcess = {
  pid: 30220,
  name: 'node.exe',
  commandLine: '"C:\\Program Files\\nodejs\\node.exe"  "C:\\Users\\Stephan Callear\\AppData\\Roaming\\npm\\node_modules\\openclaw\\dist\\index.js" gateway --port 18789',
  executablePath: 'C:\\Program Files\\nodejs\\node.exe',
};

const liveGatewayPort = {
  localAddress: '127.0.0.1',
  localPort: 18789,
  owningProcess: 30220,
  state: 'Listen',
};

test('recognizes npm global OpenClaw dist gateway on owned 18789 port', () => {
  const candidate = findVerifiedOpenClawStandaloneGatewayCandidate({
    candidateProcesses: [
      { pid: 1908, name: 'node.exe', commandLine: 'node.exe scripts/openclaw-readonly-adapter-stub.mjs' },
      liveGatewayProcess,
    ],
    candidatePorts: [
      { localAddress: '127.0.0.1', localPort: 8790, owningProcess: 1908, state: 'Listen' },
      liveGatewayPort,
    ],
  });

  assert.equal(candidate.verified, true);
  assert.equal(candidate.pid, 30220);
  assert.equal(candidate.candidatePort, 18789);
  assert.equal(candidate.identity, 'standalone-gateway-candidate');
});

test('classifies owned npm global OpenClaw gateway health as live and does not require restart', () => {
  const candidate = findVerifiedOpenClawStandaloneGatewayCandidate({
    candidateProcesses: [liveGatewayProcess],
    candidatePorts: [liveGatewayPort],
  });

  const classification = classifyOpenClawReadiness({
    process: { running: true, name: 'node.exe', commandLine: 'node.exe scripts/openclaw-readonly-adapter-stub.mjs' },
    service: { running: false, name: 'OpenClaw', state: 'missing', exists: false, verified: false },
    endpoint: { reachable: true, httpStatus: 200, body: '{"ok":true,"status":"live"}', identityVerified: false, connectionStatus: 'live' },
    standaloneGatewayCandidate: candidate,
  });

  assert.equal(classification.state, 'openclaw-standalone-gateway-live');
  assert.equal(classification.healthy, true);
  assert.equal(classification.connectionVerdict, 'openclaw-standalone-gateway-live');
  assert.equal(classification.endpointIdentityVerified, true);
  assert.equal(classification.restartCommandAllowed, false);
  assert.equal(classification.safeRestartTarget, 'none');
});

test('does not report recovery packet when npm global OpenClaw gateway is verified live', () => {
  const candidate = findVerifiedOpenClawStandaloneGatewayCandidate({
    candidateProcesses: [liveGatewayProcess],
    candidatePorts: [liveGatewayPort],
  });

  const packet = buildOpenClawStartupRecoveryPacket({
    process: { running: true, name: 'node.exe', commandLine: 'node.exe scripts/openclaw-readonly-adapter-stub.mjs' },
    service: { running: false, name: 'OpenClaw', state: 'missing', exists: false, verified: false },
    endpoint: { reachable: true, httpStatus: 200, body: '{"ok":true,"status":"live"}', identityVerified: false, connectionStatus: 'live' },
    standaloneGatewayCandidate: candidate,
    candidatePort: 18789,
    selectedReadinessEndpoint: 'http://127.0.0.1:18789/health',
  });

  assert.equal(packet, null);
});
