import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enrichUrl } from '../src/enrich.js';

const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } });
const noCheck = async () => {};

test('GitHub repos use the API and carry stars, language and license', async () => {
  const calls = [];
  const fetchImpl = async (u, init) => {
    calls.push([u, init.headers.authorization]);
    return json({ full_name: 'nodejs/node', description: 'Node.js runtime', owner: { login: 'nodejs' }, stargazers_count: 100, forks_count: 5, language: 'JavaScript', license: { spdx_id: 'MIT' }, topics: ['runtime'], created_at: '2009-05-27T00:00:00Z', pushed_at: '2026-11-01T00:00:00Z', archived: false });
  };
  const r = await enrichUrl('https://github.com/nodejs/node', { githubToken: 't0k', fetch: { fetchImpl, assertUrl: noCheck } });
  assert.deepEqual(calls, [['https://api.github.com/repos/nodejs/node', 'Bearer t0k']]);
  assert.equal(r.source, 'github');
  assert.equal(r.title, 'nodejs/node');
  assert.equal(r.extra.stars, 100);
  assert.equal(r.extra.license, 'MIT');
  assert.equal(r.type, 'repo');
});

test('X posts go through oEmbed and skip the JS-only HTML', async () => {
  const urls = [];
  const fetchImpl = async (u) => {
    urls.push(u);
    return json({ author_name: 'Ada', provider_name: 'Twitter', html: '<blockquote class="twitter-tweet"><p lang="en">Shipped v2 today &amp; it is fast<br>really</p>&mdash; Ada (@ada) <a href="https://twitter.com/ada/status/1">Nov 12, 2026</a></blockquote>' });
  };
  const r = await enrichUrl('https://twitter.com/ada/status/1?s=20', { fetch: { fetchImpl, assertUrl: noCheck } });
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/publish\.twitter\.com\/oembed\?omit_script=1&url=/);
  assert.equal(r.source, 'oembed');
  assert.equal(r.author, 'Ada');
  assert.match(r.excerpt, /^Shipped v2 today & it is fast really/);
});

test('YouTube videos use oEmbed for title, channel and thumbnail', async () => {
  const fetchImpl = async () => json({ title: 'Build a CLI', author_name: 'Chan', provider_name: 'YouTube', thumbnail_url: 'https://i.ytimg.com/x.jpg' });
  const r = await enrichUrl('https://youtu.be/abc123', { fetch: { fetchImpl, assertUrl: noCheck } });
  assert.deepEqual([r.title, r.author, r.image, r.type], ['Build a CLI', 'Chan', 'https://i.ytimg.com/x.jpg', 'video']);
});

test('a failing provider falls back to scraping the page', async () => {
  const fetchImpl = async (u) => u.startsWith('https://api.github.com')
    ? json({ message: 'rate limited' }, 403)
    : new Response('<title>owner/name: tool</title>', { status: 200, headers: { 'content-type': 'text/html' } });
  const r = await enrichUrl('https://github.com/owner/name', { fetch: { fetchImpl, assertUrl: noCheck } });
  assert.deepEqual([r.source, r.title], ['html', 'owner/name: tool']);
});

test('providers:false skips them', async () => {
  const seen = [];
  const fetchImpl = async (u) => { seen.push(u); return new Response('<title>t</title>', { status: 200, headers: { 'content-type': 'text/html' } }); };
  await enrichUrl('https://github.com/owner/name', { providers: false, fetch: { fetchImpl, assertUrl: noCheck } });
  assert.deepEqual(seen, ['https://github.com/owner/name']);
});
