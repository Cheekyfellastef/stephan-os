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

const canonicalHistory = [];
const PENDING_KEY = 'stephanos.ai.pending-turn.v1';
let pendingDraft = null;
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
const bridgeStatus = $('bridgeStatus');
const memoryStatus = $('memoryStatus');
const reloadThread = $('reloadThread');
const releaseDraft = $('releaseDraft');

function historyFor(_id) {
  return canonicalHistory;
}

function readPendingDraft() {
  try {
    const value = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (value && typeof value.text === 'string' && value.text.length <= 6000
      && typeof value.requestId === 'string' && /^[a-z0-9][a-z0-9._:-]{0,127}$/i.test(value.requestId)
      && typeof value.turnId === 'string'
      && (value.turnId === '' || /^operator-[a-f0-9]{24}$/.test(value.turnId))) return value;
  } catch { /* Browser draft storage may be disabled. */ }
  return null;
}
function writePendingDraft(value) {
  pendingDraft = value;
  if (releaseDraft) releaseDraft.hidden = !value;
  try {
    if (value) localStorage.setItem(PENDING_KEY, JSON.stringify(value));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    memoryStatus.dataset.state = 'unavailable';
    memoryStatus.textContent = 'Device draft storage unavailable';
  }
}
async function createPendingDraft(text, addressLabel) {
  const requestId = 'stephanos-ai-' +
    (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const bytes = new TextEncoder().encode(requestId);
  let turnId = '';
  if (globalThis.crypto?.subtle?.digest) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    turnId = 'operator-' + [...new Uint8Array(digest)]
      .map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
  }
  return { text, addressLabel, requestId, turnId, createdAtUtc: new Date().toISOString() };
}
function showPendingStatus() {
  if (pendingDraft) {
    memoryStatus.dataset.state = 'checking';
    memoryStatus.textContent = 'Unconfirmed turn saved on device';
  }
}
function surfaceKind() {
  if (navigator.maxTouchPoints > 0) return window.innerWidth < 760 ? 'iphone' : 'ipad';
  return 'desktop-browser';
}
// Probe from actual browser. Backend health is not proof of identical UI assets.
async function probeBackendBridge() {
  $('frontendOrigin').textContent = window.location.host || 'unknown';
  bridgeStatus.dataset.state = 'checking';
  bridgeStatus.textContent = 'Backend · checking';
  try {
    const response = await requestStephanosBackend({
      path: '/api/health', timeoutMs: 5000,
      runtimeContext: { surface: surfaceKind(), workspace: 'stephanos-ai' },
    });
    bridgeStatus.dataset.state = 'reachable';
    bridgeStatus.textContent = 'Backend reachable';
    $('backendRoute').textContent = new URL(response.baseUrl).host;
  } catch (error) {
    bridgeStatus.dataset.state = 'unavailable';
    bridgeStatus.textContent = `Backend unavailable (${error?.code || 'network'})`;
    bridgeStatus.title = error?.message || 'Backend route not proven';
    $('backendRoute').textContent = error?.code || 'unreachable';
  }
}
function translateTurn(turn) {
  const participant = turn.senderParticipantId;
  return {
    turnId: turn.turnId,
    role: participant === 'operator' ? 'user' : 'assistant',
    author: participant === 'chatgpt-bridge' ? 'ChatGPT'
      : participant === 'stephanos' ? 'Stephanos AI' : 'You',
    text: typeof turn.text === 'string' ? turn.text : '',
  };
}
async function loadCanonicalThread() {
  if (busy) return false;
  memoryStatus.dataset.state = 'checking';
  memoryStatus.textContent = 'Memory · checking';
  try {
    const result = await requestStephanosBackend({
      path: '/api/ai/shared-thread', timeoutMs: 10000,
      runtimeContext: { surface: surfaceKind(), workspace: 'stephanos-ai' },
    });
    const data = result.json?.data;
    if (!result.json?.success || !data?.ok || !Array.isArray(data.turns)) {
      throw new Error(data?.classification || 'canonical-thread-unavailable');
    }
    const turns = data.turns;
    // Keep only transient session control receipts; never promote them to durable authority.
    const controlCards = canonicalHistory.filter(entry => entry.controlResult).slice(-8);
    canonicalHistory.splice(0, canonicalHistory.length, ...turns.map(translateTurn), ...controlCards);
    if (pendingDraft?.turnId && turns.some(turn =>
      turn.turnId === pendingDraft.turnId && turn.senderParticipantId === 'operator')) {
      writePendingDraft(null);
      prompt.value = '';
      autoGrow();
    }
    memoryStatus.dataset.state = pendingDraft ? 'checking' : 'reachable';
    memoryStatus.textContent = pendingDraft
      ? 'Unconfirmed turn · check before retry'
      : `Memory · ${data.totalRetained || 0} durable turns`;
    $('threadTruth').textContent = data.threadId || 'unknown';
    renderMessages();
    return true;
  } catch (error) {
    memoryStatus.dataset.state = 'unavailable';
    memoryStatus.textContent = 'Memory unavailable · not synced';
    memoryStatus.title = error?.message || 'Cannot recover canonical conversation';
    $('threadTruth').textContent = 'unavailable';
    showPendingStatus();
    return false;
  }
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
  button.addEventListener('click', () => selectTarget(item, { focus: true }));
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

function selectTarget(item, { focus = false } = {}) {
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
  renderMessages({ forceBottom: true });
  if (focus && window.matchMedia?.('(pointer: fine)')?.matches) prompt.focus();
}

function escapeText(value='') {
  const span = document.createElement('span');
  span.textContent = String(value);
  return span.innerHTML;
}

function controlCard(result) {
  const control = projectControlReplyForSurfaceV1(result);
  if (!control) return '';
  const request = control.request;
  const handoff = control.handoff;
  return `<section class="control-receipt" aria-label="Sovereign control receipt">
    <div class="control-receipt-heading"><b>Control receipt</b><span>No model used</span></div>
    <p class="control-observation">Observed ${escapeText(control.observedAtUtc)}</p>
    ${request ? `<dl><div><dt>${request.historical ? 'Retained request' : 'Observed request'}</dt><dd>${escapeText(request.requestId)}</dd></div><div><dt>Outcome</dt><dd>${escapeText(request.label)}</dd></div></dl>` : '<p class="control-observation">No request outcome has been proven in this reply.</p>'}
    ${control.unresolvedBuild ? `<p class="control-unresolved">Earlier build ${escapeText(control.unresolvedBuild.requestId)}: ${escapeText(control.unresolvedBuild.label)}. An inspection does not resolve that request.</p>` : ''}
    ${handoff ? `<div class="control-handoff"><b>${escapeText(handoff.label)}</b><span>${escapeText(handoff.status)}</span>${handoff.available ? `<a class="control-open" href="${handoff.workflowUrl}" target="_blank" rel="noopener noreferrer" data-expires-at="${escapeText(handoff.expiresAtUtc)}">Open authorised Control Tower</a><small>Choose ${escapeText(handoff.operation)} on main. Opening this page does not submit it.</small>` : ''}</div>` : ''}
  </section>`;
}

function renderMessages({ forceBottom = false } = {}) {
  const history = historyFor(selected.id).slice(-64);
  const bottomDistance = messages.scrollHeight - messages.scrollTop - messages.clientHeight;
  const atBottom = forceBottom || bottomDistance < 90 || messages.childElementCount === 0;
  document.body.classList.toggle('has-messages', history.length > 0);
  messages.innerHTML = history.map((entry) => `
    <article class="message ${entry.role}">
      <span class="meta">${entry.role === 'user' ? 'YOU' : escapeText(entry.author || 'STEPHANOS AI')}${entry.routeNote ? ` · ${escapeText(entry.routeNote)}` : ''}</span>
      <div class="message-text">${escapeText(entry.text)}</div>
      ${entry.controlResult ? controlCard(entry.controlResult) : ''}
    </article>`).join('');
  if (atBottom) messages.scrollTop = messages.scrollHeight;
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
  if (pendingDraft) {
    memoryStatus.dataset.state = 'unavailable';
    memoryStatus.textContent = 'Previous turn unconfirmed · reload before sending';
    return;
  }
  // Acquire UI single-flight before await to prevent duplicate dispatch.
  busy = true;
  sendButton.disabled = true;
  const activeTarget = selected;
  const history = historyFor(activeTarget.id);
  let draft = null;
  try {
    draft = await createPendingDraft(clean, activeTarget.label);
    writePendingDraft(draft);
    history.push({ role: 'user', text: clean, turnId: draft.turnId });
    renderMessages({ forceBottom: true });
    prompt.value = '';
    autoGrow();
    showPendingStatus();
    $('routeLabel').textContent = `Routing to ${activeTarget.label}…`;
    const result = await queryStephanosAI({
      requestId: draft.requestId,
      messages: [{ role: 'user', content: clean }],
      context: {
        workspace: 'stephanos-ai',
        addressedTargetId: activeTarget.id,
        addressedTargetLabel: activeTarget.label,
        addressedTargetKind: activeTarget.kind,
      },
      // Stephanos AI is the sovereign front door: local-only unless an
      // operator explicitly chooses a separate specialist surface.
      // A failed Ollama route must stay failed, never become mock/cloud success.
      provider: 'ollama',
      routeMode: 'explicit',
      fallbackEnabled: false,
      fallbackOrder: ['ollama'],
      runtimeContext: {
        surface: surfaceKind(), workspace: 'stephanos-ai',
        participantTarget: activeTarget.id,
      },
    });
    if (result?.success === false) {
      const error = new Error(result.error || 'Conversation request was not accepted');
      error.responseReceived = true;
      throw error;
    }
    const routing = routingTruth(result);
    const contributors = routing?.selectedContributors?.map(entry => entry.label).filter(Boolean) || [];
    history.push({
      role: 'assistant',
      author: routing?.responder?.label || 'Stephanos AI',
      routeNote: contributors.length ? `routed through ${contributors.join(' + ')}` : '',
      text: extractReply(result),
      controlResult: projectControlReplyForSurfaceV1(result) ? result : null,
    });
    lastRouteResults.set(activeTarget.id, result);
    noteRouteTruth(result, activeTarget.id);
  } catch (error) {
    history.push({
      role: 'assistant',
      author: 'Route status',
      text: error?.responseReceived
        ? `Delivery not confirmed: ${error.message}`
        : `Delivery uncertain. Check the canonical thread before releasing this device draft. ${error?.message || 'Backend unreachable'}`,
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
    if (selected.id === activeTarget.id) renderMessages({ forceBottom: true });
    const recovered = await loadCanonicalThread();
    if (!recovered && pendingDraft) {
      prompt.value = pendingDraft.text;
      autoGrow();
      showPendingStatus();
    }
    if (window.matchMedia?.('(pointer: fine)')?.matches) prompt.focus();
  }
}

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
pendingDraft = readPendingDraft();
if (pendingDraft) {
  releaseDraft.hidden = false;
  prompt.value = pendingDraft.text;
  autoGrow();
  showPendingStatus();
}
reloadThread?.addEventListener('click', () => { void loadCanonicalThread(); });
releaseDraft?.addEventListener('click', () => {
  if (!pendingDraft || busy) return;
  const approved = window.confirm('The turn has not been confirmed in the canonical thread. Allow a new send? This may duplicate a turn if the backend received it.');
  if (!approved) return;
  const text = pendingDraft.text;
  writePendingDraft(null);
  prompt.value = text;
  autoGrow();
  memoryStatus.dataset.state = 'unavailable';
  memoryStatus.textContent = 'Draft released · verify before resend';
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && !busy) void loadCanonicalThread();
});
void probeBackendBridge();
void loadCanonicalThread();
