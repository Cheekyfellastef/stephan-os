import { useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import CollapsiblePanel from './CollapsiblePanel';

function formatTime(value) {
  const parsed = Date.parse(String(value || ''));
  if (Number.isNaN(parsed)) return 'unknown';
  return new Date(parsed).toLocaleString();
}

export default function HostedIdeaStagingPanel() {
  const {
    uiLayout,
    togglePanel,
    hostedIdeaStagingQueue,
    markHostedStagedItemReviewed,
    approveHostedStagedItem,
    rejectHostedStagedItem,
    promoteHostedStagedItem,
    exportHostedStagedItem,
    runtimeStatusModel,
  } = useAIStore();
  const [feedback, setFeedback] = useState('');

  const localAuthorityAvailable = runtimeStatusModel?.runtimeContext?.capabilityPosture?.localAuthorityAvailable === true;
  const stagedItems = useMemo(
    () => (Array.isArray(hostedIdeaStagingQueue?.items) ? hostedIdeaStagingQueue.items : []).slice().reverse(),
    [hostedIdeaStagingQueue?.items],
  );

  async function handleCopy(itemId) {
    const payload = exportHostedStagedItem(itemId);
    if (!payload) {
      setFeedback('Unable to export staged item payload.');
      return;
    }
    const copyResult = await writeTextToClipboard(payload);
    setFeedback(copyResult.ok ? 'Hosted-safe thought captured successfully and copied.' : 'Copy failed; payload is still available in staging.');
  }

  return (
    <CollapsiblePanel
      title="Hosted Idea Staging"
      isOpen={uiLayout.hostedIdeaStagingPanel !== false}
      onToggle={() => togglePanel('hostedIdeaStagingPanel')}
      description="Hosted cognition generated staged item queue. Staged only, not yet canon."
    >
      <div className="mission-dashboard__banner mission-dashboard__banner--info">
        <strong>Hosted-safe thought captured.</strong>
        <span>
          Review and promote later on Battle Bridge. Promotion deferred until trusted persistence is available.
        </span>
      </div>
      <p>
        Queue items: <b>{stagedItems.length}</b> · Local authority: <b>{localAuthorityAvailable ? 'available' : 'unavailable'}</b>
      </p>
      {feedback ? <p>{feedback}</p> : null}
      {stagedItems.length === 0 ? (
        <p>No hosted staged items yet. Use hosted cognition test/submit to produce a staged packet.</p>
      ) : (
        <div className="mission-dashboard__milestones" style={{ gap: 10 }}>
          {stagedItems.map((item) => (
            <article key={item.id} className="mission-dashboard__milestone" style={{ marginBottom: 10 }}>
              <header className="mission-dashboard__milestone-header">
                <div>
                  <h4>{item.title || 'Untitled staged item'}</h4>
                  <p>{item.summary || 'No summary provided.'}</p>
                </div>
                <span className="mission-dashboard__badge">{item.type}</span>
              </header>
              <ul>
                <li>Provider: {item.sourceProvider || 'unknown'}</li>
                <li>Created: {formatTime(item.createdAt)}</li>
                <li>Confidence: {Number(item.confidence ?? 0).toFixed(2)}</li>
                <li>Status: {item.status}</li>
                <li>Promotion target: {item.promotionTarget}</li>
                <li>Promotion state: {item.promotionState || 'pending'}</li>
                <li>Truth: staged only, not canon</li>
              </ul>
              <div className="mission-dashboard__actions">
                <button type="button" onClick={() => markHostedStagedItemReviewed(item.id)}>Review</button>
                <button type="button" onClick={() => approveHostedStagedItem(item.id)}>Approve</button>
                <button type="button" onClick={() => rejectHostedStagedItem(item.id, 'Rejected from hosted staging queue by operator.')}>Reject</button>
                <button
                  type="button"
                  onClick={() => promoteHostedStagedItem(item.id, localAuthorityAvailable
                    ? 'Promotion requested by operator through available trusted persistence path.'
                    : 'Promotion deferred until trusted persistence is available.')}
                >
                  Promote / Defer
                </button>
                <button type="button" onClick={() => handleCopy(item.id)}>Copy handoff</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </CollapsiblePanel>
  );
}
