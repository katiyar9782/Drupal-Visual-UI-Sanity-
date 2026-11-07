import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { compareImages } from '../src/compare.js';
import { reportHtml, imageData } from '../src/report.js';
const dir = path.resolve('examples');
await fs.mkdir(dir, { recursive: true });
const files = ['demo-reference.png', 'demo-candidate.png', 'demo-diff.png'].map((x) =>
  path.join(dir, x),
);
for (let i = 0; i < 2; i++) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="520" height="230"><rect width="520" height="230" fill="#f2f6fa"/><rect x="16" y="16" width="488" height="198" rx="8" fill="white"/><rect x="${i ? 48 : 32}" y="40" width="${i ? 360 : 300}" height="24" fill="#18334f"/><rect x="${i ? 48 : 32}" y="88" width="400" height="12" fill="#9cadbf"/><rect x="${i ? 48 : 32}" y="116" width="280" height="12" fill="#9cadbf"/><rect x="${i ? 48 : 32}" y="154" width="128" height="32" rx="4" fill="#097d7b"/></svg>`;
  await sharp(Buffer.from(svg)).png().toFile(files[i]);
}
const visual = await compareImages(files[0], files[1], files[2], { pixelThreshold: 0.1 });
const r = {
  schemaVersion: 1,
  project: 'Report interaction demo',
  simulated: true,
  createdAt: new Date().toISOString(),
  status: 'simulated',
  summary: { pages: 1, findings: 2, high: 1, inconclusive: 0 },
  browser: 'No browser — synthetic PNG comparator demonstration',
  platform: process.platform,
  policy: { pixelThreshold: 0.1 },
  pages: [],
  warnings: ['Illustrative blocks, not website captures.'],
  evidence: {
    demo: {
      reference: await imageData(files[0]),
      candidate: await imageData(files[1]),
      diff: await imageData(files[2]),
    },
  },
  findings: [
    {
      id: 'f0',
      page: '/illustration',
      device: 'desktop',
      component: 'Hero illustration',
      evidenceId: 'demo',
      category: 'visual',
      severity: 'high',
      confidence: 1,
      expected: 0,
      actual: visual.diffRatio,
      explanation:
        'Synthetic images were compared by the real pixel engine. This does not validate browser capture.',
    },
    {
      id: 'f1',
      page: '/illustration',
      device: 'mobile',
      component: 'Example review',
      category: 'ambiguous',
      severity: 'review',
      confidence: 0.4,
      explanation: 'Simulated ambiguous match to demonstrate filters.',
    },
  ],
};
await fs.writeFile(path.join(dir, 'report-demo.html'), reportHtml(r));
await fs.writeFile(path.join(dir, 'demo-results.json'), JSON.stringify(r, null, 2));
