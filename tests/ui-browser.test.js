import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { launchBrowser } from '../src/capture.js';
import { startUi } from '../src/ui-server.js';
test(
  'UI real browser: fill sample, fetch pages, compare, open report',
  { timeout: 120000 },
  async () => {
    const b = await launchBrowser();
    const dir = await fs.mkdtemp(path.resolve('.ui-browser-'));
    const ui = await startUi({ port: 0, outputDir: dir });
    try {
      const page = await b.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(ui.address);
      await page.getByRole('button', { name: 'Try local sample', exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('[name=sitemapUrl]').value.includes('127.0.0.1'),
      );
      await page.locator('[name=maxPages]').fill('1');
      await page.getByRole('button', { name: 'Fetch pages', exact: true }).click();
      await page.locator('#pages tbody tr').first().waitFor();
      assert.equal(await page.locator('#pages tbody tr').count(), 1);
      await page.getByRole('button', { name: 'Compare websites →', exact: true }).click();
      await page.locator('#reportLinks a').first().waitFor({ timeout: 90000 });
      assert.equal(await page.locator('#state').textContent(), 'regressions');
      const [report] = await Promise.all([
        page.waitForEvent('popup'),
        page.locator('#reportLinks a').first().click(),
      ]);
      await report.waitForLoadState();
      assert.ok((await report.locator('article').count()) > 0);
      assert.deepEqual(errors, []);
    } finally {
      await b.close();
      await ui.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  },
);
