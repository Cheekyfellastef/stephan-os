import { createContext, createElement, useContext, useMemo, useState } from 'react';

const AIStoreContext = createContext(null);

export function AIStoreProvider({ children }) {
  const [commandHistory, setCommandHistory] = useState([]);
  const [status, setStatus] = useState('idle');
  const [isBusy, setIsBusy] = useState(false);
  const [lastRoute, setLastRoute] = useState('assistant');
  const [debugVisible, setDebugVisible] = useState(false);
  const [debugData, setDebugData] = useState({});

  const value = useMemo(
    () => ({
      commandHistory,
      setCommandHistory,
      status,
      setStatus,
      isBusy,
      setIsBusy,
      lastRoute,
      setLastRoute,
      debugVisible,
      setDebugVisible,
      debugData,
      setDebugData,
    }),
    [commandHistory, status, isBusy, lastRoute, debugVisible, debugData],
  );

  return createElement(AIStoreContext.Provider, { value }, children);
}

export function useAIStore() {
  const context = useContext(AIStoreContext);
  if (!context) {
    throw new Error('useAIStore must be used inside AIStoreProvider');
  }
  return context;
}
