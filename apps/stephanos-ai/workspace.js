import { queryStephanosAI } from '../../shared/ai/stephanosClient.mjs';
import { requestStephanosBackend } from '../../shared/runtime/backendClient.mjs';
import { projectControlReplyForSurfaceV1 } from './controlSurface.mjs';

const agents = [
  { id:'everyone', label:'Everyone', icon:'◎', subtitle:'Stephanos AI · whole project', kind:'agent' },
  { id:'sovereign-commander', label:'Sovereign Commander', icon:'♛', subtitle:'Battle Bridge · guarded command', kind:'agent' },
  { id:'control-tower', label:'Control Tower', icon:'⌁', subtitle:'Control status · requests · receipts', kind:'agent' },
  { id:'flywheel', label:'Flywheel', icon:'◉', subtitle:'Learning · uplift · improvement', kind:'agent' },
  { id:'openclaw-local', label:'OpenClaw Local', icon:'⬡', subtitle:'Stephanos-scoped local worker', kind:'agent' },
  { id:'openclaw-standalone', label:'OpenClaw Standalone', icon:'◇', subtitle:'Whole-PC guarded worker', kind:'agent' },
  { id:'vr-agent', label:'VR Agent', icon:'◫', subtitle:'VR research · telemetry · spatial', kind:'agent' },
  { id:'builders', label:'Builders', icon:'⚒', subtitle:'Build fabric · lanes · proof', kind:'agent' },
  { id:'controllers', label:'Controllers', icon:'≡', subtitle:'Mission loops · orchestration', kind:'agent' },
  { id:'research', label:'Research', icon:'⌕', subtitle:'Evidence · synthesis · discovery', kind:'agent' },
  { id:'battle-bridge', label:'Battle Bridge', icon:'⌾', subtitle:'Runtime · telemetry · machine truth', kind:'agent' },
];

const groups = [
  { id:'vr-team', label:'VR Team', icon:'◫', subtitle:'VR Agent + telemetry + builders', kind:'group' },
  { id:'builder-team', label:'Builders', icon:'⚒', subtitle:'Build and proof lanes', kind:'group' },
  { id:'controller-team', label:'Controllers', icon:'≡', subtitle:'Controllers and mission fabric', kind:'group' },
];

const histories = new Map();
let selected = agents[0];
let busy = false;

const $ = (id) => document.getElementById(id);
const agentList = $('agentList');
const groupList = $('groupList');
const messages = $('messages');
const prompt = $('prompt');
const composer = $('composer');
const sendButton = $('sendButton');
const targetSelect = $('targetSelect');
const lastRouteResults = new Map();

function historyFor(id) {
  if (!histories.has(id)) histories.set(id, []);
  return histories.get(id);
}

function makeButton(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'agent-button';
  button.dataset.target = item.id;
  button.innerHTML = `
    <span class="agent-icon">${item.icon}</span>
    <span class="agent-copy"><b>${item.label}</b><small>${item.subtitle}</small></span>
    <span class="status-dot unknown" aria-label="Presence not yet proven"></span>`;
  button.addEventListener('click', () => selectTarget(item));
  return button;
}

function renderNav() {
  agentList.replaceChildren(...agents.map(makeButton));
  groupList.replaceChildren(...groups.map(makeButton));
  targetSelect.replaceChildren(...[...agents, ...groups].map(item => {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label;
    return option;
  }));
  updateNavSelection();
}

function updateNavSelection() {
  document.querySelectorAll('.agent-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.target === selected.id);
  });
  targetSelect.value = selected.id;
}

function selectTarget(item) {
  selected = item;
  updateNavSelection();
  $('routeLabel').textContent = 'Canonical AI route';
  $('targetTitle').textContent = item.id === 'everyone' ? 'Stephanos AI' : item.label;
  $('targetSubtitle').textContent = item.id === 'everyone'
    ? 'Chat with the whole project, agents, and teams.'
    : `Address ${item.label} through the shared Stephanos conversation route.`;
  $('addressChip').textContent = item.label;
  $('contextTarget').textContent = item.label;
  $('presenceTruth').textContent = item.id === 'everyone' ? 'project conversation route' : 'addressed identity; direct presence unproven';
  $('routerTruth').textContent = 'not yet observed for this conversation';
  $('lastResponse').textContent = 'none';
  $('healthDot').classList.remove('live', 'routed');
  $('healthDot').classList.add('unknown');
  if (lastRouteResults.has(item.id)) noteRouteTruth(lastRouteResults.get(item.id), item.id);
  prompt.placeholder = item.id === 'everyone' ? 'Message Stephanos AI…' : `Message ${item.label}…`;
  renderMessages();
  if (window.matchMedia('(pointer: fine)').matches) prompt.focus();
}

function escapeText(value='') {
  const span = document.createElement('span');
  span.textContent = String(value);
  return span.innerHTML;
}

