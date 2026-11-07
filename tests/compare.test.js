import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compareImages, comparatorRegistry } from '../src/compare.js';
test('M5 pixel comparison preserves size differences and detects color mutation', async () => {
  const dir = await fs.mkdtemp(path.resolve('.compare-'));
  try {
    const a = path.join(dir, 'a.png'),
      b = path.join(dir, 'b.png'),
      d = path.join(dir, 'd.png');
    await sharp({ create: { width: 50, height: 50, channels: 4, background: 'white' } })
      .png()
      .toFile(a);
    await sharp({ create: { width: 60, height: 50, channels: 4, background: 'red' } })
      .png()
      .toFile(b);
    const p = { pixelThreshold: 0.1 };
    assert.equal((await compareImages(a, a, d, p)).diffRatio, 0);
    const r = await compareImages(a, b, d, p);
    assert.equal(r.dimensionChanged, true);
    assert.ok(r.diffRatio > 0.9);
    await assert.rejects(compareImages(a, b, d, p, 100));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
test('M5 CSS, content, geometry, broken asset channels remain independent', () => {
  const a = {
      bbox: { width: 100, height: 100 },
      relative: { x: 0, y: 0 },
      styles: { padding: '10px' },
      textSignature: 'Hello',
      assetRefs: [],
    },
    b = {
      ...a,
      bbox: { width: 100, height: 120 },
      styles: { padding: '20px' },
      textSignature: 'Changed',
      assetRefs: [{ broken: true }],
    };
  for (const fn of comparatorRegistry.values())
    assert.ok(fn(a, b, { geometryTolerancePx: 2, styles: ['padding'] }));
});
