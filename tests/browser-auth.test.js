import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { BrowserAuth, scopeState, loginOrigins, verifyAccess } from '../src/browser-auth.js';
import { setSessions, sessionFor } from '../src/session-state.js';
import { createSession } from '../src/capture.js';
import { startFixtures } from '../fixtures/server.js';
import { config } from './helpers.js';
const origin = 'https://stage.example.com';
function fakeBrowser() {
  const b = new EventEmitter();
  const page = {
    current: origin,
    url() {
      return this.current;
    },
    async goto(url) {
      this.current = url;
    },
    async evaluate() {
      return { sessionKey: 'sensitive-session-value' };
    },
  };
  const ctx = {
    async route(pattern, fn) {
      this.guard = fn;
    },
    async newPage() {
      return page;
    },
    pages() {
      return [page];
    },
    async storageState() {
      return {
        cookies: [
          { name: 'stage-session', value: 'private-cookie', domain: 'stage.example.com' },
          { name: 'idp', value: 'microsoft-secret', domain: 'login.microsoftonline.com' },
        ],
        origins: [
          { origin, localStorage: [{ name: 'token', value: 'private-token' }] },
          { origin: 'https://login.microsoftonline.com', localStorage: [] },
        ],
      };
    },
  };
  b.newContext = async () => ctx;
  b.close = async () => {
    b.emit('disconnected');
  };
  return { b, ctx, page };
}
test('SSO scope keeps target state and excludes Microsoft tokens; exact origins only', () => {
  const state = scopeState(
    {
      cookies: [
        { domain: '.example.com', value: 'a' },
        { domain: 'login.microsoftonline.com', value: 'secret' },
        { domain: 'evil-example.com', value: 'b' },
      ],
      origins: [{ origin }, { origin: 'https://login.microsoftonline.com' }],
    },
    origin,
  );
  assert.equal(state.cookies.length, 1);
  assert.equal(state.origins.length, 1);
  assert.ok(!JSON.stringify(state).includes('secret'));
  assert.ok(loginOrigins(origin).has('https://login.microsoftonline.com'));
  assert.throws(() => loginOrigins(origin, ['https://sso.example.com/path']));
  assert.throws(() => loginOrigins(origin, ['http://sso.example.com']));
});
test('SSO lifecycle verifies access, enforces origin/expiry, disconnects and never exposes state in status', async () => {
  let now = 0;
  const f = fakeBrowser();
  let calls = 0;
  const auth = new BrowserAuth({
    launch: async () => f.b,
    verify: async (info, state) => {
      calls++;
      assert.ok(!JSON.stringify(state).includes('microsoft-secret'));
    },
    clock: () => now,
    ttlMs: 100,
  });
  try {
    await auth.start('stage', { origin, url: origin + '/sitemap.xml' });
    assert.equal(auth.status().stage.state, 'signing-in');
    assert.throws(() => auth.get('stage', origin));
    f.page.current = 'https://login.microsoftonline.com/login';
    await assert.rejects(auth.complete('stage'), /Finish Microsoft/);
    f.page.current = origin + '/sitemap.xml';
    await auth.complete('stage');
    assert.equal(calls, 1);
    assert.equal(auth.get('stage', origin).storage.cookies.length, 1);
    assert.equal(auth.status().stage.state, 'connected');
    assert.ok(!JSON.stringify(auth.status()).includes('private'));
    assert.ok(!JSON.stringify(auth.status()).includes('sensitive'));
    assert.throws(() => auth.get('prod', origin));
    assert.throws(() => auth.get('stage', 'https://other.example.com'));
    now = 101;
    assert.throws(() => auth.get('stage', origin));
    assert.equal(auth.status().stage.state, 'expired');
    await auth.disconnect('stage');
    assert.deepEqual(auth.status(), {});
  } finally {
    await auth.close();
  }
});
test('SSO guards navigation, keeps failed verification unconnected, cleans launch errors', async () => {
  const f = fakeBrowser();
  const auth = new BrowserAuth({
    launch: async () => f.b,
    verify: async () => {
      throw Error('not logged in');
    },
  });
  try {
    await auth.start('stage', { origin, url: origin + '/sitemap.xml' });
    let aborted = false;
    await f.ctx.guard({
      request: () => ({
        url: () => 'https://untrusted.example/path?secret=1',
        isNavigationRequest: () => true,
      }),
      abort: () => {
        aborted = true;
      },
      continue: () => {},
    });
    assert.ok(aborted);
    assert.equal(auth.status().stage.blockedOrigin, 'https://untrusted.example');
    await assert.rejects(auth.complete('stage'), /Could not verify/);
    assert.throws(() => auth.get('stage', origin));
    await f.b.close();
    assert.equal(auth.status().stage.state, 'closed');
  } finally {
    await auth.close();
  }
  const broken = new BrowserAuth({
    launch: async () => {
      throw Error('secret native error');
    },
  });
  await assert.rejects(broken.start('stage', { origin, url: origin }), /could not open/);
  assert.ok(!JSON.stringify(broken.status()).includes('secret native'));
  await broken.close();
});
test('SSO access verification uses cookie-authenticated local sitemap and rejects unauthenticated/redirect access', async () => {
  const f = await startFixtures({ stagePort: 0, prodPort: 0 });
  try {
    const info = { origin: f.stage, url: f.stage + '/private.xml', kind: 'stage', allowHttp: true };
    const cookie = {
      name: 'session',
      value: 'stage',
      domain: '127.0.0.1',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: false,
      sameSite: 'Lax',
    };
    await verifyAccess(info, { cookies: [cookie], origins: [] });
    await assert.rejects(verifyAccess(info, { cookies: [], origins: [] }));
    await assert.rejects(
      verifyAccess({ ...info, url: f.stage + '/external.xml' }, { cookies: [cookie], origins: [] }),
    );
  } finally {
    await f.close();
  }
});
test('SSO runtime session reaches capture context without entering config; navigation stays restricted', async () => {
  const c = config();
  c.environments.stage.auth = { type: 'browserSession' };
  const saved = {
    origin: c.environments.stage.baseUrl,
    storage: { cookies: [], origins: [] },
    sessionStorage: { key: 'private' },
  };
  setSessions({ stage: saved });
  let options, guard, init;
  const ctx = {
    async addInitScript(fn, arg) {
      init = arg;
    },
    setDefaultTimeout() {},
    setDefaultNavigationTimeout() {},
    async route(pattern, fn) {
      guard = fn;
    },
  };
  try {
    await createSession(
      {
        async newContext(o) {
          options = o;
          return ctx;
        },
      },
      c,
      'stage',
      c.devices.desktop,
    );
    assert.deepEqual(options.storageState, saved.storage);
    assert.equal(init.values.key, 'private');
    assert.ok(!JSON.stringify(c).includes('private'));
    let blocked = false;
    await guard({
      request: () => ({
        url: () => 'https://login.microsoftonline.com',
        isNavigationRequest: () => true,
        method: () => 'GET',
      }),
      abort: () => {
        blocked = true;
      },
      continue: () => {},
    });
    assert.ok(blocked);
    assert.equal(ctx.authRedirect, true);
    assert.throws(() => sessionFor('prod', saved.origin));
  } finally {
    setSessions();
  }
});
