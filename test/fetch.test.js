import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPage } from '../src/fetch.js';

const ok = async () => {};
const html = (body, extra = {}) => new Response(body, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', ...extra } });

test('returns body, status and content type', async () => {
  const r = await fetchPage('https://a.com/', { fetchImpl: async () => html('<p>hi</p>'), assertUrl: ok });
  assert.deepEqual([r.status, r.body, r.redirects, r.truncated], [200, '<p>hi</p>', 0, false]);
});

test('follows redirects, resolves relative Location, and validates each hop', async () => {
  const seen = [];
  const fetchImpl = async (u) => {
    seen.push(u);
    return u === 'https://a.com/' ? new Response(null, { status: 301, headers: { location: '/next' } }) : html('done');
  };
  const checked = [];
  const r = await fetchPage('https://a.com/', { fetchImpl, assertUrl: async (u) => { checked.push(u); } });
  assert.deepEqual(seen, ['https://a.com/', 'https://a.com/next']);
  assert.deepEqual(checked, seen);
  assert.equal(r.finalUrl, 'https://a.com/next');
  assert.equal(r.redirects, 1);
});

test('a redirect into a private address is refused', async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } });
  const { assertPublicUrl } = await import('../src/safety.js');
  await assert.rejects(
    fetchPage('https://93.184.216.34/', { fetchImpl, assertUrl: (u) => assertPublicUrl(u) }),
    /private address/,
  );
});

test('redirect loops stop at maxRedirects', async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: '/again' } });
  await assert.rejects(fetchPage('https://a.com/', { fetchImpl, assertUrl: ok, maxRedirects: 3 }), /too many redirects/);
});

test('body is cut at maxBytes and flagged', async () => {
  const r = await fetchPage('https://a.com/', { fetchImpl: async () => html('x'.repeat(5000)), assertUrl: ok, maxBytes: 1000 });
  assert.equal(r.body.length, 1000);
  assert.equal(r.truncated, true);
});

test('binary content is not downloaded', async () => {
  const r = await fetchPage('https://a.com/f.pdf', {
    fetchImpl: async () => new Response('%PDF', { status: 200, headers: { 'content-type': 'application/pdf' } }),
    assertUrl: ok,
  });
  assert.deepEqual([r.body, r.contentType], ['', 'application/pdf']);
});

test('honours the declared charset', async () => {
  const bytes = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in latin1
  const r = await fetchPage('https://a.com/', {
    fetchImpl: async () => new Response(bytes, { status: 200, headers: { 'content-type': 'text/html; charset=iso-8859-1' } }),
    assertUrl: ok,
  });
  assert.equal(r.body, 'café');
});

test('a hung server hits the timeout', async () => {
  const fetchImpl = (u, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  await assert.rejects(fetchPage('https://a.com/', { fetchImpl, assertUrl: ok, timeoutMs: 30 }));
});
