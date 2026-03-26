const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0']);

function safeUrlFromLocation(locationLike = globalThis.location) {
  const href = typeof locationLike?.href === 'string' ? locationLike.href : '';
  if (!href) {
    return null;
  }

  try {
    return new URL(href);
  } catch {
    return null;
  }
}

export function resolveLauncherRuntimeMode({ location = globalThis.location } = {}) {
  const parsed = safeUrlFromLocation(location);
  const hostname = String(parsed?.hostname || '').trim().toLowerCase();
  const pathname = String(parsed?.pathname || '/').trim() || '/';
  const origin = String(parsed?.origin || '').trim();
  const isLocalHost = LOCAL_HOSTS.has(hostname);

  const mode = isLocalHost ? 'local' : 'hosted';
  const shellSource = pathname.startsWith('/apps/stephanos/dist/')
    ? 'stephanos-dist'
    : pathname === '/' || pathname === '/index.html'
      ? 'launcher-root'
      : 'launcher-nested';

  return {
    mode,
    hostname,
    origin,
    pathname,
    shellSource,
    isLocalHost,
  };
}
