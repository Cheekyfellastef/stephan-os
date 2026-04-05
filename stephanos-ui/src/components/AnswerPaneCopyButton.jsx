import { useEffect, useState } from 'react';
import { buildAssistantMessageClipboardPayload } from '../utils/assistantMessageClipboard';
import { writeTextToClipboard } from '../utils/clipboardCopy';

const COPY_STATE = {
  IDLE: 'idle',
  SUCCESS: 'success',
  FAILURE: 'failure',
};

export default function AnswerPaneCopyButton({ message }) {
  const [copyState, setCopyState] = useState(COPY_STATE.IDLE);

  useEffect(() => {
    if (copyState === COPY_STATE.IDLE) return undefined;

    const timerId = setTimeout(() => {
      setCopyState(COPY_STATE.IDLE);
    }, 2200);

    return () => clearTimeout(timerId);
  }, [copyState]);

  const handleCopy = async () => {
    const payload = buildAssistantMessageClipboardPayload(message);
    const result = await writeTextToClipboard(payload);
    setCopyState(result.ok ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
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
