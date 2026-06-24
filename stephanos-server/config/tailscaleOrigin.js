const TAILSCALE_UI_PORTS = new Set([4173, 5173]);

function parseIpv4(hostname = '') {
  const value = String(hostname || '').trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return null;
  const octets = value.split('.').map((part) => Number.parseInt(part, 10));
  return octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255) ? null : octets;
}

export function isTailscaleIpv4Host(hostname = '') {
  const octets = parseIpv4(hostname);
  return Boolean(octets && octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
}

export function isTailscaleDnsHost(hostname = '') {
  const normalized = String(hostname || '').trim().toLowerCase();
  return Boolean(normalized) && normalized.endsWith('.ts.net') && !normalized.startsWith('.') && !normalized.includes('..');
}

export function isAllowedTailscaleFrontendOrigin(origin = '') {
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    const tailscaleHost = isTailscaleIpv4Host(parsed.hostname) || isTailscaleDnsHost(parsed.hostname);
    if (!tailscaleHost) return false;
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    return TAILSCALE_UI_PORTS.has(port) || (parsed.protocol === 'https:' && port === 443);
  } catch {
    return false;
  }
}
