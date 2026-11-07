import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFixtures } from '../fixtures/server.js';
import { config } from './helpers.js';
import { run } from '../src/runner.js';
import { launchBrowser, createSession } from '../src/capture.js';
import { discover } from '../src/sitemap.js';
test(
  'M7 five clean repeat runs, mutation categories and offline report',
  { timeout: 240000 },
  async () => {
    const browser = await launchBrowser();
    await browser.close();
    const output = await fs.mkdtemp(path.resolve('.integration-'));
    let f = await startFixtures({ stagePort: 0, prodPort: 0, mutations: false });
    try {
      let c = config(f.stage, f.prod);
      c.outputDir = output;
      c.limits.maxPages = 2;
      for (let i = 0; i < 5; i++) {
        const r = await run(c);
        assert.equal(r.status, 'clean', JSON.stringify(r.summary));
        assert.equal(r.findings.length, 0);
        assert.equal(r.pages.length, 4);
      }
      await f.close();
      f = await startFixtures({ stagePort: 0, prodPort: 0, mutations: true });
      c = config(f.stage, f.prod);
      c.outputDir = output;
      const r = await run(c);
      assert.equal(r.exitCode, 1);
      for (const category of ['visual', 'geometry', 'styles', 'assets', 'added', 'removed'])
        assert.ok(
          r.findings.some((f) => f.category === category),
          category,
        );
      const b = await launchBrowser();
      try {
        const ctx = await b.newContext({ offline: true });
        const p = await ctx.newPage();
        await p.goto(pathToFileURL(r.reportPath).href);
        assert.ok((await p.locator('article').count()) > 0);
        await p.locator('#severity').selectOption('high');
        assert.equal(await p.locator('article').count(), r.summary.high);
        const images = p.locator('img');
        for (let i = 0; i < (await images.count()); i++) {
          await images.nth(i).scrollIntoViewIfNeeded();
          await images.nth(i).evaluate((img) => img.decode());
        }
        await ctx.close();
      } finally {
        await b.close();
      }
    } finally {
      await f.close();
      await fs.rm(output, { recursive: true, force: true });
    }
  },
);
test('M7 authenticated sitemap, bad form credentials, storage state and read-only guard', async () => {
  const b = await launchBrowser(),
    f = await startFixtures({ stagePort: 0, prodPort: 0 });
  const dir = await fs.mkdtemp(path.resolve('.auth-test-'));
  try {
    const c = config(f.stage, f.prod);
    process.env.FIX_USER = 'tester';
    process.env.FIX_PASS = 'fixture-pass';
    c.environments.stage.auth = {
      type: 'form',
      loginPath: '/login',
      usernameSelector: '[name=user]',
      passwordSelector: '[name=pass]',
      submitSelector: 'button',
      successSelector: '#logged-in',
      usernameEnv: 'FIX_USER',
      passwordEnv: 'FIX_PASS',
    };
    let ctx = await createSession(b, c, 'stage', c.devices.desktop);
    c.sitemapUrl = f.stage + '/private.xml';
    assert.equal((await discover(c, ctx.request)).pages.length, 5);
    process.env.FIX_STATE = path.join(dir, 'state.json');
    await ctx.storageState({ path: process.env.FIX_STATE });
    await ctx.close();
    c.environments.stage.auth = { type: 'storageState', pathEnv: 'FIX_STATE' };
    ctx = await createSession(b, c, 'stage', c.devices.desktop);
    assert.equal((await ctx.cookies())[0].value, 'stage');
    const p = await ctx.newPage();
    await p.goto(f.stage + '/private');
    const blocked = await p.evaluate(async () => {
      try {
        await fetch('/login', { method: 'POST', body: 'user=tester&pass=fixture-pass' });
        return false;
      } catch {
        return true;
      }
    });
    assert.ok(blocked);
    await assert.rejects(p.goto('https://example.invalid'));
    await ctx.close();
    c.environments.stage.auth = {
      type: 'form',
      loginPath: '/login',
      usernameSelector: '[name=user]',
      passwordSelector: '[name=pass]',
      submitSelector: 'button',
      successSelector: '#logged-in',
      usernameEnv: 'FIX_USER',
      passwordEnv: 'FIX_PASS',
    };
    c.limits.timeoutMs = 300;
    process.env.FIX_PASS = 'wrong';
    await assert.rejects(createSession(b, c, 'stage', c.devices.desktop));
  } finally {
    delete process.env.FIX_USER;
    delete process.env.FIX_PASS;
    delete process.env.FIX_STATE;
    await b.close();
    await f.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