function controlCard(result, entryIndex, dispatchStatus = '') {
  const control = projectControlReplyForSurfaceV1(result);
  if (!control) return '';
  const request = control.request;
  const handoff = control.handoff;
  return `<section class="control-receipt" aria-label="Sovereign control receipt">
    <div class="control-receipt-heading"><b>Control receipt</b><span>No model used</span></div>
    <p class="control-observation">Observed ${escapeText(control.observedAtUtc)}</p>
    ${request ? `<dl><div><dt>${request.historical ? 'Retained request' : 'Observed request'}</dt><dd>${escapeText(request.requestId)}</dd></div><div><dt>Outcome</dt><dd>${escapeText(request.label)}</dd></div></dl>` : '<p class="control-observation">No request outcome has been proven in this reply.</p>'}
    ${control.unresolvedBuild ? `<p class="control-unresolved">Earlier build ${escapeText(control.unresolvedBuild.requestId)}: ${escapeText(control.unresolvedBuild.label)}. An inspection does not resolve that request.</p>` : ''}
    ${handoff ? `<div class="control-handoff"><b>${escapeText(handoff.label)}</b><span>${escapeText(handoff.status)}</span>${handoff.available && handoff.operatorIntent && !dispatchStatus ? `<button type="button" class="control-submit" data-control-entry="${entryIndex}">Approve and request ${handoff.operation === 'OBSERVE_CONTROL_SYSTEM' ? 'inspection' : 'guarded building'}</button><small>One explicit local operator approval. GitHub workflow dispatch is not native build completion.</small>` : ''}${dispatchStatus ? `<small class="control-submit-status">${escapeText(dispatchStatus)}</small>` : ''}${handoff.available ? `<a class="control-open" href="${handoff.workflowUrl}" target="_blank" rel="noopener noreferrer" data-expires-at="${escapeText(handoff.expiresAtUtc)}">Open authorised Control Tower</a><small>GitHub owner workflow remains available as fallback.</small>` : ''}</div>` : ''}
  </section>`;
}

function renderMessages() {
  const history = historyFor(selected.id);
  document.body.classList.toggle('has-messages', history.length > 0);
  messages.innerHTML = history.map((entry, i) => `
    <article class="message ${entry.role}">
      <span class="meta">${entry.role === 'user' ? 'YOU' : escapeText(entry.author || 'STEPHANOS AI')}${entry.routeNote ? ` · ${escapeText(entry.routeNote)}` : ''}</span>
      <div class="message-text">${escapeText(entry.text)}</div>
      ${entry.controlResult ? controlCard(entry.controlResult, i, entry.controlDispatchStatus || '') : ''}
    </article>`).join('');
  messages.scrollTop = messages.scrollHeight;
}

function extractReply(result) {
  return result?.output_text
    || result?.data?.output_text
    || result?.response
    || result?.message
    || result?.data?.message
    || 'Stephanos returned a response without displayable text.';
}

function routingTruth(result) {
  return result?.data?.conversation_routing || null;
}

function noteRouteTruth(result, targetId) {
  const routing = routingTruth(result);
  const control = projectControlReplyForSurfaceV1(result);
  const selectedDot = document.querySelector(`.agent-button[data-target="${targetId}"] .status-dot`);
  selectedDot?.classList.remove('unknown', 'live', 'routed');
  selectedDot?.classList.add(routing?.directParticipantDispatchProven || (targetId === 'everyone' && !control) ? 'live' : 'routed');
  if (selected.id !== targetId) return;
  $('routerTruth').textContent = routing?.routeState || 'observed via canonical client';
  $('healthDot').classList.remove('unknown');
  $('healthDot').classList.add('live');
  const provider = result?.debug?.actual_provider_used
    || result?.debug?.provider
    || result?.data?.actual_provider_used
    || '';
  $('lastResponse').textContent = control ? 'control service · no model used' : provider ? `received · ${provider}` : 'received';
  const contributors = routing?.selectedContributors || [];
  const contributorLabels = contributors.map((entry) => entry.label).filter(Boolean);
  $('presenceTruth').textContent = control ? 'control observations received; native action not submitted' : routing?.directParticipantDispatchProven
    ? 'direct participant dispatch proven'
    : contributorLabels.length > 0
      ? `Stephanos synthesis · ${contributorLabels.join(' + ')}`
      : 'Stephanos direct';
  $('routeLabel').textContent = control ? 'Sovereign control · no model used' : contributorLabels.length > 0
    ? `Stephanos AI · ${contributorLabels.join(' + ')}`
    : 'Stephanos AI';
}

