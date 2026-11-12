import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichUrl, enrichMany } from '../src/enrich.js';

const PAGE = '<html lang="en"><head><title>Hello</title><meta name="description" content="A page"></head><body><p>' + 'word '.repeat(40) + '</p></body></html>';
const respond = (map) => async (u) => {
  const hit = map[u];
  if (!hit) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
  return new Response(hit, { status: 200, headers: { 'content-type': 'text/html' } });
};
const fetchOpts = (map) => ({ fetchImpl: respond(map), assertUrl: async () => {} });

test('enrichUrl fills metadata from the page and classifies', async () => {
  const r = await enrichUrl('https://www.example.com/a/?utm_source=x', { fetch: fetchOpts({ 'https://example.com/a': PAGE }) });
  assert.equal(r.ok, true);
  assert.equal(r.url, 'https://example.com/a');
  assert.deepEqual([r.type, r.title, r.description, r.lang, r.source], ['site', 'Hello', 'A page', 'en', 'html']);
});

test('invalid input comes back as a failed record, not an exception', async () => {
  const r = await enrichUrl('javascript:alert(1)');
  assert.deepEqual([r.ok, r.error], [false, 'not a valid http(s) URL']);
});

test('HTTP errors and network errors are reported on the record', async () => {
  const r404 = await enrichUrl('https://example.com/missing', { fetch: fetchOpts({}) });
  assert.deepEqual([r404.ok, r404.error, r404.status], [false, 'HTTP 404', 404]);
  const boom = await enrichUrl('https://example.com/x', { fetch: { fetchImpl: async () => { throw new Error('ECONNRESET'); }, assertUrl: async () => {} } });
  assert.deepEqual([boom.ok, boom.error], [false, 'ECONNRESET']);
});

test('private targets are refused through the default safety check', async () => {
  const r = await enrichUrl('http://127.0.0.1:8080/admin');
  assert.equal(r.ok, false);
  assert.match(r.error, /private/);
});

test('network:false only normalises and classifies', async () => {
  const r = await enrichUrl('https://github.com/owner/name', { network: false });
  assert.deepEqual([r.type, r.source, r.title], ['repo', 'none', undefined]);
});

test('supplied context rescues a blocked or empty page', async () => {
  const url = 'https://www.instagram.com/reel/AbC/';
  const r = await enrichUrl(url, {
    context: { 'instagram.com/reel/AbC': 'Caption: how we cut onboarding from 9 steps to 3. Details follow in the video.' },
    fetch: fetchOpts({}),
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'context');
  assert.equal(r.fetchError, 'HTTP 404');
  assert.equal(r.title, 'Caption: how we cut onboarding from 9 steps to 3.');
});

test('enrichMany dedupes, keeps input order and bounds concurrency', async () => {
  let active = 0, peak = 0;
  const fetchImpl = async (u) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 15));
    active--;
    return new Response(`<title>${u}</title>`, { status: 200, headers: { 'content-type': 'text/html' } });
  };
  const urls = ['https://a.com/1', 'https://a.com/2?utm_source=z', 'https://a.com/1/', 'bad', 'https://a.com/3', 'https://a.com/4'];
  const { records, duplicates, invalid } = await enrichMany(urls, { concurrency: 2, fetch: { fetchImpl, assertUrl: async () => {} } });
  assert.deepEqual(records.map((r) => r.title), ['https://a.com/1', 'https://a.com/2', 'https://a.com/3', 'https://a.com/4']);
  assert.equal(duplicates.length, 1);
  assert.deepEqual(invalid, ['bad']);
  assert.ok(peak <= 2, `peak concurrency ${peak}`);
});
