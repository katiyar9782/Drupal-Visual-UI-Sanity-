import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config.js';
import { discover, mapUrl } from '../src/sitemap.js';
import { startFixtures } from '../fixtures/server.js';
import { config } from './helpers.js';

test('M0 rejects unsafe and malformed config', () => {
  assert.throws(() => validateConfig({}));
  const c = config();
  c.allowHttp = false;
  assert.throws(() => validateConfig(c));
});
test('M1 maps URL paths/query safely and applies overrides/slashes', () => {
  const c = config();
  assert.equal(mapUrl('/a?x=1', c), c.environments.prod.baseUrl + '/a?x=1');
  c.mapping.overrides['/a'] = '/b';
  assert.equal(mapUrl('/a', c), c.environments.prod.baseUrl + '/b');
  c.mapping.overrides['/a'] = '//evil.invalid';
  assert.throws(() => mapUrl('/a', c));
  assert.throws(() => mapUrl('https://evil.invalid/', c));
  c.mapping.trailingSlash = 'add';
  assert.ok(mapUrl('/q', c).endsWith('/q/'));
});
test('M1 recursive sitemap, deduplication, limits, rejection, malformed XML and auth', async () => {
  const f = await startFixtures({ stagePort: 0, prodPort: 0 });
  try {
    const c = config(f.stage, f.prod);
    let d = await discover(c);
    assert.equal(d.pages.length, 5);
    assert.equal(d.warnings.length, 1);
    c.sitemapUrl = f.stage + '/redirect.xml';
    assert.equal((await discover(c)).pages.length, 5);
    c.sitemapUrl = f.stage + '/external.xml';
    await assert.rejects(discover(c));
    c.sitemapUrl = f.stage + '/bad.xml';
    await assert.rejects(discover(c));
    c.sitemapUrl = f.stage + '/basic.xml';
    await assert.rejects(discover(c));
    process.env.FIX_USER = 'tester';
    process.env.FIX_PASS = 'fixture-pass';
    c.environments.stage.auth = {
      type: 'httpBasic',
      usernameEnv: 'FIX_USER',
      passwordEnv: 'FIX_PASS',
    };
    assert.equal((await discover(c)).pages.length, 5);
    process.env.FIX_PASS = 'wrong';
    await assert.rejects(discover(c));
    delete process.env.FIX_USER;
    delete process.env.FIX_PASS;
    c.mode = 'single';
    c.paths = ['/home', '/home', '/about?x=1'];
    assert.equal((await discover(c)).pages.length, 2);
  } finally {
    await f.close();
  }
});
