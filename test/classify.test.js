import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyUrl, githubRepo } from '../src/classify.js';

test('classifyUrl by host and path', () => {
  const cases = {
    'https://www.instagram.com/reel/Abc/': 'reel',
    'https://instagram.com/p/Abc/': 'carousel',
    'https://instagram.com/someone/': 'post',
    'https://youtube.com/shorts/xyz': 'reel',
    'https://www.youtube.com/watch?v=xyz': 'video',
    'https://x.com/u/status/12345': 'post',
    'https://x.com/u': 'site',
    'https://github.com/owner/name': 'repo',
    'https://github.com/owner': 'site',
    'https://linkedin.com/posts/abc-123': 'post',
    'https://news.ycombinator.com/item?id=1': 'post',
    'https://example.com/pricing': 'site',
    'not a url': 'site',
  };
  for (const [url, expected] of Object.entries(cases)) assert.equal(classifyUrl(url), expected, url);
});

test('githubRepo parses owner and name', () => {
  assert.deepEqual(githubRepo('https://github.com/nodejs/node/issues/1'), { owner: 'nodejs', name: 'node' });
  assert.deepEqual(githubRepo('https://github.com/a/b.git'), { owner: 'a', name: 'b' });
  assert.equal(githubRepo('https://github.com/a'), null);
  assert.equal(githubRepo('https://example.com/a/b'), null);
});
