export default function PaneCollapseDial({ isOpen = false } = {}) {
  return (
    <span className="pane-collapse-dial chevron-dial" aria-hidden="true">
      <span className={`chevron ${isOpen ? 'open' : ''}`}>⌄</span>
    </span>
  );
}
