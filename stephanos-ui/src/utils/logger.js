function ts() {
  return new Date().toISOString();
}

export function createLogger(scope = 'ui') {
  return {
    info(message, meta) {
      console.log(`[${ts()}] [${scope}]`, message, meta ?? '');
    },
    error(message, meta) {
      console.error(`[${ts()}] [${scope}]`, message, meta ?? '');
    },
    warn(message, meta) {
      console.warn(`[${ts()}] [${scope}]`, message, meta ?? '');
    },
  };
}
