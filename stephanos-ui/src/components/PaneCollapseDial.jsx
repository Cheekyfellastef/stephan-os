export default function PaneCollapseDial({ isOpen = false } = {}) {
  return (
    <span className="pane-collapse-dial" aria-hidden="true">
      <span className={`pane-collapse-chevron ${isOpen ? 'open' : ''}`}>⌄</span>
    </span>
  );
}
