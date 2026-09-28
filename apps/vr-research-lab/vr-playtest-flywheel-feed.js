import { loadVrPlaytestLiveFeed, summarizeVrPlaytestFeed } from '../../shared/vr/vrPlaytestLiveFeedClient.mjs';

const PANEL_ID = 'vr-playtest-flywheel-panel';
const REFRESH_MS = 30000;

function element(tag, text = '', className = '') {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function ensurePanel() {
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = element('section');
  panel.id = PANEL_ID;
  panel.dataset.playtestFlywheel = 'waiting';

  const shell = element('div', '', 'panel');
  const heading = element('h2', 'Live Playtest Flywheel');
  const status = element('span', 'WAITING', 'pill');
  status.dataset.role = 'state';
  const summary = element('p', 'Waiting for a completed Shared Workspace VR playtest.');
  summary.dataset.role = 'summary';
  const findings = element('ul');
  findings.dataset.role = 'findings';
  findings.appendChild(element('li', 'No playtest evidence yet.'));
  const method = element('p', 'Reusable VR method candidates will appear here after Flywheel promotion.');
  method.dataset.role = 'method';

  shell.append(heading, status, summary, findings, method);
  panel.appendChild(shell);

  const main = document.querySelector('main') || document.body;
  const firstSection = main.querySelector('section');
  if (firstSection?.nextSibling) main.insertBefore(panel, firstSection.nextSibling);
  else main.appendChild(panel);
  return panel;
}

function render(feed) {
  const panel = ensurePanel();
  const latest = feed?.vrResearchLab?.latest;
  const summary = summarizeVrPlaytestFeed(feed);
  panel.dataset.playtestFlywheel = feed?.state || 'unknown';
  panel.querySelector('[data-role="state"]').textContent = summary.hasEvidence ? 'LIVE' : 'WAITING';
  if (!latest) return;
  panel.querySelector('[data-role="summary"]').textContent =
    latest.game + ' / ' + latest.mode + ' | AER faults ' + latest.sequenceFaultCount +
    ' | rollback ' + latest.rollback + ' | lesson ' + (summary.flywheelLessonId || 'pending');
  const list = panel.querySelector('[data-role="findings"]');
  list.replaceChildren();
  for (const finding of latest.reusableFindings || []) list.appendChild(element('li', finding));
  if (!list.children.length) list.appendChild(element('li', 'No reusable finding promoted from this session yet.'));
  panel.querySelector('[data-role="method"]').textContent = latest.techniqueCandidate || 'No technique candidate yet.';
}

async function refresh() {
  try {
    const feed = await loadVrPlaytestLiveFeed();
    globalThis.__STEPHANOS_VR_PLAYTEST_LIVE_FEED__ = feed;
    render(feed);
  } catch (error) {
    const panel = ensurePanel();
    panel.dataset.playtestFlywheel = 'unavailable';
    panel.querySelector('[data-role="state"]').textContent = 'OFFLINE';
    panel.querySelector('[data-role="summary"]').textContent =
      'Live Shared Workspace playtest feed unavailable: ' + String(error?.message || 'unknown');
  }
}

ensurePanel();
refresh();
setInterval(refresh, REFRESH_MS);
