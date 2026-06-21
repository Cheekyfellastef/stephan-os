import { forwardRef } from 'react';
export function CockpitStatusChip({ label, value, tone = 'info', className = '', ...props }) {
  return <span className={`cockpit-chip cockpit-status-chip cockpit-tone-${tone} ${className}`.trim()} data-cockpit-status-tone={tone} {...props}><strong>{label}</strong>{value ? <span>{value}</span> : null}</span>;
}

export function CockpitField({ label, value }) {
  return <li className="cockpit-field"><span>{label}</span><strong>{value || 'unavailable'}</strong></li>;
}

export const CockpitCard = forwardRef(function CockpitCard({ title, eyebrow, summary, tone = 'info', cardType = 'context', status, chips = [], children, actions = null, footer = null, className = '', ...props }, ref) {
  return (
    <section ref={ref} className={`cockpit-vl-card cockpit-vl-card-${cardType} cockpit-tone-${tone} ${className}`.trim()} data-cockpit-card-type={cardType} data-cockpit-state={tone} {...props}>
      <div className="cockpit-vl-card-header">
        <div>
          {eyebrow ? <span className="cockpit-vl-eyebrow">{eyebrow}</span> : null}
          <h3>{title}</h3>
        </div>
        {status ? <CockpitStatusChip label={status.label || 'Status'} value={status.value} tone={status.tone || tone} /> : null}
      </div>
      {summary ? <p className="cockpit-vl-summary">{summary}</p> : null}
      {chips.length ? <div className="cockpit-vl-chip-row">{chips.map((chip) => <CockpitStatusChip key={`${chip.label}-${chip.value}`} {...chip} />)}</div> : null}
      <div className="cockpit-vl-body">{children}</div>
      {actions ? <div className="cockpit-vl-actions">{actions}</div> : null}
      {footer ? <div className="cockpit-vl-footer">{footer}</div> : null}
    </section>
  );
});

export function CockpitSafetyLockStrip({ openClaw = 'locked', codex = 'no', mutation = 'no', merge = 'hold' }) {
  return <div className="cockpit-safety-lock-strip" data-cockpit-lock-strip="visible"><CockpitStatusChip label="OpenClaw" value={openClaw} tone="locked" /><CockpitStatusChip label="Codex dispatch" value={codex} tone="locked" /><CockpitStatusChip label="Mutation" value={mutation} tone="locked" /><CockpitStatusChip label="Merge" value={merge} tone="warning" /></div>;
}
