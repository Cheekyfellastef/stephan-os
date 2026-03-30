import { useEffect, useMemo, useState } from 'react';
import { useAIStore } from '../state/aiStore';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import { sanitizeClipboardText } from '../utils/clipboardSanitizer';
import CollapsiblePanel from './CollapsiblePanel';

const CLIPBOARD_SANITISER_SESSION_KEY = 'stephanos.tools.clipboard-sanitiser.session';

function summarizeText(text = '') {
  const normalized = String(text || '');
  return {
    chars: normalized.length,
    lines: normalized.length ? normalized.split('\n').length : 0,
  };
}

function readSessionState() {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return null;
  }

  try {
    const stored = window.sessionStorage.getItem(CLIPBOARD_SANITISER_SESSION_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored);
    return {
      rawInput: String(parsed.rawInput || ''),
      cleanedOutput: String(parsed.cleanedOutput || ''),
    };
  } catch (error) {
    console.warn('[CLIPBOARD SANITISER] failed to restore session state', error);
    return null;
  }
}

function persistSessionState(rawInput, cleanedOutput) {
  if (typeof window === 'undefined' || !window.sessionStorage) {
    return;
  }

  try {
    window.sessionStorage.setItem(CLIPBOARD_SANITISER_SESSION_KEY, JSON.stringify({
      rawInput: String(rawInput || ''),
      cleanedOutput: String(cleanedOutput || ''),
    }));
  } catch (error) {
    console.warn('[CLIPBOARD SANITISER] failed to persist session state', error);
  }
}

