// A fetcher that is safe to point at untrusted URLs: every hop is validated,
// redirects are capped, the body is size-limited, and time is bounded.

import { assertPublicUrl } from './safety.js';

const DEFAULT_UA = 'link-enricher/0.1 (+https://github.com/kroevasuperadmin/link-enricher)';
const REDIRECTS = new Set([301, 302, 303, 307, 308]);

function decoderFor(contentType) {
  const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  try {
    return new TextDecoder(charset || 'utf-8');
  } catch {
    return new TextDecoder('utf-8');
  }
}

async function readLimited(response, maxBytes) {
  if (!response.body) return { bytes: new Uint8Array(0), truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.length - (total - maxBytes)));
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0;
  for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  return { bytes, truncated };
}

/**
 * @param {string} url
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {number} [options.timeoutMs]
 * @param {number} [options.maxBytes]
 * @param {number} [options.maxRedirects]
 * @param {string} [options.userAgent]
 * @param {Record<string,string>} [options.headers]
 * @param {(url: string) => Promise<void>} [options.assertUrl] set to a no-op only in tests
 * @returns {Promise<{url: string, finalUrl: string, status: number, contentType: string, body: string, truncated: boolean, redirects: number}>}
 */
export async function fetchPage(url, options = {}) {
  const {
    fetchImpl = fetch,
    timeoutMs = 15_000,
    maxBytes = 1_000_000,
    maxRedirects = 5,
    userAgent = DEFAULT_UA,
    headers = {},
    assertUrl = assertPublicUrl,
  } = options;
  const signal = AbortSignal.timeout(timeoutMs);
  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    await assertUrl(current);
    const response = await fetchImpl(current, {
      redirect: 'manual',
      signal,
      headers: { 'user-agent': userAgent, accept: 'text/html,application/xhtml+xml,application/json;q=0.8,*/*;q=0.5', ...headers },
    });
    if (REDIRECTS.has(response.status)) {
      const location = response.headers.get('location');
      await response.body?.cancel?.().catch(() => {});
      if (!location) throw new Error(`redirect ${response.status} without Location`);
      current = new URL(location, current).toString();
      continue;
    }
    const contentType = response.headers.get('content-type') ?? '';
    const isText = /^(text\/|application\/(xhtml\+xml|json|ld\+json))/i.test(contentType) || contentType === '';
    if (!isText) {
      await response.body?.cancel?.().catch(() => {});
      return { url, finalUrl: current, status: response.status, contentType, body: '', truncated: false, redirects: hop };
    }
    const { bytes, truncated } = await readLimited(response, maxBytes);
    return {
      url, finalUrl: current, status: response.status, contentType,
      body: decoderFor(contentType).decode(bytes), truncated, redirects: hop,
    };
  }
  throw new Error(`too many redirects (more than ${maxRedirects})`);
}
