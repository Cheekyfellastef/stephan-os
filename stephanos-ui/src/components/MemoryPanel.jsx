import { useEffect, useMemo, useState } from 'react';
import { createMemoryItem, listMemoryItems, searchMemoryItems } from '../ai/aiClient';
import { useAIStore } from '../state/aiStore';
import CollapsiblePanel from './CollapsiblePanel';

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
  const { uiLayout, togglePanel } = useAIStore();
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
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search memory"
          aria-label="Search memory"
        />
        <button type="submit" disabled={isLoading}>Search</button>
      </form>

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