export default function ToolsPanel({ commandHistory }) {
  const { uiLayout, togglePanel } = useAIStore();
  const latestTools = [...commandHistory]
    .reverse()
    .find((entry) => Array.isArray(entry.response?.data?.grouped_tools));

  const groups = latestTools?.response?.data?.grouped_tools ?? [];
  const [rawInput, setRawInput] = useState('');
  const [cleanedOutput, setCleanedOutput] = useState('');
  const [copyFeedback, setCopyFeedback] = useState({ tone: 'neutral', message: '' });
  const [fallbackCopyText, setFallbackCopyText] = useState('');

  useEffect(() => {
    const restored = readSessionState();
    if (!restored) {
      return;
    }

    setRawInput(restored.rawInput);
    setCleanedOutput(restored.cleanedOutput);
    console.info('[CLIPBOARD SANITISER] session state restored', {
      rawChars: restored.rawInput.length,
      cleanedChars: restored.cleanedOutput.length,
    });
  }, []);

  useEffect(() => {
    persistSessionState(rawInput, cleanedOutput);
  }, [rawInput, cleanedOutput]);

  const rawSummary = useMemo(() => summarizeText(rawInput), [rawInput]);
  const cleanedSummary = useMemo(() => summarizeText(cleanedOutput), [cleanedOutput]);

  async function handleCleanAndCopy() {
    console.info('[CLIPBOARD SANITISER] cleaning started');
    const sanitized = sanitizeClipboardText(rawInput);
    setCleanedOutput(sanitized.text);
    console.info('[CLIPBOARD SANITISER] cleaning completed', {
      rawCharacterCount: sanitized.rawCharacterCount,
      cleanedCharacterCount: sanitized.cleanedCharacterCount,
      rawLineCount: sanitized.rawLineCount,
      cleanedLineCount: sanitized.cleanedLineCount,
    });

    if (sanitized.diagnostics.removedInvisibleChars > 0) {
      console.info('[CLIPBOARD SANITISER] sanitizer removed invisible characters', {
        count: sanitized.diagnostics.removedInvisibleChars,
      });
    }

    if (sanitized.diagnostics.normalizedNbsp > 0
      || sanitized.diagnostics.trimmedLines > 0
      || sanitized.diagnostics.collapsedBlankLineRuns > 0
      || sanitized.diagnostics.normalizedLineEndings) {
      console.info('[CLIPBOARD SANITISER] sanitizer normalized whitespace', sanitized.diagnostics);
    }

    if (!sanitized.text) {
      setCopyFeedback({ tone: 'warning', message: 'Nothing to copy. Paste text first.' });
      return;
    }

    const copyResult = await writeTextToClipboard(sanitized.text, { navigatorObject: navigator });
    if (copyResult.ok) {
      setCopyFeedback({ tone: 'success', message: 'Cleaned text copied. Paste into Codex.' });
      setFallbackCopyText('');
      console.info('[CLIPBOARD SANITISER] clipboard copy succeeded');
      return;
    }

    setFallbackCopyText(sanitized.text);
    setCopyFeedback({ tone: 'warning', message: 'Clipboard unavailable. Manual copy fallback opened.' });
    console.warn('[CLIPBOARD SANITISER] clipboard unavailable, fallback opened', { reason: copyResult.reason });
    console.info('[CLIPBOARD SANITISER] manual copy fallback opened');
  }

  async function handleCopyCleanedAgain() {
    if (!cleanedOutput) {
      setCopyFeedback({ tone: 'warning', message: 'Clean output is empty.' });
      return;
    }

    const copyResult = await writeTextToClipboard(cleanedOutput, { navigatorObject: navigator });
    if (copyResult.ok) {
      setCopyFeedback({ tone: 'success', message: 'Cleaned output copied again.' });
      console.info('[CLIPBOARD SANITISER] clipboard copy succeeded');
      return;
    }

    setFallbackCopyText(cleanedOutput);
    setCopyFeedback({ tone: 'warning', message: 'Clipboard unavailable. Manual copy fallback opened.' });
    console.warn('[CLIPBOARD SANITISER] clipboard unavailable, fallback opened', { reason: copyResult.reason });
    console.info('[CLIPBOARD SANITISER] manual copy fallback opened');
  }

  function handleRawInputChange(value) {
    setRawInput(value);
    console.info('[CLIPBOARD SANITISER] raw input updated', { characters: value.length });
  }

  function handleClear() {
    setRawInput('');
    setCleanedOutput('');
    setFallbackCopyText('');
    setCopyFeedback({ tone: 'neutral', message: '' });
  }

  return (
    <CollapsiblePanel
      as="aside"
      panelId="toolsPanel"
      title="Tools"
      description="Tool registry groups and live subsystem readiness."
      className="tools-panel"
      isOpen={uiLayout.toolsPanel}
      onToggle={() => togglePanel('toolsPanel')}
    >
      {groups.length === 0 ? (
        <p className="muted">Run /tools to inspect registry.</p>
      ) : (
        <div>
          {groups.map((group) => (
            <div key={`${group.subsystem}-${group.category}`}>
              <strong>{group.subsystem} / {group.category}</strong>
              <ul className="compact-list">
                {group.tools.map((tool) => (
                  <li key={tool.name}>{tool.name} ({tool.state})</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <section className="clipboard-sanitiser-tool" aria-label="Clipboard Sanitiser for Codex">
        <header className="clipboard-sanitiser-header">
          <h3>Clipboard Sanitiser</h3>
          <p>Paste from ChatGPT, clean text, then use <strong>Clean + Copy for Codex</strong>.</p>
        </header>

        {copyFeedback.message ? (
          <p className={`clipboard-sanitiser-feedback ${copyFeedback.tone}`} role="status" aria-live="polite">{copyFeedback.message}</p>
        ) : null}

        <div className="clipboard-sanitiser-grid">
          <label>
            Raw input ({rawSummary.chars} chars · {rawSummary.lines} lines)
            <textarea
              value={rawInput}
              rows={12}
              placeholder="Paste raw ChatGPT output here"
              onChange={(event) => handleRawInputChange(event.target.value)}
            />
          </label>

          <label>
            Cleaned preview ({cleanedSummary.chars} chars · {cleanedSummary.lines} lines)
            <textarea
              value={cleanedOutput}
              rows={12}
              readOnly
              placeholder="Cleaned output appears here"
            />
          </label>
        </div>

        <div className="clipboard-sanitiser-actions">
          <button type="button" className="clipboard-sanitiser-primary" onClick={handleCleanAndCopy}>Clean + Copy for Codex</button>
          <button type="button" className="ghost-button" onClick={handleCopyCleanedAgain}>Copy cleaned again</button>
          <button type="button" className="ghost-button" onClick={handleClear}>Clear</button>
        </div>

        <p className="clipboard-sanitiser-note">iPhone flow: paste into raw input, tap Clean + Copy, then paste into Codex. If browser clipboard access fails, use the manual-copy sheet below.</p>
      </section>

      {fallbackCopyText ? (
        <div className="clipboard-sanitiser-fallback" role="dialog" aria-modal="true" aria-label="Clipboard sanitiser manual copy fallback">
          <h3>Manual Copy Cleaned Text</h3>
          <p>Clipboard write was unavailable. Tap-and-hold, Select All, then Copy.</p>
          <textarea
            value={fallbackCopyText}
            readOnly
            rows={12}
            onFocus={(event) => event.target.select()}
          />
          <button type="button" onClick={() => setFallbackCopyText('')}>Close</button>
        </div>
      ) : null}
    </CollapsiblePanel>
  );
}
