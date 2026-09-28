import { loadVrPlaytestLiveFeed } from '../../shared/vr/vrPlaytestLiveFeedClient.mjs';

const PANEL_ID = 'starfield-vr-playtest-flywheel';
const REFRESH_MS = 30000;

function node(tag, text = '', className = '') {
  const out = document.createElement(tag);
  if (text) out.textContent = text;
  if (className) out.className = className;
  return out;
}

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;

  panel = node('section', '', 'glass-panel');
  panel.id = PANEL_ID;
  panel.setAttribute('aria-labelledby', 'starfield-vr-playtest-title');

  const kicker = node('p', 'LIVE PLAYTEST EVIDENCE', 'section-kicker');
  const title = node('h2', 'Starfield VR Flywheel');
  title.id = 'starfield-vr-playtest-title';
  const status = node('span', 'WAITING', 'status-pill');
  status.dataset.role = 'state';
  const summary = node('p', 'Waiting for a completed Starfield VR playtest in Shared Workspace.', 'muted-copy');
  summary.dataset.role = 'summary';
  const findings = node('ul', '', 'compact-list');
  findings.dataset.role = 'findings';
  findings.appendChild(node('li', 'No Starfield evidence packet yet.'));
  const provenance = node('p', '', 'muted-copy');
  provenance.dataset.role = 'provenance';

  panel.append(kicker, title, status, summary, findings, provenance);

  const shell = document.querySelector('.lab-shell') || document.querySelector('main') || document.body;
  const anchor = document.querySelector('.programme-strip');
  if (anchor) shell.insertBefore(panel, anchor);
  else shell.appendChild(panel);
  return panel;
}

function shortHash(value = '') {
  const text = String(value || '');
  return text ? text.slice(0, 12) : 'unknown';
}

function render(feed) {
  const panel = ensurePanel();
  const latest = feed?.starfieldReferenceLab?.latest;
  const status = panel.querySelector('[data-role="state"]');
  if (!latest) {
    status.textContent = feed?.state === 'unavailable' ? 'OFFLINE' : 'WAITING';
    return;
  }

  status.textContent = latest.nextMode === 'PROTECT' ? 'PROTECT READY' : 'OBSERVE';
  panel.querySelector('[data-role="summary"]').textContent =
    latest.route + ' / ' + latest.mode +
    ' | AER faults ' + latest.sequenceFaultCount +
    ' | max delta ' + latest.maxAbsDelta +
    ' | rollback ' + latest.rollback +
    ' | next ' + latest.nextMode;

  const list = panel.querySelector('[data-role="findings"]');
  list.replaceChildren();
  for (const finding of latest.findings || []) list.appendChild(node('li', finding));
  if (!list.children.length) list.appendChild(node('li', 'No title-specific finding promoted from this session yet.'));

  panel.querySelector('[data-role="provenance"]').textContent =
    'Baseline ' + shortHash(latest.baselineDllSha256) +
    ' | experiment ' + shortHash(latest.experimentalDllSha256) +
    ' | ' + latest.provenanceRef;
}

async function refresh() {
  try {
    const feed = await loadVrPlaytestLiveFeed();
    globalThis.__STEPHANOS_STARFIELD_VR_PLAYTEST_FEED__ = feed;
    render(feed);
  } catch (error) {
    const panel = ensurePanel();
    panel.querySelector('[data-role="state"]').textContent = 'OFFLINE';
    panel.querySelector('[data-role="summary"]').textContent =
      'Live Shared Workspace playtest feed unavailable: ' + String(error?.message || 'unknown');
  }
}

ensurePanel();
refresh();
setInterval(refresh, REFRESH_MS);
