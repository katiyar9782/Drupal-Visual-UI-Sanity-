import { setSessions } from './session-state.js';
import { verifyAccess } from './browser-auth.js';
import { validateConfig } from './config.js';
import { discover } from './sitemap.js';
import { launchBrowser, createSession } from './capture.js';
import { run } from './runner.js';
import { redact, publicUrl } from './safety.js';
process.once('message', async ({ action, config, sessions = {} }) => {
  let browser, context;
  try {
    const c = validateConfig(config);
    setSessions(sessions);
    for (const [kind, session] of Object.entries(sessions)) {
      try {
        await verifyAccess(
          {
            origin: session.origin,
            url: kind === 'stage' ? c.sitemapUrl : session.origin,
            kind,
            allowHttp: c.allowHttp,
          },
          session.storage,
        );
      } catch {
        process.send({ type: 'auth-required', env: kind });
        throw Error(
          `AUTH: ${kind} session no longer grants access. Sign in again, or check your connection and access policy.`,
        );
      }
    }
    if (action === 'discover') {
      if (['form', 'storageState', 'browserSession'].includes(c.environments.stage.auth.type)) {
        browser = await launchBrowser();
        context = await createSession(browser, c, 'stage', Object.values(c.devices)[0]);
      }
      const d = await discover(c, context?.request);
      process.send({
        type: 'done',
        result: {
          ...d,
          pages: d.pages.map((p) => ({ stage: publicUrl(p.stage), prod: publicUrl(p.prod) })),
        },
      });
    } else {
      const r = await run(c, (event) => process.send({ type: 'progress', event }));
      const expired = [
        ...new Set(
          r.pages
            .filter((p) => Object.values(p.capture ?? {}).includes('AUTH_REQUIRED'))
            .flatMap((p) =>
              Object.entries(p.capture)
                .filter(([, v]) => v === 'AUTH_REQUIRED')
                .map(([k]) => k),
            ),
        ),
      ];
      for (const env of expired) process.send({ type: 'auth-required', env });
      process.send({
        type: 'done',
        result: {
          authRequired: expired,
          runId: r.runId,
          status: r.status,
          summary: r.summary,
          warnings: r.warnings,
          exitCode: r.exitCode,
        },
      });
    }
  } catch (e) {
    const safe =
      /^(AUTH:|CONFIG:|Unsafe URL|Sitemap |Invalid sitemap|Missing sitemap|No allowed pages|Too many sitemap|Missing authentication)/.test(
        e.message,
      );
    process.send({
      type: 'error',
      message: safe
        ? redact(e.message)
        : 'Could not complete the request. Check login details, website access and browser installation.',
    });
  } finally {
    setSessions();
    await context?.close();
    await browser?.close();
    process.disconnect();
  }
});
