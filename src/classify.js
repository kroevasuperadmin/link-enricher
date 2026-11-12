// Guess what kind of thing a URL points at, from the URL alone.

/**
 * @returns {'reel'|'carousel'|'post'|'video'|'repo'|'site'} a coarse type.
 *   reel: short vertical video, carousel: image set, post: social/status/article post,
 *   video: long-form video, repo: code repository, site: everything else.
 */
export function classifyUrl(url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'site';
  }
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  const path = u.pathname;

  if (host.endsWith('instagram.com')) {
    if (/^\/(reel|reels)\//.test(path)) return 'reel';
    if (/^\/p\//.test(path)) return 'carousel';
    return 'post';
  }
  if (host.endsWith('tiktok.com')) return /\/video\//.test(path) ? 'reel' : 'post';
  if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtu.be') {
    return /^\/shorts\//.test(path) ? 'reel' : 'video';
  }
  if (host === 'vimeo.com') return 'video';
  if (host === 'x.com') return /\/status\/\d+/.test(path) ? 'post' : 'site';
  if (host.endsWith('linkedin.com')) return /^\/(posts|feed\/update|pulse)\//.test(path) ? 'post' : 'site';
  if (['reddit.com', 'news.ycombinator.com', 'threads.net', 'bsky.app', 'mastodon.social', 'substack.com'].includes(host)) {
    return 'post';
  }
  if (host.endsWith('.substack.com') || host === 'medium.com' || host.endsWith('.medium.com')) return 'post';
  if (['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org'].includes(host)) {
    return path.split('/').filter(Boolean).length >= 2 ? 'repo' : 'site';
  }
  return 'site';
}

/** Parse "owner/name" out of a GitHub repo URL, or null. */
export function githubRepo(url) {
  try {
    const u = new URL(url);
    if (u.hostname.replace(/^www\./, '') !== 'github.com') return null;
    const [owner, name] = u.pathname.split('/').filter(Boolean);
    if (!owner || !name) return null;
    return { owner, name: name.replace(/\.git$/, '') };
  } catch {
    return null;
  }
}
