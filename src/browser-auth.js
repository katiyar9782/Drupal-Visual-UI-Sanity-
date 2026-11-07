import { chromium, request } from 'playwright';
import { XMLParser } from 'fast-xml-parser';
import { fetchXml } from './sitemap.js';
export const MICROSOFT_ORIGINS = [
  'https://login.microsoftonline.com',
  'https://login.microsoft.com',
  'https://login.windows.net',
  'https://login.live.com',
];
export function loginOrigins(origin, extra = [], allowHttp = false) {
  const set = new Set([origin, ...MICROSOFT_ORIGINS]);
  for (const value of extra) {
    const u = new URL(value);
    if (
      u.origin !== value ||
      u.username ||
      u.password ||
      !['https:', ...(allowHttp ? ['http:'] : [])].includes(u.protocol)
    )
      throw Error('AUTH: Extra login destinations must be exact HTTPS origins.');
    set.add(u.origin);
  }
  return set;
}
export function scopeState(state, origin) {
  const host = new URL(origin).hostname;
  return {
    cookies: (state.cookies ?? []).filter((c) => {
      const d = c.domain.replace(/^\./, '');
      return host === d || host.endsWith('.' + d);
    }),
    origins: (state.origins ?? []).filter((x) => x.origin === origin),
  };
}
export async function verifyAccess(
  { origin, url, kind, allowHttp = false },
  state,
  apiFactory = request.newContext.bind(request),
) {
  const api = await apiFactory({ storageState: state, timeout: 20000, ignoreHTTPSErrors: false });
  try {
    if (kind === 'stage') {
      const c = {
        environments: { stage: { baseUrl: origin, auth: { type: 'none' } } },
        allowHttp,
        limits: { timeoutMs: 20000 },
      };
      const xml = await fetchXml(url, c, api);
      const doc = new XMLParser({ removeNSPrefix: true }).parse(xml);
      if (!Object.hasOwn(doc, 'urlset') && !Object.hasOwn(doc, 'sitemapindex'))
        throw Error('Not a sitemap');
    } else {
      const res = await api.get(origin, { maxRedirects: 0 });
      if (res.status() < 200 || res.status() >= 300) throw Error('Reference access failed');
    }
  } finally {
    await api.dispose();
  }
}
export class BrowserAuth {
  constructor({
    launch = (opts) => chromium.launch(opts),
    verify = verifyAccess,
    clock = Date.now,
    ttlMs = 3600000,
    loginMs = 600000,
  } = {}) {
    this.entries = new Map();
    this.launch = launch;
    this.verify = verify;
    this.clock = clock;
    this.ttlMs = ttlMs;
    this.loginMs = loginMs;
  }
  status() {
    return Object.fromEntries(
      [...this.entries].map(([key, session]) => {
        if (session.state === 'connected' && this.clock() >= session.expiresAt) {
          session.state = 'expired';
          delete session.storage;
          delete session.sessionStorage;
        }
        return [
          key,
          {
            origin: session.origin,
            state: session.state,
            expiresAt: session.expiresAt ?? null,
            message: session.message ?? '',
            blockedOrigin: session.blockedOrigin ?? null,
          },
        ];
      }),
    );
  }
  async start(kind, { origin, url, allowHttp = false, extraOrigins = [] }) {
    if (!['stage', 'prod'].includes(kind)) throw Error('AUTH: Invalid environment.');
    const u = new URL(url);
    if (
      u.origin !== origin ||
      u.username ||
      u.password ||
      !['https:', ...(allowHttp ? ['http:'] : [])].includes(u.protocol)
    )
      throw Error('AUTH: Invalid sign-in destination.');
    const allowed = loginOrigins(origin, extraOrigins, allowHttp);
    await this.disconnect(kind);
    const session = {
      origin,
      url,
      kind,
      allowHttp,
      state: 'opening',
      message: 'Opening a separate sign-in browser…',
    };
    this.entries.set(kind, session);
    try {
      session.browser = await this.launch({
        headless: false,
        ...(process.env.PLAYWRIGHT_EXECUTABLE_PATH
          ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH }
          : {}),
      });
      if (this.entries.get(kind) !== session) {
        await session.browser.close();
        throw Error('Cancelled');
      }
      session.context = await session.browser.newContext({
        acceptDownloads: false,
        serviceWorkers: 'block',
      });
      await session.context.route('**/*', async (route) => {
        const r = route.request();
        const u = new URL(r.url());
        if (
          u.protocol !== 'https:' &&
          !(allowHttp && u.protocol === 'http:' && allowed.has(u.origin))
        )
          return route.abort();
        if (r.isNavigationRequest() && !allowed.has(u.origin)) {
          session.blockedOrigin = u.origin;
          session.message =
            'Additional sign-in destination blocked. Add its exact origin only if it belongs to your organization’s identity provider, then sign in again.';
          return route.abort();
        }
        return route.continue();
      });
      session.page = await session.context.newPage();
      session.state = 'signing-in';
      session.message =
        'Complete login and MFA in the opened browser. Return here and click Verify sign-in.';
      session.browser.on('disconnected', () => {
        if (session.state === 'signing-in') {
          session.state = 'closed';
          session.message = 'Sign-in browser closed. Start sign-in again.';
          clearTimeout(session.timer);
        }
      });
      session.timer = setTimeout(() => {
        if (['signing-in', 'verifying'].includes(session.state)) {
          session.state = 'expired';
          session.message = 'Sign-in window timed out. Start again.';
          session.browser.close().catch(() => {});
        }
      }, this.loginMs);
      session.timer.unref?.();
      // Do not hold the UI request through the interactive Microsoft login flow.
      session.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {
        if (session.state === 'signing-in' && !session.blockedOrigin)
          session.message =
            'Navigation is waiting or failed. Complete sign-in in the browser, then verify; otherwise disconnect and retry.';
      });
      return this.status()[kind];
    } catch {
      await session.browser?.close().catch(() => {});
      if (this.entries.get(kind) === session) {
        session.state = 'error';
        session.message =
          'Sign-in browser could not open. Install / repair browser (full Chromium) and ensure a graphical desktop is available.';
      }
      throw Error(
        'AUTH: Sign-in browser could not open. Use Install / repair browser and retry on your graphical desktop.',
      );
    }
  }
  async complete(kind) {
    const session = this.entries.get(kind);
    if (!session || session.state !== 'signing-in')
      throw Error('AUTH: Open the sign-in browser first.');
    if (
      !session.context.pages().some((p) => {
        try {
          return new URL(p.url()).origin === session.origin;
        } catch {
          return false;
        }
      })
    )
      throw Error(
        'AUTH: Finish Microsoft login/MFA and return to the Stage or Production website before verifying.',
      );
    session.state = 'verifying';
    try {
      const storage = scopeState(
        await session.context.storageState({ indexedDB: true }),
        session.origin,
      );
      await this.verify(session, storage); // Fresh API client proves cookies work outside the login tab.
      if (this.entries.get(kind) !== session || session.state !== 'verifying')
        throw Error('Cancelled');
      const target = session.context.pages().find((p) => {
        try {
          return new URL(p.url()).origin === session.origin;
        } catch {
          return false;
        }
      });
      const sessionStorage = target
        ? await target.evaluate(() => Object.fromEntries(Object.entries(window.sessionStorage)))
        : {};
      session.storage = storage;
      session.sessionStorage = sessionStorage;
      session.expiresAt = this.clock() + this.ttlMs;
      session.state = 'connected';
      session.message = 'Verified. Session is held only until disconnect, expiry or app shutdown.';
      clearTimeout(session.timer);
      await session.browser.close();
      delete session.browser;
      delete session.context;
      delete session.page;
      return this.status()[kind];
    } catch {
      if (this.entries.get(kind) === session && session.state === 'verifying') {
        session.state = 'signing-in';
        session.message =
          'Verification failed. Finish login and confirm the sitemap is accessible. A cookie-based reusable session is required; Conditional Access may prevent automation.';
      }
      throw Error(
        'AUTH: Could not verify access using the signed-in session. Complete login/MFA and check sitemap access. Session-bound or device-bound policies may require DevOps support.',
      );
    }
  }
  get(kind, origin) {
    this.status();
    const session = this.entries.get(kind);
    if (!session || session.origin !== origin || session.state !== 'connected')
      throw Error(`AUTH: Sign in to ${kind} for this website, then click Verify sign-in.`);
    return {
      origin: session.origin,
      storage: structuredClone(session.storage),
      sessionStorage: structuredClone(session.sessionStorage),
    };
  }
  async disconnect(kind) {
    const session = this.entries.get(kind);
    this.entries.delete(kind);
    if (session) {
      clearTimeout(session.timer);
      delete session.storage;
      delete session.sessionStorage;
      await session.browser?.close().catch(() => {});
    }
  }
  async close() {
    for (const kind of [...this.entries.keys()]) await this.disconnect(kind);
  }
}
