import { sessionFor } from './session-state.js';
import { chromium } from 'playwright';
import { safeUrl, secret } from './safety.js';
export async function launchBrowser() {
  return chromium.launch({
    headless: false,
    ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
      ? {
          executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
        }
      : {}),
  });
}
export async function createSession(browser, c, envName, device) {
  const env = c.environments[envName],
    auth = env.auth;
  const saved = auth.type === 'browserSession' ? sessionFor(envName, env.baseUrl) : null;
  const context = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.dpr ?? 1,
    isMobile: device.isMobile ?? false,
    hasTouch: device.isMobile ?? false,
    locale: 'en-US',
    timezoneId: 'UTC',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    acceptDownloads: false,
    ...(auth.type === 'httpBasic'
      ? {
          httpCredentials: {
            username: secret(auth.usernameEnv),
            password: secret(auth.passwordEnv),
          },
        }
      : {}),
    ...(saved
      ? { storageState: saved.storage }
      : auth.type === 'storageState'
        ? { storageState: secret(auth.pathEnv) }
        : {}),
  });
  if (saved)
    await context.addInitScript(
      ({ origin, values }) => {
        if (location.origin === origin)
          for (const [key, value] of Object.entries(values)) sessionStorage.setItem(key, value);
      },
      { origin: env.baseUrl, values: saved.sessionStorage ?? {} },
    );
  context.setDefaultTimeout(c.limits.timeoutMs);
  context.setDefaultNavigationTimeout(c.limits.timeoutMs);
  const assetOrigins = new Set([env.baseUrl, ...(env.assetOrigins ?? [])]);
  let loginActive = false;
  await context.route('**/*', async (route) => {
    const req = route.request();
    let u;
    try {
      u = new URL(req.url());
    } catch {
      return route.abort();
    }
    const nav = req.isNavigationRequest();
    const allowed = nav ? u.origin === env.baseUrl : assetOrigins.has(u.origin);
    const methodAllowed =
      ['GET', 'HEAD'].includes(req.method()) ||
      (loginActive && req.method() === 'POST' && u.origin === env.baseUrl);
    if (nav && !allowed) {
      context.blockedNavigation = u.origin + u.pathname;
    }
    if (!allowed || !methodAllowed) return route.abort('blockedbyclient');
    return route.continue();
  });
  try {
    if (auth.type === 'form') {
      loginActive = true;
      const p = await context.newPage();
      await p.goto(safeUrl(auth.loginPath, env.baseUrl, c.allowHttp).href);
      await p.locator(auth.usernameSelector).fill(secret(auth.usernameEnv));
      await p.locator(auth.passwordSelector).fill(secret(auth.passwordEnv));
      await p.locator(auth.submitSelector).click();
      await p.locator(auth.successSelector).waitFor();
      safeUrl(p.url(), env.baseUrl, c.allowHttp);
      await p.close();
      loginActive = false;
    }
    return context;
  } catch (e) {
    await context.close();
    throw e;
  }
}
export async function stabilize(page, c) {
  await page.addStyleTag({
    content:
      '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}html{scroll-behavior:auto!important}',
  });
  if (c.capture.readySelector)
    await page.locator(c.capture.readySelector).waitFor({ state: 'visible' });
  // Redaction changes only this disposable browser DOM, never the target source.
  for (const selector of c.capture.redactSelectors)
    await page.locator(selector).evaluateAll((nodes) =>
      nodes.forEach((n) => {
        n.textContent = '[REDACTED]';
        if ('value' in n) n.value = '';
        n.style.visibility = 'hidden';
      }),
    );
  for (const selector of c.capture.masks)
    await page.locator(selector).evaluateAll((nodes) =>
      nodes.forEach((n) => {
        n.style.visibility = 'hidden';
      }),
    );
  await page.locator('input,textarea').evaluateAll((nodes) =>
    nodes.forEach((n) => {
      n.value = '';
      n.style.visibility = 'hidden';
    }),
  );
  await page.evaluate(() => document.querySelectorAll('video,audio').forEach((x) => x.pause()));
  let bottom = false;
  for (let i = 0; i < c.limits.maxScrollSteps; i++) {
    bottom = await page.evaluate(() => {
      window.scrollBy(0, Math.max(200, innerHeight * 0.8));
      return scrollY + innerHeight >= document.documentElement.scrollHeight - 2;
    });
    await page.waitForTimeout(30);
    if (bottom) break;
  }
  if (!bottom) throw Error('SCROLL_LIMIT');
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForFunction(
    () => document.fonts.status === 'loaded' && [...document.images].every((i) => i.complete),
    null,
    { timeout: c.limits.timeoutMs },
  );
  await page.evaluate(() =>
    Promise.all(
      [...document.images].filter((i) => i.naturalWidth).map((i) => i.decode().catch(() => {})),
    ),
  );
}
export async function capturePage(browser, c, envName, device, url, consume) {
  let last;
  for (let attempt = 0; attempt <= c.limits.retries; attempt++) {
    let context;
    let page;
    let httpStatus = null;
    try {
      context = await createSession(browser, c, envName, device);
      page = await context.newPage();
      const expected = safeUrl(url, c.environments[envName].baseUrl, c.allowHttp);
      const response = await page.goto(expected.href, { waitUntil: 'domcontentloaded' });
      httpStatus = response?.status() ?? null;
      const final = safeUrl(page.url(), c.environments[envName].baseUrl, c.allowHttp);
      // if (
      //   c.environments[envName].auth.type === 'browserSession' &&
      //   [401, 403].includes(response?.status())
      // )
      //   throw Error('AUTH_REQUIRED');
      if (!response || response.status() < 200 || response.status() >= 400)
        throw Error('HTTP_STATUS');
      if (final.pathname !== expected.pathname || final.search !== expected.search)
        throw Error('REDIRECT_PATH');
      await stabilize(page, c);
      return await consume(page, { attempts: attempt + 1, httpStatus: response.status() });
    } catch (e) {
      const currentUrl = page ? new URL(page.url()) : null;

      last = {
        status: 'inconclusive',

        code: context?.blockedNavigation
          ? 'BLOCKED_NAVIGATION'
          : [
                'AUTH_REQUIRED',
                'SCROLL_LIMIT',
                'UNSTABLE_LAYOUT',
                'HTTP_STATUS',
                'REDIRECT_PATH',
                'COMPONENT_NOT_READY',
                'COMPONENT_IMAGE_LIMIT',
                'COMPONENT_CHANGED_DURING_CAPTURE',
                'COMPONENT_TREE_CHANGED',
              ].includes(e.message)
            ? e.message
            : 'CAPTURE_FAILED',

        attempts: attempt + 1,
        httpStatus,

        finalUrl: currentUrl ? currentUrl.origin + currentUrl.pathname : null,

        blockedNavigation: context?.blockedNavigation ?? null,
      };
    } finally {
      await context?.close();
    }
  }
  return last;
}