async function send(text) {
  const clean = String(text || '').trim();
  if (!clean || busy) return;
  const activeTarget = selected;
  const history = historyFor(activeTarget.id);
  history.push({ role:'user', text:clean });
  renderMessages();
  prompt.value = '';
  autoGrow();
  busy = true;
  sendButton.disabled = true;
  $('routeLabel').textContent = `Routing to ${activeTarget.label}…`;

  try {
    const result = await queryStephanosAI({
      messages: [{ role:'user', content:clean }],
      context: {
        workspace: 'stephanos-ai',
        addressedTargetId: activeTarget.id,
        addressedTargetLabel: activeTarget.label,
        addressedTargetKind: activeTarget.kind,
      },
      routeMode: 'auto',
      fallbackEnabled: true,
      runtimeContext: {
        surface: 'desktop-browser',
        workspace: 'stephanos-ai',
        participantTarget: activeTarget.id,
      },
    });
    if (result?.success === false) {
      const error = new Error(result.error || 'Conversation request was not accepted');
      error.responseReceived = true;
      throw error;
    }
    const routing = routingTruth(result);
    const contributors = routing?.selectedContributors?.map((entry) => entry.label).filter(Boolean) || [];
    history.push({
      role:'assistant',
      author:routing?.responder?.label || 'Stephanos AI',
      routeNote: contributors.length > 0 ? `routed through ${contributors.join(' + ')}` : '',
      text:extractReply(result),
      controlResult: projectControlReplyForSurfaceV1(result) ? result : null,
    });
    lastRouteResults.set(activeTarget.id, result);
    noteRouteTruth(result, activeTarget.id);
  } catch (error) {
    history.push({
      role:'assistant',
      author:'Route status',
      text: error?.responseReceived
        ? `The conversation request was not completed: ${error.message}`
        : `The Stephanos AI backend route could not be reached from this surface: ${error?.message || 'unknown error'}`,
    });
    if (selected.id === activeTarget.id) {
      $('routerTruth').textContent = error?.responseReceived ? 'request not completed' : 'route unavailable';
      $('lastResponse').textContent = 'failed';
      $('healthDot').classList.remove('live');
      $('healthDot').classList.add('unknown');
    }
  } finally {
    busy = false;
    sendButton.disabled = false;
    if (selected.id === activeTarget.id) renderMessages();
    if (window.matchMedia('(pointer: fine)').matches) prompt.focus();
  }
}

// Only the user's explicit click can cross from read-only conversation to
// one source-bound GitHub workflow submission. A missing or ambiguous response
// never permits automatic retry; the original relay ledger is authoritative.
messages.addEventListener('click', async (event) => {
  const button = event.target.closest('button[data-control-entry]');
  if (!button) return;
  const index = Number(button.dataset.controlEntry);
  const targetId = selected.id;
  const history = historyFor(targetId);
  if (!Number.isSafeInteger(index) || index < 0 || index >= history.length) return;
  const entry = history[index];
  const view = projectControlReplyForSurfaceV1(entry?.controlResult);
  const intent = view?.handoff?.operatorIntent;
  if (!intent || entry.controlDispatchStatus) return;
  const operationName = intent.operation === 'OBSERVE_CONTROL_SYSTEM' ? 'read-only inspection' : 'guarded goal-building request';
  if (!window.confirm('Submit ONE ' + operationName
      + ' through the authenticated Control Tower workflow? This does not grant a merge, shell, restart or native execution approval.')) return;
  entry.controlDispatchStatus = 'Submitting one owner-bound workflow request…';
  if (selected.id === targetId) renderMessages();
  try {
    const response = await requestStephanosBackend({
      path: '/api/ai/control-tower/dispatch', method: 'POST',
      body: intent,
      headers: { 'X-Stephanos-Operator-Click': 'confirmed-v1' },
      runtimeContext: { frontendOrigin: window.location.origin },
      timeoutMs: 40000,
    });
    const payload = response.json;
    entry.controlDispatchStatus = payload?.workflowRequestAccepted === true
      && payload?.state === 'DISPATCH_ACCEPTED_UNCORRELATED'
      ? 'GitHub accepted the request. Await its exact Control Tower ledger receipt; this is not a completed build.'
      : 'Submission unproven. Inspect the original ledger before trying a new request.';
  } catch (error) {
    const blocker = String(error?.payload?.blocker || error?.code || 'CONTROL_TOWER_SUBMISSION_UNVERIFIED');
    entry.controlDispatchStatus = 'Submission held or uncertain (' + blocker
      + '). Do not repeat until the existing ledger is reconciled.';
  }
  if (selected.id === targetId) renderMessages();
});

function autoGrow() {
  prompt.style.height = 'auto';
  prompt.style.height = `${Math.min(prompt.scrollHeight, 140)}px`;
}

composer.addEventListener('submit', (event) => {
  event.preventDefault();
  send(prompt.value);
});

prompt.addEventListener('input', autoGrow);
prompt.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    send(prompt.value);
  }
});

document.querySelectorAll('[data-prompt]').forEach((button) => {
  button.addEventListener('click', () => {
    const target = agents.find(item => item.id === button.dataset.controlTarget);
    if (target) selectTarget(target);
    prompt.value = button.dataset.prompt || '';
    autoGrow();
    prompt.focus();
  });
});

targetSelect.addEventListener('change', () => {
  const item = [...agents, ...groups].find(item => item.id === targetSelect.value);
  if (item) selectTarget(item);
});
messages.addEventListener('click', event => {
  const link = event.target.closest('a[data-expires-at]');
  if (link && Date.parse(link.dataset.expiresAt) <= Date.now()) {
    event.preventDefault();
    renderMessages();
  }
});

renderNav();
selectTarget(selected);
