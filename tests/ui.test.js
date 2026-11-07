import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';
import { startUi, buildConfig } from '../src/ui-server.js';
const base = {
  sitemapUrl: 'https://stage.example.com/sitemap.xml',
  prodUrl: 'https://prod.example.com/',
  stageAuth: 'httpBasic',
  stageUser: 'tester',
  stagePass: 'private-fixture-password',
};
test('UI builds validated config without storing credentials in config', () => {
  const { config, env } = buildConfig(base, 'runs');
  assert.equal(config.environments.prod.baseUrl, 'https://prod.example.com');
  assert.ok(!JSON.stringify(config).includes(base.stagePass));
  assert.equal(env.UI_STAGE_PASS, base.stagePass);
  assert.throws(() => buildConfig({ ...base, desktop: false, mobile: false }, 'runs'));
  assert.throws(() =>
    buildConfig({ ...base, sitemapUrl: 'https://user:pass@stage.example.com/sitemap.xml' }, 'runs'),
  );
  assert.throws(() => buildConfig({ ...base, maxPages: 0 }, 'runs'));
});
async function setup() {
  const dir = await fs.mkdtemp(path.resolve('.ui-test-'));
  const server = await startUi({ port: 0, outputDir: dir });
  const html = await (await fetch(server.address)).text();
  const token = html.match(/name="ui-token" content="([^"]+)"/)[1];
  const call = async (route, body, headers = {}) => {
    const response = await fetch(server.address + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'x-ui-token': token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: await response.json() };
  };
  return {
    ...server,
    call,
    dir,
    cleanup: async () => {
      await server.close();
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}
async function done(api, id) {
  for (let i = 0; i < 100; i++) {
    const j = (await api('/api/jobs')).data.jobs.find((x) => x.id === id);
    if (j.state !== 'running') return j;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error('Task timeout');
}
test('UI HTTP API: local protection, fixtures discovery, report/history and secret exclusion', async () => {
  const s = await setup();
  const old = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  process.env.PLAYWRIGHT_EXECUTABLE_PATH = '/missing-ui-test-browser';
  try {
    assert.equal((await fetch(s.address + '/api/jobs')).status, 403);
    assert.equal((await s.call('/api/demo', {}, { origin: 'https://evil.example' })).status, 403);
    const d = (await s.call('/api/demo', {})).data;
    const input = { ...d, allowHttp: true, maxPages: 5 };
    const id = (await s.call('/api/discover', input)).data.id;
    const result = await done(s.call, id);
    assert.equal(result.state, 'done');
    assert.equal(result.result.pages.length, 5);
    const unsafe = (
      await s.call('/api/discover', {
        ...input,
        sitemapUrl: new URL('/external.xml', input.sitemapUrl).href,
      })
    ).data.id;
    const unsafeResult = await done(s.call, unsafe);
    assert.equal(unsafeResult.state, 'error');
    assert.ok(unsafeResult.message.includes('expected'));
    const basic = {
      ...input,
      sitemapUrl: new URL('/basic.xml', input.sitemapUrl).href,
      stageAuth: 'httpBasic',
      stageUser: 'tester',
      stagePass: 'fixture-pass',
    };
    const bid = (await s.call('/api/discover', basic)).data.id;
    assert.equal((await done(s.call, bid)).result.pages.length, 5);
    assert.ok(!JSON.stringify((await s.call('/api/jobs')).data).includes('fixture-pass'));
    await new Promise((r) => setTimeout(r, 100));
    const rid = (await s.call('/api/run', input)).data.id;
    const run = await done(s.call, rid);
    assert.equal(run.result.status, 'inconclusive');
    const history = (await s.call('/api/history')).data.history;
    assert.equal(history.length, 1);
    const report = await fetch(s.address + '/reports/' + run.result.runId + '/report.html');
    assert.equal(report.status, 200);
    assert.ok(report.headers.get('content-security-policy').includes('sandbox'));
    assert.ok((await report.text()).includes('BROWSER_UNAVAILABLE'));
    const pending = (await s.call('/api/discover', input)).data.id;
    assert.equal((await s.call('/api/cancel', {})).status, 200);
    assert.equal((await done(s.call, pending)).state, 'cancelled');
  } finally {
    if (old === undefined) delete process.env.PLAYWRIGHT_EXECUTABLE_PATH;
    else process.env.PLAYWRIGHT_EXECUTABLE_PATH = old;
    await s.cleanup();
  }
});
test('UI browser DOM: sample button, form fetch and displayed page pairs (jsdom)', async () => {
  const s = await setup();
  let dom;
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  try {
    dom = await JSDOM.fromURL(s.address, {
      resources: 'usable',
      runScripts: 'dangerously',
      virtualConsole: vc,
      beforeParse(w) {
        w.fetch = (url, options) => fetch(new URL(url, s.address), options);
      },
    });
    await new Promise((r) => dom.window.addEventListener('load', r, { once: true }));
    const d = dom.window.document;
    d.querySelector('#demo').click();
    for (let i = 0; i < 50 && !d.querySelector('[name=sitemapUrl]').value; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.ok(d.querySelector('[name=sitemapUrl]').value.includes('127.0.0.1'));
    d.querySelector('#fetch').click();
    for (let i = 0; i < 70 && d.querySelector('#pages').hidden; i++)
      await new Promise((r) => setTimeout(r, 100));
    assert.equal(d.querySelectorAll('#pages tbody tr').length, 5);
    assert.equal(d.querySelector('#notice').hidden, true);
    const stored = dom.window.localStorage.getItem('visual-ui-settings-v1');
    assert.ok(!stored.includes('stagePass'));
    assert.deepEqual(errors, []);
  } finally {
    dom?.window.close();
    await s.cleanup();
  }
});
