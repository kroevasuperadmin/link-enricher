import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHtml, decodeEntities, visibleText } from '../src/parse.js';

const PAGE = `<!doctype html><html lang="en-GB"><head>
<title>Fallback &amp; title</title>
<meta property="og:title" content="Launch &quot;Day&quot; notes">
<meta property="og:description" content="What we shipped &#8212; and why">
<meta property="og:image" content="/img/cover.png">
<meta property="og:site_name" content="Example Blog">
<meta property='article:published_time' content='2026-03-04T10:00:00+08:00'>
<meta name="author" content="Ada Lovelace">
<link rel="canonical" href="https://example.com/posts/launch">
<link rel="shortcut icon" href="/f.png">
<script type="application/ld+json">{"@type":"Article","headline":"JSON-LD headline","author":{"name":"LD Author"}}</script>
</head><body><nav>Menu Home</nav><h1>Main <b>heading</b></h1><p>First paragraph.</p>
<script>var secret = 1</script><style>p{}</style><footer>Copyright</footer></body></html>`;

test('parseHtml reads Open Graph, canonical, icon, language and dates', () => {
  const r = parseHtml(PAGE, 'https://example.com/posts/launch?utm_source=x');
  assert.equal(r.title, 'Launch "Day" notes');
  assert.equal(r.description, 'What we shipped — and why');
  assert.equal(r.image, 'https://example.com/img/cover.png');
  assert.equal(r.siteName, 'Example Blog');
  assert.equal(r.canonical, 'https://example.com/posts/launch');
  assert.equal(r.favicon, 'https://example.com/f.png');
  assert.equal(r.author, 'Ada Lovelace');
  assert.equal(r.publishedAt, '2026-03-04T02:00:00.000Z');
  assert.equal(r.lang, 'en-gb');
});

test('title falls back to <title>, then JSON-LD, then h1', () => {
  assert.equal(parseHtml('<head><title>Only &amp; title</title></head>', 'https://a.com').title, 'Only & title');
  assert.equal(parseHtml('<head><script type="application/ld+json">{"@type":"Article","headline":"LD"}</script></head>', 'https://a.com').title, 'LD');
  assert.equal(parseHtml('<body><h1>Big <i>One</i></h1></body>', 'https://a.com').title, 'Big One');
});

test('JSON-LD author is used when no meta author exists', () => {
  const html = '<head><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","author":[{"name":"A"},{"name":"B"}],"datePublished":"2026-01-02"}]}</script></head>';
  const r = parseHtml(html, 'https://a.com');
  assert.equal(r.author, 'A, B');
  assert.equal(r.publishedAt, '2026-01-02T00:00:00.000Z');
});

test('visibleText drops scripts, styles, nav and footer', () => {
  const text = visibleText(PAGE);
  assert.equal(text, 'Main heading First paragraph.');
});

test('malformed input never throws', () => {
  assert.doesNotThrow(() => parseHtml('<meta content=', 'https://a.com'));
  assert.doesNotThrow(() => parseHtml('', 'https://a.com'));
  assert.equal(decodeEntities('&#99999999999; &unknown;'), ' &unknown;');
});
