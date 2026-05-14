import {
  buildAssistantAnswerClipboardPayload,
  buildAssistantDebugClipboardPayload,
} from '../utils/assistantMessageClipboard';
import { writeTextToClipboard } from '../utils/clipboardCopy';
import { COPY_STATE, useClipboardButtonState } from '../hooks/useClipboardButtonState';
import { recordCopyFeedbackEvent } from '../utils/copyFeedbackRecorder';

export default function AnswerPaneCopyButton({ message }) {
  const { copyState: answerCopyState, setCopyState: setAnswerCopyState } = useClipboardButtonState();
  const { copyState: debugCopyState, setCopyState: setDebugCopyState } = useClipboardButtonState();

  const handleCopy = async (mode = 'answer') => {
    const payload = mode === 'debug'
      ? buildAssistantDebugClipboardPayload(message)
      : buildAssistantAnswerClipboardPayload(message);
    if (!String(payload || '').trim()) {
      if (mode === 'debug') {
        setDebugCopyState(COPY_STATE.FAILURE);
      } else {
        setAnswerCopyState(COPY_STATE.FAILURE);
      }
      return;
    }

    try {
      const result = await writeTextToClipboard(payload);
      const success = result.ok === true;
      recordCopyFeedbackEvent({ source: mode === 'debug' ? 'AnswerPaneCopyButton.debug' : 'AnswerPaneCopyButton.answer', success, visualState: success ? 'success' : 'failure', greenConfirmed: success, payloadKind: mode, reason: result.reason || 'unknown', method: result.method || 'unknown' });
      if (mode === 'debug') {
        setDebugCopyState(result.ok ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
      } else {
        setAnswerCopyState(result.ok ? COPY_STATE.SUCCESS : COPY_STATE.FAILURE);
      }
    } catch {
      recordCopyFeedbackEvent({ source: mode === 'debug' ? 'AnswerPaneCopyButton.debug' : 'AnswerPaneCopyButton.answer', success: false, visualState: 'failure', greenConfirmed: false, payloadKind: mode, reason: 'exception', method: 'unknown' });
      if (mode === 'debug') {
        setDebugCopyState(COPY_STATE.FAILURE);
      } else {
        setAnswerCopyState(COPY_STATE.FAILURE);
      }
    }
  };

  const answerCopyLabel = answerCopyState === COPY_STATE.SUCCESS
    ? 'Copied Answer'
    : answerCopyState === COPY_STATE.FAILURE
      ? 'Copy failed'
      : 'Copy Answer';
  const debugCopyLabel = debugCopyState === COPY_STATE.SUCCESS
    ? 'Copied Debug'
    : debugCopyState === COPY_STATE.FAILURE
      ? 'Copy failed'
      : 'Copy Debug Payload';

  return (
    <div className="answer-pane-copy-wrap">
      <button
        type="button"
        className={`answer-pane-copy-button ${answerCopyState}`}
        aria-label="Copy answer"
        title={answerCopyLabel}
        onClick={() => handleCopy('answer')}
      >
        {answerCopyLabel}
      </button>
      <button
        type="button"
        className={`answer-pane-copy-button answer-pane-copy-button-debug ${debugCopyState}`}
        aria-label="Copy debug payload"
        title={debugCopyLabel}
        onClick={() => handleCopy('debug')}
      >
        {debugCopyLabel}
      </button>
      <span className="sr-only" role="status" aria-live="polite">
        {answerCopyState === COPY_STATE.SUCCESS ? 'Answer copied to clipboard.' : answerCopyState === COPY_STATE.FAILURE ? 'Answer copy failed. Clipboard unavailable.' : ''}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {debugCopyState === COPY_STATE.SUCCESS ? 'Debug payload copied to clipboard.' : debugCopyState === COPY_STATE.FAILURE ? 'Debug payload copy failed. Clipboard unavailable.' : ''}
      </span>
    </div>
  );
}
