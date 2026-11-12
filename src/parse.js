// Dependency-free metadata extraction from an HTML string.

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“' };

export function decodeEntities(s) {
  return String(s)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => NAMED[n.toLowerCase()] ?? m);
}

function safeChar(code) {
  try {
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  } catch {
    return '';
  }
}

const clean = (s) => decodeEntities(s).replace(/\s+/g, ' ').trim();

function attrs(tag) {
  const out = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g;
  const inner = tag.replace(/^<\s*[a-zA-Z0-9]+/, '').replace(/\/?>$/, '');
  let m;
  while ((m = re.exec(inner))) out[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  return out;
}

function jsonLd(html) {
  const blocks = [];
  const re = /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    try {
      const data = JSON.parse(m[1]);
      for (const item of Array.isArray(data) ? data : data?.['@graph'] ?? [data]) if (item && typeof item === 'object') blocks.push(item);
    } catch {
      /* ignore malformed JSON-LD */
    }
  }
  return blocks;
}

function nameOf(value) {
  if (!value) return undefined;
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(nameOf).filter(Boolean).join(', ') || undefined;
  return typeof value.name === 'string' ? value.name : undefined;
}

function toIso(value) {
  if (!value) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function absolute(href, base) {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

/** Visible text of the page, with scripts, styles, nav chrome and tags removed. */
export function visibleText(html, maxChars = 1500) {
  const body = html.match(/<body[\s\S]*$/i)?.[0] ?? html;
  const text = body
    .replace(/<(script|style|noscript|svg|nav|header|footer|form|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ');
  return clean(text).slice(0, maxChars);
}

/**
 * @param {string} html
 * @param {string} baseUrl used to resolve relative image and canonical links
 */
export function parseHtml(html, baseUrl) {
  const head = html.match(/<head[\s\S]*?<\/head>/i)?.[0] ?? html.slice(0, 200_000);
  const meta = {};
  for (const tag of head.match(/<meta\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const key = (a.property || a.name || a.itemprop || '').toLowerCase();
    if (key && a.content !== undefined && !(key in meta)) meta[key] = clean(a.content);
  }
  let canonical, icon;
  for (const tag of head.match(/<link\b[^>]*>/gi) ?? []) {
    const a = attrs(tag);
    const rel = (a.rel || '').toLowerCase().split(/\s+/);
    if (rel.includes('canonical') && !canonical) canonical = absolute(a.href, baseUrl);
    if (rel.includes('icon') && !icon) icon = absolute(a.href, baseUrl);
  }
  const ld = jsonLd(html);
  const article = ld.find((x) => /Article|Posting|NewsArticle|VideoObject|SoftwareApplication|Product/i.test(String(x['@type'])));
  const titleTag = head.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1];
  const lang = html.match(/<html[^>]*\blang\s*=\s*["']?([A-Za-z-]+)/i)?.[1];

  return {
    title: meta['og:title'] || meta['twitter:title'] || (titleTag && clean(titleTag)) || article?.headline || (h1 && clean(h1.replace(/<[^>]+>/g, ' '))) || undefined,
    description: meta['og:description'] || meta['twitter:description'] || meta.description || article?.description || undefined,
    siteName: meta['og:site_name'] || meta['application-name'] || undefined,
    image: absolute(meta['og:image'] || meta['twitter:image'] || meta['twitter:image:src'] || nameOfImage(article?.image), baseUrl),
    canonical: canonical || absolute(meta['og:url'], baseUrl),
    author: meta.author || meta['article:author'] || meta['twitter:creator'] || nameOf(article?.author) || undefined,
    publishedAt: toIso(meta['article:published_time'] || meta['og:article:published_time'] || meta.date || meta['datepublished'] || article?.datePublished),
    lang: lang?.toLowerCase(),
    ogType: meta['og:type'] || undefined,
    favicon: icon || absolute('/favicon.ico', baseUrl),
    excerpt: visibleText(html),
  };
}

function nameOfImage(img) {
  if (!img) return undefined;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return nameOfImage(img[0]);
  return img.url;
}
