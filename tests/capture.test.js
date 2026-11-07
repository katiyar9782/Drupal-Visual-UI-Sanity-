import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, capturePage, createSession } from '../src/capture.js';
import { startFixtures } from '../fixtures/server.js';
import { config } from './helpers.js';
test('M2 desktop/mobile capture, repeat geometry, timeout, form session isolation', async () => {
  const b = await launchBrowser(),
    f = await startFixtures({ stagePort: 0, prodPort: 0, mutations: false });
  try {
    const c = config(f.stage, f.prod);
    for (const d of Object.values(c.devices)) {
      const read = (p) => p.locator('main').boundingBox();
      const a = await capturePage(b, c, 'stage', d, f.stage + '/home', read);
      const z = await capturePage(b, c, 'prod', d, f.prod + '/home', read);
      assert.equal(a.width, z.width);
      assert.equal(a.height, z.height);
    }
    c.capture.readySelector = '#never';
    c.limits.timeoutMs = 200;
    c.limits.retries = 0;
    assert.equal(
      (await capturePage(b, c, 'stage', c.devices.desktop, f.stage + '/timeout', () => {})).status,
      'inconclusive',
    );
    delete c.capture.readySelector;
    c.limits.timeoutMs = 5000;
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
    const s = await createSession(b, c, 'stage', c.devices.desktop),
      p = await createSession(b, c, 'prod', c.devices.desktop);
    assert.equal((await s.cookies())[0].value, 'stage');
    assert.equal((await p.cookies()).length, 0);
    await s.close();
    await p.close();
    delete process.env.FIX_USER;
    delete process.env.FIX_PASS;
  } finally {
    await b.close();
    await f.close();
  }
});
