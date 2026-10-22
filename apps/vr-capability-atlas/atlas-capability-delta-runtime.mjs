function ensureModeDetail() {
  const controls = document.querySelector('#conceptStage .capability-mode-switch');
  if (!controls || controls.parentElement?.querySelector('.capability-mode-detail')) return;
  const detail = document.createElement('div');
  detail.className = 'capability-mode-detail';
  controls.insertAdjacentElement('afterend', detail);
}

function syncCurrentClick(event) {
  const button = event.target.closest?.('[data-current-concept-id]');
  if (!button) return;
  queueMicrotask(() => {
    ensureModeDetail();
    document.querySelector('#conceptStage [data-capability-mode="current"]')?.click();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('click', syncCurrentClick);
  const observer = typeof MutationObserver === 'function'
    ? new MutationObserver(() => ensureModeDetail())
    : null;
  observer?.observe(document.documentElement, { childList: true, subtree: true });
  ensureModeDetail();
}
