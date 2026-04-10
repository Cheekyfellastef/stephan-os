import { useEffect, useState } from 'react';

export const COPY_STATE = {
  IDLE: 'idle',
  SUCCESS: 'success',
  FAILURE: 'failure',
};

export const COPY_STATE_DURATION_MS = 3200;

export function useClipboardButtonState() {
  const [copyState, setCopyState] = useState(COPY_STATE.IDLE);

  useEffect(() => {
    if (copyState === COPY_STATE.IDLE) return undefined;

    const timerId = setTimeout(() => {
      setCopyState(COPY_STATE.IDLE);
    }, COPY_STATE_DURATION_MS);

    return () => clearTimeout(timerId);
  }, [copyState]);

  return { copyState, setCopyState };
}
