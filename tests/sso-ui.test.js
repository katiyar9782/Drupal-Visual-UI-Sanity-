import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { startUi } from '../src/ui-server.js';
import { BrowserAuth } from '../src/browser-auth.js';
function manager() {
  let data = {};
  return {
    status: () =>
      Object.fromEntries(
        Object.entries(data).map(([k, v]) => [
          k,
          { state: v.state, origin: v.origin, message: 'Test auth adapter' },
        ]),
      ),
    async start(kind, opts) {
      data[kind] = { ...opts, state: 'signing-in' };
      return this.status()[kind];
    },
    async complete(kind) {
      if (!data[kind]) throw Error('AUTH: Start login first');
      data[kind].state = 'connected';
      return this.status()[kind];
    },
    get(kind, origin) {
      if (data[kind]?.state !== 'connected' || data[kind].origin !== origin)
        throw Error('AUTH: Sign in again');
      return { origin, storage: { cookies: [], origins: [] }, sessionStorage: {} };
    },
    async disconnect(kind) {
      delete data[kind];
    },
    async close() {
      data = {};
    },
  };
}
test('SSO UI buttons/API lifecycle with injected auth adapter; no credentials needed for browser auth', async () => {
  const dir = await fs.mkdtemp(path.resolve('.sso-ui-'));
  const auth = manager(),
    ui = await startUi({ port: 0, outputDir: dir, authManager: auth });
  let dom;
  const errors = [],
    vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  try {
    dom = await JSDOM.fromURL(ui.address, {
      resources: 'usable',
      runScripts: 'dangerously',
      virtualConsole: vc,
      beforeParse(w) {
        w.fetch = (url, opts) => fetch(new URL(url, ui.address), opts);
      },
    });
    await new Promise((r) => dom.window.addEventListener('load', r, { once: true }));
    const d = dom.window.document;
    d.querySelector('[name=sitemapUrl]').value = 'https://stage.example.com/sitemap.xml';
    d.querySelector('[name=prodUrl]').value = 'https://prod.example.com';
    const access = d.querySelector('[name=stageAuth]');
    access.value = 'browserSession';
    access.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    assert.equal(d.querySelector('#stageCredentials').hidden, true);
    assert.equal(d.querySelector('#stageBrowserAuth').hidden, false);
    async function clickWait(id, state) {
      d.querySelector(id).click();
      for (let i = 0; i < 40; i++) {
        if (d.querySelector('#stageSessionStatus').textContent.includes(state)) return;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw Error('UI state not reached: ' + state);
    }
    await clickWait('#stageSignIn', 'signing-in');
    await clickWait('#stageVerify', 'connected');
    await clickWait('#stageDisconnect', 'Not signed in');
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    await ui.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('SSO API launch failure returns actionable message, does not expose native exception', async () => {
  const ui = await startUi({
    port: 0,
    authManager: new BrowserAuth({
      launch: async () => {
        throw Error('private-file-name');
      },
    }),
  });
  try {
    const html = await (await fetch(ui.address)).text();
    const token = html.match(/name="ui-token" content="([^"]+)"/)[1];
    const r = await fetch(ui.address + '/api/auth/start', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ui-token': token },
      body: JSON.stringify({
        environment: 'stage',
        stageAuth: 'browserSession',
        sitemapUrl: 'https://stage.example.com/sitemap.xml',
        prodUrl: 'https://prod.example.com',
      }),
    });
    const data = await r.json();
    assert.equal(r.status, 400);
    assert.ok(data.error.includes('Install / repair browser'));
    assert.ok(!data.error.includes('private-file-name'));
  } finally {
    await ui.close();
  }
});
