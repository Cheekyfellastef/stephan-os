export function createSystemState(initialState = {}) {
  const state = { ...initialState };

  return {
    get(key) {
      return state[key];
    },

    set(key, value) {
      state[key] = value;
      return value;
    },

    has(key) {
      return Object.prototype.hasOwnProperty.call(state, key);
    },

    snapshot() {
      return { ...state };
    }
  };
}
