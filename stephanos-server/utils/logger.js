const now = () => new Date().toISOString();

function format(scope, level, message) {
  return `[${now()}] [${scope}] [${level}] ${message}`;
}

export function createLogger(scope = 'server') {
  return {
    info(message, meta) {
      console.log(format(scope, 'INFO', message), meta ?? '');
    },
    warn(message, meta) {
      console.warn(format(scope, 'WARN', message), meta ?? '');
    },
    error(message, meta) {
      console.error(format(scope, 'ERROR', message), meta ?? '');
    },
    debug(message, meta) {
      console.debug(format(scope, 'DEBUG', message), meta ?? '');
    },
  };
}
