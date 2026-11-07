import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launchBrowser, capturePage } from '../src/capture.js';
import { detect } from '../src/detect.js';
import { config } from './helpers.js';
import { startFixtures } from '../fixtures/server.js';
test('M3 detects all six visible Paragraphs, nesting, exact prefix and semantic fallback', async () => {
  const b = await launchBrowser(),
    f = await startFixtures({ stagePort: 0, prodPort: 0 });
  try {
    const c = config(f.stage, f.prod);
    const items = await capturePage(b, c, 'prod', c.devices.desktop, f.prod + '/home', (p) =>
      detect(p, c),
    );
    assert.ok(Array.isArray(items), JSON.stringify(items));
    assert.equal(items.filter((i) => !i.type.startsWith('semantic:')).length, 6);
    assert.equal(items.filter((i) => i.type === 'card' && i.parentId).length, 2);
    assert.equal(items.filter((i) => ['hidden', 'fake'].includes(i.type)).length, 0);
    assert.equal(items.filter((i) => i.type.startsWith('semantic:')).length, 3);
  } finally {
    await b.close();
    await f.close();
  }
});
