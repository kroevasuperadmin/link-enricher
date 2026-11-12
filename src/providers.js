// Site-specific lookups that beat scraping HTML: GitHub's API for repos and
// oEmbed for X posts and YouTube videos, which serve little useful HTML.

import { fetchPage } from './fetch.js';
import { githubRepo } from './classify.js';
import { decodeEntities } from './parse.js';

async function getJson(url, fetchOptions, headers = {}) {
  const page = await fetchPage(url, { ...fetchOptions, headers: { accept: 'application/json', ...headers } });
  if (page.status !== 200) throw new Error(`HTTP ${page.status}`);
  return JSON.parse(page.body);
}

async function github(url, { fetch: fetchOptions = {}, githubToken }) {
  const repo = githubRepo(url);
  if (!repo) return null;
  const headers = { accept: 'application/vnd.github+json' };
  if (githubToken) headers.authorization = `Bearer ${githubToken}`;
  const data = await getJson(`https://api.github.com/repos/${repo.owner}/${repo.name}`, fetchOptions, headers);
  return {
    title: data.full_name,
    description: data.description || undefined,
    author: data.owner?.login,
    publishedAt: data.created_at,
    lang: undefined,
    extra: {
      stars: data.stargazers_count,
      forks: data.forks_count,
      language: data.language || undefined,
      license: data.license?.spdx_id || undefined,
      topics: data.topics?.length ? data.topics : undefined,
      pushedAt: data.pushed_at,
      archived: data.archived || undefined,
    },
  };
}

async function oembed(url, { fetch: fetchOptions = {} }) {
  const u = new URL(url);
  let endpoint;
  if (u.hostname === 'x.com' && /\/status\/\d+/.test(u.pathname)) {
    endpoint = `https://publish.twitter.com/oembed?omit_script=1&url=${encodeURIComponent(url.replace('//x.com', '//twitter.com'))}`;
  } else if (u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') {
    endpoint = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(url)}`;
  } else {
    return null;
  }
  const data = await getJson(endpoint, fetchOptions);
  const text = data.html
    ? decodeEntities(data.html.replace(/<blockquote[^>]*>|<\/blockquote>/g, ' ').replace(/<br\s*\/?>/g, ' ').replace(/<a\b[^>]*>[\s\S]*?<\/a>\s*$/i, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    : undefined;
  return {
    title: data.title || (text && text.slice(0, 120)) || undefined,
    author: data.author_name,
    siteName: data.provider_name,
    image: data.thumbnail_url,
    excerpt: text,
  };
}

/**
 * Try the matching provider for a URL. Returns null if none applies or the
 * provider failed, so the caller can fall back to plain HTML.
 */
export async function runProvider(url, options = {}) {
  for (const provider of [github, oembed]) {
    try {
      const result = await provider(url, options);
      if (result) {
        const fields = Object.fromEntries(Object.entries(result).filter(([, v]) => v !== undefined && v !== ''));
        return { name: provider.name, fields };
      }
    } catch {
      /* fall through to HTML */
    }
  }
  return null;
}
