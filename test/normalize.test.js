import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractUrls, normalizeUrl, dedupeKey, dedupe } from '../src/normalize.js';

test('extractUrls finds links in prose and trims trailing punctuation', () => {
  const text = 'see https://a.com/x, and (https://b.org/y?q=1). Also http://c.net/z!\nnot-a-url ftp://nope';
  assert.deepEqual(extractUrls(text), ['https://a.com/x', 'https://b.org/y?q=1', 'http://c.net/z']);
});

test('normalizeUrl strips tracking, fragment, www and trailing slash', () => {
  assert.equal(
    normalizeUrl('https://WWW.Example.com/Path/?utm_source=x&b=2&a=1&fbclid=zzz#frag'),
    'https://example.com/Path?a=1&b=2',
  );
  assert.equal(normalizeUrl('https://example.com/'), 'https://example.com/');
});

test('normalizeUrl maps twitter and youtu.be and rejects non-http', () => {
  assert.equal(normalizeUrl('https://twitter.com/u/status/123?s=20'), 'https://x.com/u/status/123');
  assert.equal(normalizeUrl('https://youtu.be/abc123?si=t'), 'https://youtube.com/watch?v=abc123');
  assert.equal(normalizeUrl('ftp://x.com/a'), null);
  assert.equal(normalizeUrl('javascript:alert(1)'), null);
  assert.equal(normalizeUrl('https://user:pw@example.com/'), null);
  assert.equal(normalizeUrl('nonsense'), null);
});

test('dedupeKey collapses the same thing seen through different URLs', () => {
  assert.equal(dedupeKey('https://twitter.com/a/status/99'), dedupeKey('https://x.com/b/status/99?s=1'));
  assert.equal(dedupeKey('https://youtu.be/vid'), dedupeKey('https://www.youtube.com/watch?v=vid&feature=share'));
  assert.equal(dedupeKey('https://youtube.com/shorts/vid'), dedupeKey('https://youtube.com/watch?v=vid'));
  assert.equal(
    dedupeKey('https://www.instagram.com/reel/AbC/?igsh=1'),
    dedupeKey('https://instagram.com/reel/AbC'),
  );
  assert.notEqual(dedupeKey('https://example.com/a?id=1'), dedupeKey('https://example.com/a?id=2'));
});

test('dedupe keeps the first of each key and reports the rest', () => {
  const { unique, duplicates, invalid } = dedupe([
    'https://example.com/a/',
    'https://www.example.com/a?utm_medium=x',
    'https://example.com/b',
    'mailto:x@y.z',
  ]);
  assert.deepEqual(unique.map((u) => u.url), ['https://example.com/a', 'https://example.com/b']);
  assert.equal(duplicates.length, 1);
  assert.equal(duplicates[0].duplicateOf, 'https://example.com/a');
  assert.deepEqual(invalid, ['mailto:x@y.z']);
});
