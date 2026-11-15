import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertPublicUrl, isPrivateIp } from '../src/safety.js';

const publicLookup = async () => [{ address: '93.184.216.34' }];

test('isPrivateIp covers loopback, RFC1918, link-local, CGNAT and v6', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('assertPublicUrl accepts a public hostname', async () => {
  await assertPublicUrl('https://example.com/a', { lookup: publicLookup });
});

test('assertPublicUrl rejects private literals, odd schemes and credentials', async () => {
  for (const bad of ['http://127.0.0.1/', 'http://[::1]/', 'http://169.254.169.254/latest/meta-data',
    'file:///etc/passwd', 'ftp://example.com/', 'https://u:p@example.com/', 'http://localhost:3000/',
    'http://printer.local/', 'nope']) {
    await assert.rejects(assertPublicUrl(bad, { lookup: publicLookup }), undefined, bad);
  }
});

test('assertPublicUrl rejects hostnames that resolve to private addresses (DNS rebinding style)', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }, { address: '10.0.0.5' }];
  await assert.rejects(assertPublicUrl('https://evil.example/', { lookup }), /private address/);
});

test('assertPublicUrl rejects unresolvable hosts', async () => {
  await assert.rejects(assertPublicUrl('https://nx.example/', { lookup: async () => { throw new Error('ENOTFOUND'); } }), /did not resolve/);
});

test('isPrivateIp normalises expanded IPv6 and hexadecimal IPv4-mapped addresses', () => {
  for (const ip of ['0:0:0:0:0:0:0:1', '0:0:0:0:0:0:0:0', '::ffff:7f00:1',
    '0:0:0:0:0:ffff:0a00:0001', '::ffff:a9fe:a9fe', '::ffff:c0a8:101',
    '::ffff:6440:1', '::ffff:ac10:1', '::ffff:0:1']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['::ffff:808:808', '0:0:0:0:0:ffff:5db8:d822']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('assertPublicUrl rejects private IPv4-mapped URLs after URL normalisation', async () => {
  for (const url of ['http://[::ffff:127.0.0.1]/', 'http://[::ffff:169.254.169.254]/',
    'http://[::ffff:10.0.0.1]/', 'http://[::ffff:c0a8:101]/']) {
    await assert.rejects(assertPublicUrl(url), /private address/, url);
  }
  await assertPublicUrl('http://[::ffff:8.8.8.8]/');
});

test('assertPublicUrl rejects DNS answers containing expanded mapped private addresses', async () => {
  const lookup = async () => [{ address: '93.184.216.34' }, { address: '0:0:0:0:0:ffff:7f00:1' }];
  await assert.rejects(assertPublicUrl('https://mapped.example/', { lookup }), /private address/);
});
