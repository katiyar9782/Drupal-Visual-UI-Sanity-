import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startFixtures } from '../fixtures/server.js';
function cli(args, env = {}) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['src/cli.js', ...args], { env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => resolve({ code, out }));
  });
}
test('M7 CLI validates config and writes inconclusive report on unavailable browser', async () => {
  assert.equal((await cli(['--help'])).code, 0);
  assert.equal((await cli(['unknown'])).code, 2);
  const f = await startFixtures({ stagePort: 0, prodPort: 0 });
  const dir = await fs.mkdtemp(path.resolve('.cli-test-'));
  try {
    const file = path.join(dir, 'config.json');
    await fs.writeFile(
      file,
      JSON.stringify({
        schemaVersion: 1,
        project: 'CLI fixture',
        allowHttp: true,
        mode: 'sitemap',
        sitemapUrl: f.stage + '/sitemap.xml',
        environments: { stage: { baseUrl: f.stage }, prod: { baseUrl: f.prod } },
        devices: { desktop: { width: 800, height: 600 } },
        limits: { maxPages: 1 },
        outputDir: path.join(dir, 'runs'),
      }),
    );
    assert.equal((await cli(['validate', '--config', file])).code, 0);
    const d = await cli(['discover', '--config', file]);
    assert.equal(d.code, 0);
    assert.equal(JSON.parse(d.out).pages.length, 1);
    const run = await cli(['run', '--config', file], {
      PLAYWRIGHT_EXECUTABLE_PATH: path.join(dir, 'missing-browser'),
    });
    assert.equal(run.code, 3, run.out);
    const r = JSON.parse(run.out);
    assert.equal(r.status, 'inconclusive');
    assert.ok((await fs.readFile(r.report, 'utf8')).includes('BROWSER_UNAVAILABLE'));
  } finally {
    await f.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
