#!/usr/bin/env node
import { loadConfig } from './config.js';
const args = process.argv.slice(2),
  command = args.shift() ?? 'help';
function option(name, fallback) {
  const i = args.indexOf('--' + name);
  return i < 0 ? fallback : args[i + 1];
}
try {
  if (command === 'help' || command === '--help')
    console.log(
      `Drupal UI Regression • schema v1\nCommands: validate | discover | run | report\nOptions: --config configs/fixtures.yaml --limit 5\nreport: --run latest [--config configs/fixtures.yaml]\nExit codes: 0 clean, 1 confirmed high/critical findings, 2 config/discovery error, 3 inconclusive capture.`,
    );
  else {
    const c = await loadConfig(option('config', 'configs/fixtures.yaml'));
    if (option('limit')) {
      const n = Number(option('limit'));
      if (!Number.isInteger(n) || n < 1) throw Error('CONFIG: invalid limit');
      c.limits.maxPages = Math.min(n, c.limits.maxPages);
    }
    if (command === 'validate') console.log('Configuration valid (v1).');
    else if (command === 'discover') {
      const { discover } = await import('./sitemap.js');
      let browser, context;
      try {
        if (['form', 'storageState'].includes(c.environments.stage.auth.type)) {
          const { launchBrowser, createSession } = await import('./capture.js');
          browser = await launchBrowser();
          context = await createSession(browser, c, 'stage', Object.values(c.devices)[0]);
        }
        const d = await discover(c, context?.request);
        const { publicUrl } = await import('./safety.js');
        console.log(
          JSON.stringify(
            {
              ...d,
              pages: d.pages.map((p) => ({ stage: publicUrl(p.stage), prod: publicUrl(p.prod) })),
            },
            null,
            2,
          ),
        );
      } finally {
        await context?.close();
        await browser?.close();
      }
    } else if (command === 'run') {
      const { run } = await import('./runner.js');
      const r = await run(c);
      console.log(
        JSON.stringify({ status: r.status, summary: r.summary, report: r.reportPath }, null, 2),
      );
      process.exitCode = r.exitCode;
    } else if (command === 'report') {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      const name = option('run', 'latest');
      const dir =
        name === 'latest'
          ? (await fs.readFile(path.join(c.outputDir, 'latest.txt'), 'utf8')).trim()
          : name;
      console.log(path.resolve(c.outputDir, dir, 'report.html'));
    } else throw Error('CONFIG: unknown command');
  }
} catch (e) {
  console.error(
    e.message.startsWith('CONFIG:') ||
      /^(Unsafe URL|Sitemap |Invalid sitemap|Missing sitemap|No allowed pages|Too many sitemap|Missing authentication)/.test(
        e.message,
      )
      ? e.message
      : 'Operation failed. Check configuration, credentials, allowed origins and connectivity.',
  );
  process.exitCode = 2;
}
