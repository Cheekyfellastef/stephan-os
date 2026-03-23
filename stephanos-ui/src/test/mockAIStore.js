export function __setMockStore(nextStore) {
  globalThis.__STEPHANOS_TEST_AI_STORE__ = nextStore && typeof nextStore === 'object' ? nextStore : {};
}

export function useAIStore() {
  return globalThis.__STEPHANOS_TEST_AI_STORE__ || {};
}
