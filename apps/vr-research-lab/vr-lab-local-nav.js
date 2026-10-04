
const NAV_ID = 'vr-lab-local-nav';
const MODE_CLASSES = {
  visual: 'vr-lab-visual-mode',
  deep: 'vr-lab-deep-mode',
  both: 'vr-lab-both-mode',
};

let modeHistory = [];
let currentMode = null;
let suppressModeHistory = false;

function detectMode() {
  const body = document.body;
  if (body.classList.contains(MODE_CLASSES.deep)) return 'deep';
  if (body.classList.contains(MODE_CLASSES.both)) return 'both';
  return 'visual';
}

function modeLabel(mode) {
  if (mode === 'deep') return 'Deep Evidence';
  if (mode === 'both') return 'Both';
  return 'Visual Cockpit';
}

function updateNavState() {
  const nav = document.getElementById(NAV_ID);
  if (!nav) return;
  const mode = detectMode();
  nav.querySelectorAll('[data-local-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.localMode === mode);
  });
  const crumb = nav.querySelector('[data-role="crumb-current"]');
  if (crumb) crumb.textContent = modeLabel(mode);
}

function requestMode(mode) {
  const existing = document.querySelector('[data-vr-mode="' + mode + '"]');
  if (existing) {
    existing.click();
    return;
  }
  document.body.classList.remove(...Object.values(MODE_CLASSES));
  document.body.classList.add(MODE_CLASSES[mode] || MODE_CLASSES.visual);
}

function pushModeHistory(previousMode) {
  if (!previousMode) return;
  if (modeHistory.at(-1) === previousMode) return;
  modeHistory.push(previousMode);
  if (modeHistory.length > 20) modeHistory = modeHistory.slice(-20);
}

function backWithinLab() {
  const prior = modeHistory.pop();
  if (prior) {
    suppressModeHistory = true;
    requestMode(prior);
    queueMicrotask(() => {
      currentMode = detectMode();
      suppressModeHistory = false;
      updateNavState();
    });
    return;
  }

  const mode = detectMode();
  if (mode !== 'visual') {
    suppressModeHistory = true;
    requestMode('visual');
    queueMicrotask(() => {
      currentMode = detectMode();
      suppressModeHistory = false;
      updateNavState();
    });
    return;
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function returnToCommandDeck() {
  const canonical = document.querySelector('[data-command-deck-return-button="button"]');
  if (canonical) {
    canonical.click();
    return;
  }
  if (typeof window.returnToCommandDeck === 'function') {
    window.returnToCommandDeck();
    return;
  }
  if (window.parent && window.parent !== window && typeof window.parent.returnToCommandDeck === 'function') {
    window.parent.returnToCommandDeck();
    return;
  }
  window.location.assign('../../');
}

function createButton(label, action, { mode = '', extraClass = '' } = {}) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vr-lab-local-nav__button' + (extraClass ? ' ' + extraClass : '');
  button.textContent = label;
  if (mode) button.dataset.localMode = mode;
  button.addEventListener('click', action);
  return button;
}

function installLocalNav() {
  if (document.getElementById(NAV_ID)) return;

  const main = document.querySelector('main.shell') || document.querySelector('main');
  if (!main) return;

  const nav = document.createElement('nav');
  nav.id = NAV_ID;
  nav.className = 'vr-lab-local-nav';
  nav.setAttribute('aria-label', 'VR Research Lab local navigation');

  const crumb = document.createElement('div');
  crumb.className = 'vr-lab-local-nav__crumb';
  crumb.innerHTML = 'Stephanos OS / VR Research Lab / <strong data-role="crumb-current">Visual Cockpit</strong>';

  const buttons = document.createElement('div');
  buttons.className = 'vr-lab-local-nav__buttons';
  buttons.append(
    createButton('← Back', backWithinLab),
    createButton('Visual Cockpit', () => requestMode('visual'), { mode: 'visual' }),
    createButton('Deep Evidence', () => requestMode('deep'), { mode: 'deep' }),
    createButton('Both', () => requestMode('both'), { mode: 'both' }),
    createButton('↑ Top', () => window.scrollTo({ top: 0, behavior: 'smooth' })),
    createButton('Command Deck', returnToCommandDeck, { extraClass: 'command-deck' }),
  );

  nav.append(crumb, buttons);
  main.prepend(nav);

  currentMode = detectMode();
  updateNavState();

  const observer = new MutationObserver(() => {
    const next = detectMode();
    if (currentMode && next !== currentMode && !suppressModeHistory) {
      pushModeHistory(currentMode);
    }
    currentMode = next;
    updateNavState();
  });
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installLocalNav, { once: true });
} else {
  installLocalNav();
}
