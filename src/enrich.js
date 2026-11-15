// Turn a URL into a record: normalised, classified, and filled in from the page.

import { classifyUrl } from './classify.js';
import { dedupe, dedupeKey, normalizeUrl } from './normalize.js';
import { fetchPage } from './fetch.js';
import { parseHtml } from './parse.js';
import { runProvider } from './providers.js';

const THIN_EXCERPT = 80;

/**
 * Enrich one URL. Never throws: failures come back as `ok: false` with `error`.
 * @param {string} input
 * @param {object} [options]
 * @param {boolean} [options.network=true] false classifies and normalises only
 * @param {Record<string,string>} [options.context] text to use when a page is empty or blocked, keyed by URL or dedupe key
 * @param {boolean} [options.providers=true] use the GitHub API and oEmbed where they apply
 * @param {string} [options.githubToken] raises the GitHub API rate limit
 * @param {object} [options.fetch] passed to fetchPage (fetchImpl, timeoutMs, maxBytes, assertUrl...)
 */
export async function enrichUrl(input, options = {}) {
  const { network = true, context = {}, fetch: fetchOptions = {} } = options;
  const url = normalizeUrl(input);
  const key = url && dedupeKey(url);
  if (!url || !key) {
    return { input, ok: false, error: 'not a valid http(s) URL', fetchedAt: new Date().toISOString() };
  }
  const record = {
    input, url, key,
    type: classifyUrl(url),
    host: new URL(url).hostname,
    ok: true,
    source: 'none',
    fetchedAt: new Date().toISOString(),
  };
  const fallback = context[url] ?? context[key] ?? context[input];

  let provided = false;
  if (network && options.providers !== false) {
    const hit = await runProvider(url, { fetch: fetchOptions, githubToken: options.githubToken });
    if (hit) {
      Object.assign(record, hit.fields);
      record.source = hit.name;
      provided = true;
    }
  }

  if (network && !provided) {
    try {
      const page = await fetchPage(url, fetchOptions);
      record.status = page.status;
      record.finalUrl = page.finalUrl;
      if (page.status >= 400) {
        record.ok = false;
        record.error = `HTTP ${page.status}`;
      } else if (page.body && /html|xml/i.test(page.contentType || 'html')) {
        Object.assign(record, definedOnly(parseHtml(page.body, page.finalUrl)));
        record.source = 'html';
        if (page.truncated) record.truncated = true;
      } else {
        record.contentType = page.contentType;
      }
    } catch (error) {
      record.ok = false;
      record.error = error instanceof Error ? error.message : String(error);
    }
  }

  if (fallback && (!record.excerpt || record.excerpt.length < THIN_EXCERPT)) {
    record.excerpt = String(fallback).slice(0, 1500);
    record.source = record.source === 'none' ? 'context' : `${record.source}+context`;
    if (record.error) { // supplied text rescues a blocked fetch
      record.fetchError = record.error;
      delete record.error;
      record.ok = true;
    }
  }
  if (!record.title && record.excerpt) record.title = record.excerpt.split(/(?<=[.!?])\s/)[0].slice(0, 120);
  return record;
}

function definedOnly(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== ''));
}

/**
 * Dedupe a list of URLs and enrich the unique ones with bounded concurrency.
 * Output order matches input order.
 * @returns {Promise<{records: object[], duplicates: object[], invalid: string[]}>}
 */
export async function enrichMany(inputs, options = {}) {
  const { concurrency = 4, onRecord, plugin } = options;
  const { unique, duplicates, invalid } = dedupe(inputs);
  const records = new Array(unique.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= unique.length) return;
      records[i] = await enrichUrl(unique[i].input, options);
      if (plugin && records[i].ok) await applyPlugin(plugin, records[i]);
      onRecord?.(records[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, unique.length)) }, worker));
  return { records, duplicates, invalid };
}

/**
 * Run a user step on a finished record, for example an LLM call that writes a
 * takeaway. Whatever the plugin returns is stored under `record.plugin`; a
 * thrown error is stored in `record.pluginError` and never fails the record.
 */
async function applyPlugin(plugin, record) {
  try {
    const result = await plugin({ ...record });
    if (result !== undefined) record.plugin = result;
  } catch (error) {
    record.pluginError = error instanceof Error ? error.message : String(error);
  }
}
