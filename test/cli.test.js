import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { run } from '../src/cli.js';
import { toCsv } from '../src/format.js';

function sink() {
  let text = '';
  return { write: (s) => { text += s; }, get text() { return text; } };
}
const fakeEnrich = async (urls, options) => ({
  records: urls.map((u) => ({ url: u, ok: !u.includes('bad'), title: `T ${u}`, error: u.includes('bad') ? 'HTTP 500' : undefined, ctx: Object.keys(options.context).length })),
  duplicates: [], invalid: [],
});
async function exec(args, stdinText = '', env = {}) {
  const stdout = sink(), stderr = sink();
  const code = await run(args, { stdin: Readable.from([stdinText]), stdout, stderr, env, enrich: fakeEnrich });
  return { code, out: stdout.text, err: stderr.text };
}

test('reads URLs from stdin and prints JSON', async () => {
  const { code, out } = await exec([], 'see https://a.com/x and https://b.com/y.');
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(out).map((r) => r.url), ['https://a.com/x', 'https://b.com/y']);
});

test('URL arguments and files can be mixed', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'le-'));
  await writeFile(join(dir, 'links.txt'), 'notes: https://c.com/z\n');
  const { out } = await exec(['https://a.com/1', join(dir, 'links.txt')]);
  assert.deepEqual(JSON.parse(out).map((r) => r.url), ['https://a.com/1', 'https://c.com/z']);
});

test('ndjson and csv formats', async () => {
  const nd = await exec(['-f', 'ndjson', 'https://a.com/1', 'https://a.com/2']);
  assert.equal(nd.out.trim().split('\n').length, 2);
  const csv = await exec(['-f', 'csv', 'https://a.com/1']);
  assert.match(csv.out, /^url,type,title/);
  assert.match(csv.out, /https:\/\/a\.com\/1,,T https:\/\/a\.com\/1/);
});

test('csv neutralises spreadsheet formulas and quotes commas', () => {
  const out = toCsv([{ url: 'https://a.com', title: '=HYPERLINK("x")', description: 'a, b' }]);
  assert.match(out, /'=HYPERLINK\(""x""\)/);
  assert.match(out, /"a, b"/);
});

test('--seen skips known URLs and --update-seen records new ones', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'le-'));
  const seen = join(dir, 'seen.txt');
  await writeFile(seen, 'https://www.a.com/1/?utm_source=x\n');
  const { out, err } = await exec(['--seen', seen, '--update-seen', 'https://a.com/1', 'https://a.com/2']);
  assert.deepEqual(JSON.parse(out).map((r) => r.url), ['https://a.com/2']);
  assert.match(err, /1 already seen/);
  assert.match(await readFile(seen, 'utf8'), /https:\/\/a\.com\/2\n$/);
});

test('--context is read and passed through', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'le-'));
  await writeFile(join(dir, 'ctx.json'), '{"https://a.com/1":"caption"}');
  const { out } = await exec(['--context', join(dir, 'ctx.json'), 'https://a.com/1']);
  assert.equal(JSON.parse(out)[0].ctx, 1);
});

test('--fail-on-error sets exit code 1', async () => {
  assert.equal((await exec(['https://a.com/bad'])).code, 0);
  assert.equal((await exec(['--fail-on-error', 'https://a.com/bad'])).code, 1);
});

test('--allow-private lifts the address check for the fetcher only', async () => {
  let seen;
  const stdout = sink();
  await run(['--allow-private', 'https://a.com/1'], { stdin: Readable.from(['']), stdout, stderr: sink(), env: {}, enrich: async (urls, o) => { seen = o.fetch; return { records: [], duplicates: [], invalid: [] }; } });
  assert.equal(typeof seen.assertUrl, 'function');
  let defaults;
  await run(['https://a.com/1'], { stdin: Readable.from(['']), stdout: sink(), stderr: sink(), env: {}, enrich: async (urls, o) => { defaults = o.fetch; return { records: [], duplicates: [], invalid: [] }; } });
  assert.equal(defaults.assertUrl, undefined);
});

test('usage errors exit 2', async () => {
  assert.equal((await exec(['--format', 'xml', 'https://a.com'])).code, 2);
  assert.equal((await exec(['--concurrency', '0', 'https://a.com'])).code, 2);
  assert.equal((await exec(['--update-seen', 'https://a.com'])).code, 2);
  assert.equal((await exec(['--nope'])).code, 2);
  assert.equal((await exec(['/no/such/file.txt'])).code, 2);
  assert.equal((await exec(['--help'])).code, 0);
});
