import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BrowserAuth } from '../src/browser-auth.js';
import { launchBrowser } from '../src/capture.js';
import { setSessions } from '../src/session-state.js';
import { config } from './helpers.js';
import { startSsoFixture } from '../fixtures/sso-server.js';
import { run } from '../src/runner.js';
test(
  'SSO real browser: redirect login, verify, reuse for discovery/capture, disconnect',
  { timeout: 90000 },
  async () => {
    const browser = await launchBrowser();
    const fixture = await startSsoFixture();
    const dir = await fs.mkdtemp(path.resolve('.sso-browser-'));
    // Headless automation of the local test login; production defaults to a visible browser.
    const auth = new BrowserAuth({ launch: async () => browser });
    try {
      await auth.start('stage', {
        origin: fixture.stage,
        url: fixture.stage + '/sitemap.xml',
        allowHttp: true,
        extraOrigins: [fixture.identity],
      });
      const page = auth.entries.get('stage').page;
      await page.getByRole('button', { name: 'Approve fixture sign-in' }).click();
      await page.waitForURL(fixture.stage + '/sitemap.xml');
      await auth.complete('stage');
      setSessions({ stage: auth.get('stage', fixture.stage) });
      const c = config(fixture.stage, fixture.prod);
      c.environments.stage.auth = { type: 'browserSession' };
      c.outputDir = dir;
      const result = await run(c);
      assert.equal(result.status, 'clean');
      assert.equal(result.pages.length, 2);
      assert.ok(!JSON.stringify(result).includes('sso=fixture'));
      await auth.disconnect('stage');
      assert.throws(() => auth.get('stage', fixture.stage));
    } finally {
      setSessions();
      await auth.close();
      await browser.close();
      await fixture.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
