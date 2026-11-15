import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { enrichMany } from '../src/enrich.js';
import { run } from '../src/cli.js';

const page = () => new Response('<title>T</title>', { status: 200, headers: { 'content-type': 'text/html' } });
const fetchOpts = { fetchImpl: async () => page(), assertUrl: async () => {} };

test('plugin result is stored on ok records and sees a copy of the record', async () => {
  const { records } = await enrichMany(['https://a.com/1'], {
    fetch: fetchOpts,
    plugin: async (r) => { const title = r.title; r.title = 'mutated'; return { shout: title.toUpperCase() }; },
  });
  assert.deepEqual(records[0].plugin, { shout: 'T' });
  assert.equal(records[0].title, 'T');
});

test('a throwing plugin is recorded and does not fail the record', async () => {
  const { records } = await enrichMany(['https://a.com/1'], { fetch: fetchOpts, plugin: async () => { throw new Error('llm down'); } });
  assert.equal(records[0].ok, true);
  assert.equal(records[0].pluginError, 'llm down');
  assert.equal(records[0].plugin, undefined);
});

test('plugin is skipped for failed records', async () => {
  let calls = 0;
  const failing = { fetchImpl: async () => new Response('x', { status: 500, headers: { 'content-type': 'text/html' } }), assertUrl: async () => {} };
  await enrichMany(['https://a.com/1'], { fetch: failing, plugin: async () => { calls++; } });
  assert.equal(calls, 0);
});

test('CLI --plugin loads a module and rejects a bad one', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'le-'));
  await writeFile(join(dir, 'p.mjs'), 'export default async (r) => ({ host: r.host });');
  await writeFile(join(dir, 'bad.mjs'), 'export default 42;');
  let seen;
  const enrich = async (urls, o) => { seen = o.plugin; return { records: [], duplicates: [], invalid: [] }; };
  const io = (e) => ({ stdin: Readable.from(['']), stdout: { write() {} }, stderr: { write() {} }, env: {}, enrich: e });
  assert.equal(await run(['--plugin', join(dir, 'p.mjs'), 'https://a.com'], io(enrich)), 0);
  assert.deepEqual(await seen({ host: 'a.com' }), { host: 'a.com' });
  assert.equal(await run(['--plugin', join(dir, 'bad.mjs'), 'https://a.com'], io(enrich)), 2);
  assert.equal(await run(['--plugin', join(dir, 'missing.mjs'), 'https://a.com'], io(enrich)), 2);
});
