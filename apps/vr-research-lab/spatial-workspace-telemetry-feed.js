import { requestStephanosBackend } from '../../shared/runtime/backendClient.mjs';
import {
  SPATIAL_WORKSPACE_TELEMETRY_FEED_ROUTE,
  SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1,
} from '../../shared/vr/spatialWorkspaceTelemetryContractV1.mjs';

const PANEL_ID = 'spatial-workspace-telemetry-panel';
const REFRESH_MS = 15_000;

function node(tag, text = '', className = '') {
  const out = document.createElement(tag);
  if (text) out.textContent = text;
  if (className) out.className = className;
  return out;
}

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = node('section');
  panel.id = PANEL_ID;
  panel.dataset.spatialTelemetry = 'waiting';

  const shell = node('div', '', 'panel');
  const heading = node('h2', 'Spatial Workspace Telemetry');
  const state = node('span', 'WAITING', 'pill');
  state.dataset.role = 'state';
  const summary = node('p', 'Waiting for a Quest Spatial Workspace run.');
  summary.dataset.role = 'summary';
  const metrics = node('ul');
  metrics.dataset.role = 'metrics';
  metrics.appendChild(node('li', 'No immersive telemetry yet.'));
  const provenance = node('p', '', 'muted-copy');
  provenance.dataset.role = 'provenance';

  shell.append(heading, state, summary, metrics, provenance);
  panel.appendChild(shell);

  const main = document.querySelector('main') || document.body;
  const flywheel = document.getElementById('vr-playtest-flywheel-panel');
  if (flywheel?.nextSibling) main.insertBefore(panel, flywheel.nextSibling);
  else if (flywheel) main.appendChild(panel);
  else {
    const firstSection = main.querySelector('section');
    if (firstSection?.nextSibling) main.insertBefore(panel, firstSection.nextSibling);
    else main.appendChild(panel);
  }
  return panel;
}

function shortHead(value) {
  const text = String(value || '');
  return text.length >= 8 ? text.slice(0, 8) : (text || 'unknown');
}

function render(feed) {
  const panel = ensurePanel();
  panel.dataset.spatialTelemetry = feed?.state || 'unknown';
  const latest = feed?.latest?.evidence;
  panel.querySelector('[data-role="state"]').textContent = latest
    ? String(feed.state || 'ready').toUpperCase()
    : 'WAITING';
  if (!latest) return;

  const fps = Number(latest.frame?.estimatedFps || 0);
  const maxFrame = Number(latest.frame?.maxFrameMs || 0);
  panel.querySelector('[data-role="summary"]').textContent =
    `${latest.device} · ${latest.phase.toUpperCase()} · ${latest.frame.count} frames · ${fps ? fps.toFixed(1) + ' fps' : 'fps pending'}`;

  const list = panel.querySelector('[data-role="metrics"]');
  list.replaceChildren();
  [
    `Pose frames: ${latest.frame.poseFrames}; missing pose: ${latest.frame.missingPoseFrames}; tracking losses: ${latest.frame.trackingLossCount}`,
    `Max frame time: ${maxFrame.toFixed(2)} ms; average: ${Number(latest.frame.averageFrameMs || 0).toFixed(2)} ms`,
    `XR input sources: ${latest.input.sourceCountMax}; hand tracked: ${latest.input.handTrackedSourceCountMax}`,
    `Select events: ${latest.input.selectCount}; squeeze events: ${latest.input.squeezeCount}; source changes: ${latest.input.inputSourceChangeCount}`,
    `Bounded runtime errors: ${latest.errorCount || 0}`,
  ].forEach((item) => list.appendChild(node('li', item)));

  panel.querySelector('[data-role="provenance"]').textContent =
    `Exact head ${shortHead(latest.sourceHead)} · run ${latest.runId} · ${latest.observedAtUtc}`;
}

async function refresh() {
  try {
    const response = await requestStephanosBackend({
      path: SPATIAL_WORKSPACE_TELEMETRY_FEED_ROUTE,
      timeoutMs: 3500,
    });
    const feed = response?.json;
    if (feed?.schemaVersion !== SPATIAL_WORKSPACE_TELEMETRY_FEED_SCHEMA_V1 || feed?.readOnly !== true) {
      throw new Error('spatial-telemetry-feed-invalid');
    }
    globalThis.__STEPHANOS_SPATIAL_WORKSPACE_TELEMETRY__ = feed;
    render(feed);
  } catch (error) {
    const panel = ensurePanel();
    panel.dataset.spatialTelemetry = 'unavailable';
    panel.querySelector('[data-role="state"]').textContent = 'OFFLINE';
    panel.querySelector('[data-role="summary"]').textContent =
      'Live Spatial Workspace telemetry unavailable: ' + String(error?.message || 'unknown');
  }
}

ensurePanel();
refresh();
setInterval(refresh, REFRESH_MS);
