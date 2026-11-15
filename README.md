# link-enricher

Give it a pile of URLs (a pasted doc, a bookmarks export, a CSV). It returns one record per unique link with the title, description, author, date, a type guess and a text excerpt.

## Why

A list of saved links is hard to use until each entry has a title, an author and a type, and the duplicates are gone. Lists merged from several sources often hold one post under several tracking-parameter variants. link-enricher handles both.

- **Dedupes on what the link points at.** `twitter.com/u/status/9?s=20` and `x.com/v/status/9` are one link. So are `youtu.be/ID` and `youtube.com/watch?v=ID&feature=share`, and an Instagram reel with and without `?igsh=`.
- **Uses the right source per site.** GitHub repos come from the GitHub API (stars, language, license, last push). X posts and YouTube videos come from oEmbed, since their HTML is empty without JavaScript. Everything else is read from Open Graph tags, JSON-LD, `<title>` and the visible text.
- **Checks for private targets.** Every request, including each redirect hop, is checked against private, loopback and link-local addresses, so a pasted `http://169.254.169.254/` is refused instead of fetched (the Limits section covers the DNS caveat). Responses default to a 1 MB size limit and a 15 s timeout (`--timeout` changes the timeout).
- **Reports failures per link.** A broken URL becomes a record with `ok: false` and an `error`.

It has no dependencies and needs Node 20 or later.

## Install

```sh
npm install -g github:kroevasuperadmin/link-enricher
# or run it without installing
npx github:kroevasuperadmin/link-enricher --help
```

## Usage

```sh
link-enricher [options] [url | file ...]
```

Arguments starting with `http://` or `https://` are URLs. Any other argument is a text file whose URLs are extracted, whatever its format. With no arguments, URLs are read from stdin.

| option | meaning |
|---|---|
| `-f, --format json\|ndjson\|csv` | output format (default `json`) |
| `-o, --out FILE` | write to a file |
| `-c, --concurrency N` | parallel fetches (default 4) |
| `--timeout MS` | per-request timeout (default 15000) |
| `--no-network` | only normalise, dedupe and classify |
| `--no-providers` | skip the GitHub API and oEmbed, scrape HTML only |
| `--context FILE.json` | `{"<url>": "text"}`, used when a page is empty or blocked (for example a reel caption you copied by hand) |
| `--seen FILE` | skip URLs already listed in FILE; add `--update-seen` to append the new ones |
| `--allow-private` | do not block private addresses (intranet links, fake-IP proxies). Unsafe for untrusted lists |
| `--plugin FILE.js` | ES module whose default export is `async (record) => value`; the result is stored in `record.plugin`. Use it for a summary, tagging or a database write |
| `--fail-on-error` | exit 1 if any record failed |

`GITHUB_TOKEN` in the environment raises the GitHub API rate limit.

### Library

```js
import { enrichMany } from 'link-enricher';

const { records, duplicates, invalid } = await enrichMany([
  'https://github.com/nodejs/node',
  'https://youtu.be/dQw4w9WgXcQ',
  'https://example.com/post?utm_source=newsletter',
], { concurrency: 4 });
```

## Example

```console
$ printf 'https://github.com/nodejs/node\nhttps://youtu.be/dQw4w9WgXcQ?si=abc\nhttps://www.youtube.com/watch?v=dQw4w9WgXcQ\n' | link-enricher -f ndjson
{"url":"https://github.com/nodejs/node","type":"repo","source":"github","title":"nodejs/node","description":"Node.js JavaScript runtime","author":"nodejs","extra":{"stars":123485,"language":"JavaScript", ...}, ...}
{"url":"https://youtube.com/watch?v=dQw4w9WgXcQ","type":"video","source":"oembed","title":"Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)","author":"Rick Astley", ...}
link-enricher: 2 enriched, 0 failed, 1 duplicates, 0 already seen, 0 invalid
```

Each record has `url`, `key` (the dedupe identity), `type` (`reel`, `carousel`, `post`, `video`, `repo` or `site`), `host`, `ok`, `error`, `source` (`html`, `github`, `oembed`, `context` or `none`), and where found `title`, `description`, `siteName`, `author`, `publishedAt`, `lang`, `canonical`, `image`, `favicon` and `excerpt`.

### Plugin example

```js
// tag.mjs
export default async (record) => ({ source: record.host });
```

```sh
link-enricher --plugin tag.mjs links.txt -f ndjson
```

A plugin that throws sets `pluginError` on that record and leaves the rest untouched. Only load plugins you trust; they execute local JavaScript.

## Limits

The address check resolves a hostname before the fetch resolves it again, so a DNS server that answers differently the second time can get past it. Do not run the tool on hostile lists from a host that can reach internal services. It reads server-rendered HTML and public APIs only. Pages that need a login return little; pass the text through `--context` for those.

## Tests

```sh
npm test
```

The suite uses mocked fetches only and needs no network.

## License

MIT
