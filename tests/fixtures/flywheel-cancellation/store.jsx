import { useSyncExternalStore } from 'react';

let state = {
  uiLayout: { flywheelPanel: true }, togglePanel() {}, bridgeTransportTruth: {},
  runtimeStatusModel: { runtimeContext: { homeNodeBridge: {
    configured: true, accepted: true, backendUrl: 'http://127.0.0.1:8787',
    executionUrl: '', reachability: 'reachable', reason: 'fixture',
  } } },
};
const listeners = new Set();
export function updateBridge(changes = {}) {
  state = { ...state, runtimeStatusModel: { runtimeContext: { homeNodeBridge: {
    ...state.runtimeStatusModel.runtimeContext.homeNodeBridge, ...changes,
  } } } };
  for (const listener of listeners) listener();
}
export function useAIStore() {
  return useSyncExternalStore((listener) => { listeners.add(listener); return () => listeners.delete(listener); }, () => state);
}
