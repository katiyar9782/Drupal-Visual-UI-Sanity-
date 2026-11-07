import sharp from 'sharp';
import pixelmatch from 'pixelmatch';
export async function compareImages(reference, candidate, output, policy, maxPixels = 16000000) {
  const a = await sharp(reference).metadata(),
    b = await sharp(candidate).metadata();
  const width = Math.max(a.width, b.width),
    height = Math.max(a.height, b.height);
  if (width * height > maxPixels) throw Error('IMAGE_LIMIT');
  const normalize = async (file, m) =>
    sharp(file)
      .ensureAlpha()
      .extend({
        top: 0,
        left: 0,
        bottom: height - m.height,
        right: width - m.width,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .raw()
      .toBuffer();
  const [ra, rb] = await Promise.all([normalize(reference, a), normalize(candidate, b)]);
  const diff = Buffer.alloc(width * height * 4);
  const count = pixelmatch(ra, rb, diff, width, height, {
    threshold: policy.pixelThreshold,
    includeAA: false,
    diffColor: [235, 32, 80],
  });
  await sharp(diff, { raw: { width, height, channels: 4 } })
    .png()
    .toFile(output);
  return {
    diffPixels: count,
    diffRatio: count / (width * height),
    width,
    height,
    dimensionChanged: a.width !== b.width || a.height !== b.height,
  };
}
export const comparatorRegistry = new Map();
export function registerComparator(name, fn) {
  if (comparatorRegistry.has(name)) throw Error('Duplicate comparator');
  comparatorRegistry.set(name, fn);
}
registerComparator('geometry', (r, c, p) => {
  const keys = ['width', 'height'];
  const delta = Object.fromEntries(keys.map((k) => [k, c.bbox[k] - r.bbox[k]]));
  delta.relativeX = c.relative.x - r.relative.x;
  delta.relativeY = c.relative.y - r.relative.y;
  return Object.values(delta).some((x) => Math.abs(x) > p.geometryTolerancePx)
    ? {
        severity: 'high',
        expected: r.bbox,
        actual: c.bbox,
        explanation: 'Component dimensions or parent-relative position changed.',
        details: delta,
      }
    : null;
});
registerComparator('styles', (r, c, p) => {
  const keys = p.styles.filter((k) => r.styles[k] !== c.styles[k]);
  return keys.length
    ? {
        severity: 'medium',
        expected: Object.fromEntries(keys.map((k) => [k, r.styles[k]])),
        actual: Object.fromEntries(keys.map((k) => [k, c.styles[k]])),
        explanation: 'Selected computed CSS properties changed.',
      }
    : null;
});
registerComparator('content', (r, c) =>
  r.textSignature !== c.textSignature
    ? {
        severity: 'low',
        expected: r.textSignature,
        actual: c.textSignature,
        explanation: 'Normalized visible text changed.',
      }
    : null,
);
registerComparator('assets', (r, c) =>
  JSON.stringify(r.assetRefs) !== JSON.stringify(c.assetRefs)
    ? {
        severity: c.assetRefs.some((x) => x.broken) ? 'high' : 'medium',
        expected: r.assetRefs,
        actual: c.assetRefs,
        explanation:
          'Asset paths, natural dimensions or image availability changed; host/query differences are normalized.',
      }
    : null,
);
export async function comparePair(r, c, match, config, diffPath) {
  const findings = [];
  for (const [category, fn] of comparatorRegistry) {
    const f = await fn(r, c, config.comparison);
    if (f) findings.push({ category, ...f, confidence: match.confidence });
  }
  const visual = await compareImages(
    r.screenshotPath,
    c.screenshotPath,
    diffPath,
    config.comparison,
    config.capture.maxImagePixels,
  );
  if (visual.diffRatio > config.comparison.maxDiffPixelRatio)
    findings.push({
      category: 'visual',
      severity: 'high',
      confidence: match.confidence,
      expected: 0,
      actual: visual.diffRatio,
      explanation: 'Pixels differ beyond configured ratio; pink pixels mark changed areas.',
      details: visual,
    });
  return { findings, visual, diffPath };
}
