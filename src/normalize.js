// URL extraction, normalisation and dedupe keys.

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'dclid', 'msclkid', 'mc_cid', 'mc_eid', 'igshid', 'igsh', 'si', 'ref', 'ref_src',
  'ref_url', 's', 't', 'feature', 'cmpid', 'spm', 'yclid', '_hsenc', '_hsmi',
]);

const TRAILING_PUNCTUATION = /[)\]}>,.;:!?'"]+$/;

/** Pull every http(s) URL out of free text, in order, with trailing punctuation trimmed. */
export function extractUrls(text) {
  const found = String(text ?? '').match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  return found.map((u) => u.replace(TRAILING_PUNCTUATION, '')).filter(Boolean);
}

function canonicalHost(hostname) {
  let host = hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'twitter.com' || host === 'mobile.twitter.com' || host === 'mobile.x.com') host = 'x.com';
  return host;
}

function isTracking(name) {
  const n = name.toLowerCase();
  return n.startsWith('utm_') || TRACKING_PARAMS.has(n);
}

/**
 * Clean a URL for display and fetching: lowercase host, drop the fragment and
 * tracking parameters, sort the remaining parameters, strip a trailing slash.
 * Returns null for anything that is not a plain http(s) URL.
 */
export function normalizeUrl(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password) return null;
  u.hash = '';
  u.hostname = canonicalHost(u.hostname);
  if (u.hostname === 'youtu.be') {
    const id = u.pathname.replace(/^\/+/, '').split('/')[0];
    if (!id) return null;
    const t = u.searchParams.get('t');
    u = new URL(`https://youtube.com/watch?v=${encodeURIComponent(id)}${t ? `&t=${encodeURIComponent(t)}` : ''}`);
  }
  const kept = [...u.searchParams.entries()].filter(([k]) => !isTracking(k));
  kept.sort(([a], [b]) => a.localeCompare(b));
  u.search = '';
  for (const [k, v] of kept) u.searchParams.append(k, v);
  if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
  return u.toString();
}

/**
 * Identity of a link for dedupe. Two URLs share a key when they point at the
 * same thing: scheme, www and trailing slashes are ignored, X/Twitter status
 * links collapse to the status id, and YouTube links collapse to the video id.
 * Share-token query strings do not make two Instagram posts different.
 */
export function dedupeKey(input) {
  const clean = normalizeUrl(input);
  if (!clean) return null;
  const u = new URL(clean);
  const host = u.hostname;
  const status = u.pathname.match(/\/status\/(\d+)/);
  if (host === 'x.com' && status) return `x.com/status/${status[1]}`;
  if (host === 'youtube.com' || host === 'm.youtube.com') {
    const v = u.searchParams.get('v');
    if (v) return `youtube.com/watch?v=${v}`;
    const short = u.pathname.match(/^\/shorts\/([\w-]+)/);
    if (short) return `youtube.com/watch?v=${short[1]}`;
  }
  const path = u.pathname === '/' ? '' : u.pathname;
  if (host.endsWith('instagram.com')) return `${host}${path}`;
  return `${host}${path}${u.search}`;
}

/** Normalise and dedupe a list. Returns unique records plus what was dropped. */
export function dedupe(inputs) {
  const seen = new Map();
  const unique = [];
  const duplicates = [];
  const invalid = [];
  for (const input of inputs) {
    const url = normalizeUrl(input);
    const key = url && dedupeKey(url);
    if (!key) {
      invalid.push(input);
    } else if (seen.has(key)) {
      duplicates.push({ input, duplicateOf: seen.get(key) });
    } else {
      seen.set(key, url);
      unique.push({ input, url, key });
    }
  }
  return { unique, duplicates, invalid };
}
