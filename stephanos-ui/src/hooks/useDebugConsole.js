import { useEffect } from 'react';
import { useAIStore } from '../state/aiStore';

export function useDebugConsole() {
  const { debugVisible, setDebugVisible } = useAIStore();

  useEffect(() => {
    function onKeyDown(event) {
      if (event.key === 'F1') {
        event.preventDefault();
        setDebugVisible((prev) => !prev);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [setDebugVisible]);

  return { debugVisible, setDebugVisible };
}
