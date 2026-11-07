import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { detect } from '../src/detect.js';
import { config } from './helpers.js';
import { startFixtures } from '../fixtures/server.js';
test('M3 detector DOM logic (synthetic geometry; not browser rendering)', async () => {
  const f = await startFixtures({ stagePort: 0, prodPort: 0 });
  try {
    const dom = new JSDOM(await (await fetch(f.prod + '/home')).text(), {
      url: f.prod + '/home',
      runScripts: 'outside-only',
    });
    const w = dom.window;
    w.HTMLElement.prototype.getBoundingClientRect = function () {
      return { x: 0, y: 0, width: this.classList.contains('hidden') ? 0 : 300, height: 100 };
    };
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
      get() {
        return this.textContent;
      },
    });
    const page = {
      evaluate: async (fn, arg) => w.eval('(' + fn.toString() + ')(' + JSON.stringify(arg) + ')'),
    };
    const items = await detect(page, config(f.stage, f.prod));
    assert.equal(items.filter((x) => !x.type.startsWith('semantic:')).length, 6);
    assert.equal(items.filter((x) => x.type === 'card' && x.parentId).length, 2);
    assert.equal(items.filter((x) => x.type.startsWith('semantic:')).length, 3);
    assert.ok(!items.some((x) => ['fake', 'hidden'].includes(x.type)));
    dom.window.close();
  } finally {
    await f.close();
  }
});
test('M6 standalone report scripts and filters execute in jsdom', async () => {
  const html = await fs.readFile('examples/report-demo.html', 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  const d = dom.window.document;
  assert.equal(d.querySelectorAll('article').length, 2);
  assert.ok(d.querySelector('#subtitle').textContent.includes('SIMULATED'));
  assert.equal(d.querySelectorAll('img').length, 3);
  for (const img of d.querySelectorAll('img'))
    assert.ok(img.src.startsWith('data:image/png;base64,'));
  const select = d.querySelector('#severity');
  select.value = 'high';
  select.dispatchEvent(new dom.window.Event('input'));
  assert.equal(d.querySelectorAll('article').length, 1);
  select.value = '';
  const search = d.querySelector('#search');
  search.value = 'nothing';
  search.dispatchEvent(new dom.window.Event('input'));
  assert.equal(d.querySelectorAll('article').length, 0);
  dom.window.close();
});
