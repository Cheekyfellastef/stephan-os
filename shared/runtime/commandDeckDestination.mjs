const LAUNCHER_META_SELECTOR = 'meta[name="stephanos-launcher-shell-url"]';
const LAUNCHER_QUERY_PARAM = 'stephanosLauncherShellUrl';

function readLauncherMetaUrl(windowRef = globalThis.window) {
  const explicitUrl = String(
    windowRef?.document?.querySelector?.(LAUNCHER_META_SELECTOR)?.getAttribute('content') || ''
  ).trim();
  return explicitUrl || '';
}

function readLauncherQueryUrl(windowRef = globalThis.window) {
  try {
    const href = String(windowRef?.location?.href || '').trim();
    if (!href) {
      return '';
    }

    const parsed = new URL(href, href);
    return String(parsed.searchParams.get(LAUNCHER_QUERY_PARAM) || '').trim();
  } catch {
    return '';
  }
}

function deriveLauncherPathname(windowRef = globalThis.window) {
  try {
    const pathname = String(windowRef?.location?.pathname || '/').trim() || '/';
    const segments = pathname.split('/').filter(Boolean);

    if (segments.length === 0) {
      return '/';
    }

    const appsSegmentIndex = segments.indexOf('apps');
    if (appsSegmentIndex === 0) {
      return '/';
    }

    if (appsSegmentIndex > 0) {
      return `/${segments.slice(0, appsSegmentIndex).join('/')}/`;
    }

    return `/${segments[0]}/`;
  } catch {
    return '/';
  }
}

export function resolveCommandDeckDestinationPath(windowRef = globalThis.window) {
  const launcherMetaUrl = readLauncherMetaUrl(windowRef);
  if (launcherMetaUrl) {
    try {
      return new URL(launcherMetaUrl, windowRef?.location?.href || '').pathname || '/';
    } catch {
      // fall through to query/path-derived launcher path
    }
  }

  const launcherQueryUrl = readLauncherQueryUrl(windowRef);
  if (launcherQueryUrl) {
    try {
      return new URL(launcherQueryUrl, windowRef?.location?.href || '').pathname || '/';
    } catch {
      // fall through to path-derived launcher path
    }
  }

  return deriveLauncherPathname(windowRef);
}

export function withCommandDeckDestination(targetUrl, windowRef = globalThis.window) {
  const rawTarget = String(targetUrl || '').trim();
  if (!rawTarget) {
    return rawTarget;
  }

  try {
    const resolvedTarget = new URL(rawTarget, windowRef?.location?.href || undefined);
    const launcherShellHref = new URL(resolveCommandDeckDestinationPath(windowRef), windowRef?.location?.href || resolvedTarget.href).href;
    resolvedTarget.searchParams.set(LAUNCHER_QUERY_PARAM, launcherShellHref);
    return resolvedTarget.href;
  } catch {
    return rawTarget;
  }
}
