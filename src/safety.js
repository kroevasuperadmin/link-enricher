// Refuse to fetch anything that points inside the machine or its network.
// A link list is untrusted input: without this, "http://169.254.169.254/" in a
// pasted doc turns the enricher into a way to read cloud metadata.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function ipv4Private(ip) {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

export function isPrivateIp(ip) {
  const kind = isIP(ip);
  if (kind === 4) return ipv4Private(ip);
  if (kind === 6) {
    // Use the same canonical form URL uses, including for DNS answers that
    // contain expanded words or a dotted IPv4 tail. A scope ID is local-only.
    const v = new URL(`http://[${ip.replace(/%.*/, '')}]/`).hostname.slice(1, -1).toLowerCase();
    if (v === '::' || v === '::1') return true;
    const mapped = v.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16);
      const low = parseInt(mapped[2], 16);
      return ipv4Private([high >> 8, high & 255, low >> 8, low & 255].join('.'));
    }
    return /^(fc|fd|fe[89ab])/.test(v) || v.startsWith('ff');
  }
  return false;
}

/**
 * Throws unless `url` is a public http(s) URL. Literal IPs are checked directly;
 * hostnames are resolved and every address must be public.
 * @param {string} url
 * @param {{lookup?: (host: string) => Promise<Array<{address: string}>>}} [options]
 */
export async function assertPublicUrl(url, { lookup = (h) => dnsLookup(h, { all: true }) } = {}) {
  let u;
  try {
    u = new URL(url);
  } catch {
    throw new Error('invalid URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('only http and https are allowed');
  if (u.username || u.password) throw new Error('credentials in URL are not allowed');
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error('private host');
  }
  if (isIP(host)) {
    if (isPrivateIp(host)) throw new Error('private address');
    return;
  }
  let addresses;
  try {
    addresses = await lookup(host);
  } catch {
    throw new Error('host did not resolve');
  }
  if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) throw new Error('private address');
}
