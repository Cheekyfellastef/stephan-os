import { useEffect, useMemo, useState } from 'react';
import { createMemoryItem, listMemoryItems, searchMemoryItems } from '../ai/aiClient';
import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import { COPY_STATE, useClipboardButtonState } from '../hooks/useClipboardButtonState';

const CATEGORY_OPTIONS = ['project', 'preference', 'troubleshooting', 'architecture', 'workflow'];
const EMPTY_FORM = {
  category: 'project',
  title: '',
  content: '',
  tags: '',
  importance: 3,
  source: 'ui-manual',
};

function formatTags(tags = []) {
  return Array.isArray(tags) && tags.length ? tags.join(', ') : 'none';
}

export default function MemoryPanel() {
  const {
    uiLayout,
    togglePanel,
    missionMemory,
    memoryCandidates,
    adjudicateMemoryCandidate,
    clearMemoryCandidate,
    listDurableMemorySummary,
    buildDeluxeMemoryClipboard,
  } = useAIStore();
  const { copyState, setCopyState } = useClipboardButtonState();
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');

  async function loadItems(query = '') {
    setIsLoading(true);
    setError('');

    try {
      const nextItems = query.trim()
        ? await searchMemoryItems(query)
        : await listMemoryItems();
      setItems(nextItems);
    } catch (loadError) {
      setError(loadError.message || 'Failed to load memory.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    loadItems();
  }, []);

  const visibleItems = useMemo(() => items.slice(0, 8), [items]);
  const durableMemorySummary = useMemo(() => listDurableMemorySummary(), [listDurableMemorySummary]);
  const pendingCandidates = useMemo(
    () => (Array.isArray(memoryCandidates) ? memoryCandidates.filter((entry) => entry.status === 'pending') : []),
    [memoryCandidates],
  );

  async function handleSearchSubmit(event) {
    event.preventDefault();
    setSaveMessage('');
    await loadItems(search);
  }

  async function handleAddMemory(event) {
    event.preventDefault();
    setIsSaving(true);
    setError('');
    setSaveMessage('');

    try {
      await createMemoryItem({
        ...form,
        tags: form.tags,
      });
      setForm(EMPTY_FORM);
      setSaveMessage('Memory saved locally.');
      await loadItems(search);
    } catch (saveError) {
      setError(saveError.message || 'Failed to save memory.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyDeluxeMemory() {
    const payload = buildDeluxeMemoryClipboard();
    if (!String(payload || '').trim()) {
      setCopyState(COPY_STATE.FAILURE);
      return;
    }
    try {
      const result = await writeTextToClipboard(payload);
      setCopyState(result.ok ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
    } catch {
      setCopyState(COPY_STATE.FAILURE);
    }
  }

  return (
    <CollapsiblePanel
      panelId="memoryPanel"
      title="Memory"
      description="Local persistent notes for project facts, preferences, and fixes."
      className="memory-panel"
      isOpen={uiLayout.memoryPanel}
      onToggle={() => togglePanel('memoryPanel')}
      actions={(
        <button type="button" className="ghost-button" onClick={() => loadItems(search)} disabled={isLoading}>
          Refresh
        </button>
      )}
    >
      <form className="memory-search-form" onSubmit={handleSearchSubmit}>
        <button type="button" className={`status-panel-copy-button ${copyState}`} onClick={handleCopyDeluxeMemory}>
          {copyState === COPY_STATE.SUCCESS ? 'Copied' : copyState === COPY_STATE.FAILURE ? 'Copy failed' : 'Copy Deluxe Memory'}
        </button>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search memory"
          aria-label="Search memory"
        />
        <button type="submit" disabled={isLoading}>Search</button>
      </form>
      <section className="memory-deluxe-section">
        <h4>Active Mission Memory</h4>
        <p><strong>Objective:</strong> {missionMemory?.objective || 'none'}</p>
        <p><strong>Brief:</strong> {missionMemory?.structuredBrief || 'none'}</p>
        <p><strong>Approval:</strong> {missionMemory?.approvalState || 'analysis-only'} · <strong>Execution:</strong> {missionMemory?.executionStatus || 'inactive'}</p>
      </section>

      <section className="memory-deluxe-section">
        <h4>Memory Candidates (Adjudication Required)</h4>
        {pendingCandidates.length === 0 ? <p className="muted">No pending memory candidates.</p> : (
          <ul className="compact-list memory-list">
            {pendingCandidates.map((candidate) => (
              <li key={candidate.id} className="memory-list-item">
                <p><strong>{candidate.memoryClass}</strong> · {candidate.summary}</p>
                <div className="memory-meta">
                  <span>impact: {candidate.impactLevel}</span>
                  <span>confidence: {candidate.confidence.toFixed(2)}</span>
                  <span>evidence: {candidate.evidenceRef || 'n/a'}</span>
                </div>
                <div className="memory-grid">
                  <button type="button" onClick={() => adjudicateMemoryCandidate(candidate.id, 'approve', 'Approved from Memory Panel.')}>Approve</button>
                  <button type="button" className="ghost-button" onClick={() => adjudicateMemoryCandidate(candidate.id, 'revise', 'Need revision before promotion.')}>Revise</button>
                  <button type="button" className="ghost-button" onClick={() => adjudicateMemoryCandidate(candidate.id, 'reject', 'Rejected by operator.')}>Reject</button>
                  <button type="button" className="ghost-button" onClick={() => clearMemoryCandidate(candidate.id)}>Dismiss</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="memory-deluxe-section">
        <h4>Durable Memory Summary (Read-only)</h4>
        {durableMemorySummary.length === 0 ? <p className="muted">No durable memory records yet.</p> : (
          <ul className="compact-list memory-list">
            {durableMemorySummary.map((line) => <li key={line}>{line}</li>)}
          </ul>
        )}
      </section>

      <form className="memory-entry-form" onSubmit={handleAddMemory}>
        <div className="memory-grid">
          <label>
            Category
            <select value={form.category} onChange={(event) => setForm((prev) => ({ ...prev, category: event.target.value }))}>
              {CATEGORY_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
          <label>
            Importance
            <select value={form.importance} onChange={(event) => setForm((prev) => ({ ...prev, importance: Number(event.target.value) }))}>
              {[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>

        <label>
          Title
          <input
            type="text"
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
            placeholder="Short memory title"
            required
          />
        </label>

        <label>
          Content
          <textarea
            value={form.content}
            onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
            placeholder="Important summary, decision, or troubleshooting note"
            rows={3}
            required
          />
        </label>

        <label>
          Tags
          <input
            type="text"
            value={form.tags}
            onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
            placeholder="comma,separated,tags"
          />
        </label>

        <button type="submit" disabled={isSaving}>{isSaving ? 'Saving…' : 'Add memory'}</button>
      </form>

      {saveMessage ? <p className="memory-status success">{saveMessage}</p> : null}
      {error ? <p className="memory-status error">{error}</p> : null}

      {isLoading ? (
        <p className="muted">Loading memory…</p>
      ) : visibleItems.length === 0 ? (
        <p className="muted">No memory entries yet.</p>
      ) : (
        <ul className="compact-list memory-list">
          {visibleItems.map((item) => (
            <li key={item.id} className="memory-list-item">
              <div className="memory-list-head">
                <strong>{item.title}</strong>
                <span className="memory-chip">{item.category}</span>
              </div>
              <p>{item.content}</p>
              <div className="memory-meta">
                <span>tags: {formatTags(item.tags)}</span>
                <span>importance: {item.importance}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </CollapsiblePanel>
  );
}
