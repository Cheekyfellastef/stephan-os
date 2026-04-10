import { buildAssistantMessageClipboardPayload } from '../utils/assistantMessageClipboard';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import { COPY_STATE, useClipboardButtonState } from '../hooks/useClipboardButtonState';

export default function AnswerPaneCopyButton({ message }) {
  const { copyState, setCopyState } = useClipboardButtonState();

  const handleCopy = async () => {
    const payload = buildAssistantMessageClipboardPayload(message);
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
  };

  const copyLabel = copyState === COPY_STATE.SUCCESS
    ? 'Copied'
    : copyState === COPY_STATE.FAILURE
      ? 'Copy failed'
      : 'Copy';

  return (
    <div className="answer-pane-copy-wrap">
      <button
        type="button"
        className={`answer-pane-copy-button ${copyState}`}
        aria-label="Copy answer"
        title={copyLabel}
        onClick={handleCopy}
      >
        {copyLabel}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {copyState === COPY_STATE.SUCCESS ? 'Answer copied to clipboard.' : copyState === COPY_STATE.FAILURE ? 'Copy failed. Clipboard unavailable.' : ''}
      </span>
    </div>
  );
}
