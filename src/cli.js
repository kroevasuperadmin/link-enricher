import { parseArgs } from 'node:util';
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { extractUrls, dedupeKey } from './normalize.js';
import { enrichMany } from './enrich.js';
import { toCsv } from './format.js';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const HELP = `link-enricher: turn URLs into enriched, deduplicated records

Usage: link-enricher [options] [url | file ...]

Arguments that start with http:// or https:// are URLs. Anything else is a text file
(any format) whose URLs are extracted. With no arguments, or "-", URLs are read from stdin.

Options:
  -f, --format <json|ndjson|csv>  output format (default json)
  -o, --out <file>                write to a file instead of stdout
  -c, --concurrency <n>           parallel fetches (default 4)
      --timeout <ms>              per-request timeout (default 15000)
      --no-network                only normalise, dedupe and classify
      --no-providers              skip the GitHub API and oEmbed lookups
      --allow-private             do not block private/loopback addresses (intranet links, fake-IP proxies); unsafe for untrusted lists
      --context <file.json>       {"<url>": "text"} used when a page is empty or blocked
      --seen <file>               skip URLs listed in this file (one per line)
      --update-seen               append newly processed URLs to the --seen file
      --plugin <file.js>          ES module whose default export is async (record) => any; the result is stored in record.plugin
      --fail-on-error             exit 1 if any record failed
  -h, --help                      show this help

Env: GITHUB_TOKEN raises the GitHub API rate limit.`;

const options = {
  format: { type: 'string', short: 'f', default: 'json' },
  out: { type: 'string', short: 'o' },
  concurrency: { type: 'string', short: 'c', default: '4' },
  timeout: { type: 'string', default: '15000' },
  'no-network': { type: 'boolean', default: false },
  'no-providers': { type: 'boolean', default: false },
  'allow-private': { type: 'boolean', default: false },
  context: { type: 'string' },
  plugin: { type: 'string' },
  seen: { type: 'string' },
  'update-seen': { type: 'boolean', default: false },
  'fail-on-error': { type: 'boolean', default: false },
  help: { type: 'boolean', short: 'h', default: false },
};

async function readStdin(stream) {
  let data = '';
  for await (const chunk of stream) data += chunk;
  return data;
}

/**
 * @param {string[]} argv
 * @param {{stdin?: NodeJS.ReadableStream, stdout?: {write(s: string): void}, stderr?: {write(s: string): void}, env?: Record<string,string|undefined>, enrich?: typeof enrichMany}} [io]
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io = {}) {
  const { stdin = process.stdin, stdout = process.stdout, stderr = process.stderr, env = process.env, enrich = enrichMany } = io;
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true });
  } catch (error) {
    stderr.write(`link-enricher: ${error.message}\n`);
    return 2;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    stdout.write(`${HELP}\n`);
    return 0;
  }
  if (!['json', 'ndjson', 'csv'].includes(values.format)) {
    stderr.write(`link-enricher: unknown format "${values.format}"\n`);
    return 2;
  }
  const concurrency = Number(values.concurrency);
  const timeoutMs = Number(values.timeout);
  if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isFinite(timeoutMs) || timeoutMs < 1) {
    stderr.write('link-enricher: --concurrency and --timeout must be positive numbers\n');
    return 2;
  }
  if (values['update-seen'] && !values.seen) {
    stderr.write('link-enricher: --update-seen needs --seen <file>\n');
    return 2;
  }

  let urls = [];
  try {
    const sources = positionals.length ? positionals : ['-'];
    for (const source of sources) {
      if (/^https?:\/\//i.test(source)) urls.push(source);
      else urls.push(...extractUrls(source === '-' ? await readStdin(stdin) : await readFile(source, 'utf8')));
    }
  } catch (error) {
    stderr.write(`link-enricher: ${error.message}\n`);
    return 2;
  }

  let context = {};
  if (values.context) {
    try {
      context = JSON.parse(await readFile(values.context, 'utf8'));
    } catch (error) {
      stderr.write(`link-enricher: cannot read --context: ${error.message}\n`);
      return 2;
    }
  }

  let plugin;
  if (values.plugin) {
    try {
      plugin = (await import(pathToFileURL(resolve(values.plugin)).href)).default;
      if (typeof plugin !== 'function') throw new Error('default export must be a function');
    } catch (error) {
      stderr.write(`link-enricher: cannot load --plugin: ${error.message}\n`);
      return 2;
    }
  }

  let skipped = 0;
  if (values.seen) {
    let previous = '';
    try { previous = await readFile(values.seen, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const seenKeys = new Set(extractUrls(previous).map(dedupeKey).filter(Boolean));
    const before = urls.length;
    urls = urls.filter((u) => !seenKeys.has(dedupeKey(u)));
    skipped = before - urls.length;
  }

  const { records, duplicates, invalid } = await enrich(urls, {
    concurrency,
    network: !values['no-network'],
    providers: !values['no-providers'],
    githubToken: env.GITHUB_TOKEN,
    context,
    plugin,
    fetch: { timeoutMs, ...(values['allow-private'] ? { assertUrl: async () => {} } : {}) },
  });

  let output;
  if (values.format === 'csv') output = toCsv(records);
  else if (values.format === 'ndjson') output = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  else output = `${JSON.stringify(records, null, 2)}\n`;

  if (values.out) {
    await writeFile(values.out, output);
  } else {
    stdout.write(output);
  }
  if (values['update-seen'] && records.length) {
    await appendFile(values.seen, records.filter((r) => r.ok).map((r) => r.url).join('\n') + '\n');
  }

  const failed = records.filter((r) => !r.ok).length;
  stderr.write(`link-enricher: ${records.length} enriched, ${failed} failed, ${duplicates.length} duplicates, ${skipped} already seen, ${invalid.length} invalid\n`);
  return values['fail-on-error'] && failed ? 1 : 0;
}
