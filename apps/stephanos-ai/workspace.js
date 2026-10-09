import { queryStephanosAI } from '../../shared/ai/stephanosClient.mjs';
import { requestStephanosBackend } from '../../shared/runtime/backendClient.mjs';

const agents = [
  { id:'everyone', label:'Everyone', icon:'◎', subtitle:'Stephanos AI · whole project', kind:'agent' },
  { id:'sovereign-commander', label:'Sovereign Commander', icon:'♛', subtitle:'Battle Bridge · guarded command', kind:'agent' },
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
const bridgeStatus = $('bridgeStatus');

function surfaceKind() {
  if (navigator.maxTouchPoints > 0) return window.innerWidth < 760 ? 'iphone' : 'ipad';
  return 'desktop-browser';
}

// Probe from the actual browser. Backend health is not proof of identical UI assets.
async function probeBackendBridge() {
  $('frontendOrigin').textContent = window.location.host || 'unknown';
  bridgeStatus.dataset.state = 'checking';
  bridgeStatus.textContent = 'Backend · checking';
  try {
    const response = await requestStephanosBackend({
      path: '/api/health',
      timeoutMs: 5000,
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


function historyFor(id) {
  if (!histories.has(id)) histories.set(id, []);
  return histories.get(id);
}

function targetPrompt(text) {
  if (selected.id === 'everyone') return text;
  return `[Stephanos AI addressed target: ${selected.label} (${selected.id})]\n${text}`;
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
  updateNavSelection();
}

function updateNavSelection() {
  document.querySelectorAll('.agent-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.target === selected.id);
  });
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
  prompt.placeholder = item.id === 'everyone' ? 'Message Stephanos AI…' : `Message ${item.label}…`;
  renderMessages();
  // Do not summon the iPad software keyboard on workspace load or agent selection.
  if (focus && window.matchMedia?.('(pointer: fine)')?.matches) prompt.focus();
}

function escapeText(value='') {
  const span = document.createElement('span');
  span.textContent = String(value);
  return span.innerHTML;
}

function renderMessages() {
  const history = historyFor(selected.id);
  document.body.classList.toggle('has-messages', history.length > 0);
  messages.innerHTML = history.map((entry) => `
    <article class="message ${entry.role}">
      <span class="meta">${entry.role === 'user' ? 'YOU' : escapeText(entry.author || 'STEPHANOS AI')}${entry.routeNote ? ` · ${escapeText(entry.routeNote)}` : ''}</span>
      ${escapeText(entry.text)}
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

function noteRouteTruth(result) {
  const routing = routingTruth(result);
  $('routerTruth').textContent = routing?.routeState || 'observed via canonical client';
  $('healthDot').classList.remove('unknown');
  $('healthDot').classList.add('live');
  const provider = result?.debug?.actual_provider_used
    || result?.debug?.provider
    || result?.data?.actual_provider_used
    || '';
  $('lastResponse').textContent = provider ? `received · ${provider}` : 'received';
  const contributors = routing?.selectedContributors || [];
  const contributorLabels = contributors.map((entry) => entry.label).filter(Boolean);
  $('presenceTruth').textContent = routing?.directParticipantDispatchProven
    ? 'direct participant dispatch proven'
    : contributorLabels.length > 0
      ? `Stephanos synthesis · ${contributorLabels.join(' + ')}`
      : 'Stephanos direct';
  $('routeLabel').textContent = contributorLabels.length > 0
    ? `Stephanos AI · ${contributorLabels.join(' + ')}`
    : 'Stephanos AI';
  const selectedDot = document.querySelector(`.agent-button[data-target="${selected.id}"] .status-dot`);
  selectedDot?.classList.remove('unknown', 'live', 'routed');
  selectedDot?.classList.add(routing?.directParticipantDispatchProven || selected.id === 'everyone' ? 'live' : 'routed');
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
      messages: [{ role:'user', content:targetPrompt(clean) }],
      context: {
        workspace: 'stephanos-ai',
        addressedTargetId: activeTarget.id,
        addressedTargetLabel: activeTarget.label,
        addressedTargetKind: activeTarget.kind,
      },
      routeMode: 'auto',
      fallbackEnabled: true,
      runtimeContext: {
        surface: surfaceKind(),
        workspace: 'stephanos-ai',
        participantTarget: activeTarget.id,
      },
    });
    const routing = routingTruth(result);
    const contributors = routing?.selectedContributors?.map((entry) => entry.label).filter(Boolean) || [];
    history.push({
      role:'assistant',
      author:routing?.responder?.label || 'Stephanos AI',
      routeNote: contributors.length > 0 ? `routed through ${contributors.join(' + ')}` : '',
      text:extractReply(result),
    });
    noteRouteTruth(result);
  } catch (error) {
    history.push({
      role:'assistant',
      author:'Route status',
      text:`The Stephanos AI backend route could not be reached from this surface: ${error?.message || 'unknown error'}`,
    });
    $('routerTruth').textContent = 'route unavailable';
    $('lastResponse').textContent = 'failed';
  } finally {
    busy = false;
    sendButton.disabled = false;
    if (selected.id === activeTarget.id) renderMessages();
    prompt.focus();
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
    prompt.value = button.dataset.prompt || '';
    autoGrow();
    prompt.focus();
  });
});

renderNav();
selectTarget(selected);
void probeBackendBridge();
