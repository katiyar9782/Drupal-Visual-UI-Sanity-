import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { launchBrowser, createSession, capturePage } from './capture.js';
import { discover } from './sitemap.js';
import { detect } from './detect.js';
import { matchComponents } from './match.js';
import { comparePair } from './compare.js';
import { imageData, reportHtml } from './report.js';
import { publicUrl, redact } from './safety.js';
import { waitForComponent, assertComponentUnchanged } from './component-ready.js';
export function outcome(findings, pages) {
  if (
    pages.some((p) => p.status === 'inconclusive') ||
    findings.some((f) => f.category === 'capture')
  )
    return { status: 'inconclusive', exitCode: 3 };
  if (findings.some((f) => ['high', 'critical'].includes(f.severity) && f.confidence >= 0.85))
    return { status: 'regressions', exitCode: 1 };
  if (findings.length) return { status: 'review', exitCode: 0 };
  return { status: 'clean', exitCode: 0 };
}
export async function run(c, onProgress = () => {}) {
  const runId =
      new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex'),
    dir = path.resolve(c.outputDir, runId);
  await fs.mkdir(path.join(dir, 'images'), { recursive: true });
  const result = {
    schemaVersion: 1,
    runId,
    project: c.project,
    createdAt: new Date().toISOString(),
    platform: os.platform() + ' ' + os.arch(),
    browser: 'unavailable',
    policy: c.comparison,
    pages: [],
    findings: [],
    evidence: {},
    snapshots: [],
    warnings: [],
    capabilities: {
      paragraphs: true,
      semanticFallback: c.detection.semanticFallback,
      ai: false,
      interactions: false,
    },
  };
  let browser;
  const finding = (f) => result.findings.push({ id: 'f' + result.findings.length, ...f });
  try {
    let discovery;
    // Public/basic discovery can still produce meaningful page-level errors if Chromium cannot start.
    if (['none', 'httpBasic'].includes(c.environments.stage.auth.type))
      discovery = await discover(c);
    try {
      browser = await launchBrowser();
      result.browser = browser.version();
    } catch {
      result.warnings.push(
        'Chromium could not launch. Install the pinned browser and OS dependencies.',
      );
    }
    if (!discovery && browser) {
      const context = await createSession(browser, c, 'stage', Object.values(c.devices)[0]);
      try {
        discovery = await discover(c, context.request);
      } finally {
        await context.close();
      }
    }
    if (!discovery) {
      result.pages.push({ status: 'inconclusive', code: 'AUTHENTICATED_DISCOVERY_UNAVAILABLE' });
    } else {
      result.warnings.push(...discovery.warnings);
      onProgress({ message: 'Sitemap fetched. Preparing page comparisons.' });
      const jobs = discovery.pages.flatMap((urls, pageIndex) =>
        Object.entries(c.devices).map(([deviceName, device]) => ({
          urls,
          pageIndex,
          deviceName,
          device,
        })),
      );
      let cursor = 0;
      async function work() {
        while (cursor < jobs.length) {
          const { urls, pageIndex, deviceName, device } = jobs[cursor++],
            pageId = `p${pageIndex}-${deviceName}`,
            pageLabel = publicUrl(urls.stage);
          const record = {
            pageId,
            stage: pageLabel,
            prod: publicUrl(urls.prod),
            device: deviceName,
            componentScan: {
              stage: {
                status: 'not_run',
                attempt: null,
                components: [],
              },
              prod: {
                status: 'not_run',
                attempt: null,
                components: [],
              },
            },
            componentMatchingStatus: 'not_run',
            componentMatches: [],
            status: 'captured',
          };
          result.pages.push(record);
          onProgress({
            message: `Comparing page ${pageIndex + 1}: ${deviceName}`,
            page: pageLabel,
            total: jobs.length,
          });
          if (!browser) {
            record.status = 'inconclusive';
            record.code = 'BROWSER_UNAVAILABLE';
            continue;
          }
          const captures = {};
          for (const env of ['prod', 'stage'])
            captures[env] = await capturePage(
              browser,
              c,
              env,
              device,
              urls[env],
              async (page, meta) => {
                // Record discovery separately from screenshots and matching.
                record.componentScan[env] = {
                  status: 'started',
                  attempt: meta.attempts,
                  components: [],
                };

                const components = await detect(page, c, {
                  pageId,
                  env,
                  viewport: deviceName,
                });

                record.componentScan[env] = {
                  status: 'completed',
                  attempt: meta.attempts,
                  components: components.map((component) => ({
                    id: component.id,
                    type: component.type,
                    heading: component.heading,
                    selector: component.selectorHint,
                    parentId: component.parentId,
                    siblingIndex: component.siblingIndex,
                    bbox: component.bbox,
                  })),
                };
                if (!components.length) throw Error('NO_COMPONENTS');
                // const captureSignatures = new Map();
                const originalSelectors = components.map((item) => item.selectorHint);

                for (const item of components) {
                  const signature = await waitForComponent(page, item.selectorHint, c);

                  // Read metadata after scrolling/loading, immediately before the screenshot.
                  const refreshed = await detect(page, c, {
                    pageId,
                    env,
                    viewport: deviceName,
                  });

                  if (
                    JSON.stringify(refreshed.map((node) => node.selectorHint)) !==
                    JSON.stringify(originalSelectors)
                  ) {
                    throw new Error('COMPONENT_TREE_CHANGED');
                  }

                  const current = refreshed.find((node) => node.selectorHint === item.selectorHint);

                  if (!current || current.type !== item.type) {
                    throw new Error('COMPONENT_TREE_CHANGED');
                  }

                  Object.assign(item, current);

                  if (
                    item.bbox.width * item.bbox.height * (device.dpr ?? 1) ** 2 >
                    c.capture.maxImagePixels
                  ) {
                    throw new Error('IMAGE_LIMIT');
                  }

                  item.screenshotPath = path.join(dir, 'images', `${pageId}-${env}-${item.id}.png`);

                  await assertComponentUnchanged(page, item.selectorHint, signature);

                  await page.locator(item.selectorHint).screenshot({
                    path: item.screenshotPath,
                    animations: 'disabled',
                    timeout: c.limits.timeoutMs,
                  });

                  await assertComponentUnchanged(page, item.selectorHint, signature);
                  // captureSignatures.set(item.selectorHint, signature);
                }

                // Update the debug list with the same refreshed metadata used for comparison.
                // Keep the attempt/status fields set by your existing componentScan code.
                if (record.componentScan?.[env]) {
                  record.componentScan[env].components = components.map((item) => ({
                    id: item.id,
                    type: item.type,
                    heading: item.heading,
                    selector: item.selectorHint,
                    parentId: item.parentId,
                    siblingIndex: item.siblingIndex,
                    bbox: item.bbox,
                    assetRefs: item.assetRefs,
                  }));
                }
                return { status: 'captured', components, ...meta };
              },
            );
          for (const environment of ['stage', 'prod']) {
            const scan = record.componentScan[environment];
            const capture = captures[environment];

            scan.captureStatus = capture.status;
            scan.captureError = capture.code ?? null;

            scan.finalCaptureAttempt = capture.attempts ?? null;
            scan.fromEarlierAttempt =
              scan.attempt != null &&
              scan.finalCaptureAttempt != null &&
              scan.attempt !== scan.finalCaptureAttempt;

            if (scan.fromEarlierAttempt) {
              scan.reason =
                'Components were detected in an earlier attempt; the final capture attempt failed before detection.';
            }

            if (scan.status === 'started') {
              scan.status = 'failed';
            }

            if (scan.status === 'not_run') {
              scan.reason = 'Page navigation or stabilization failed before component detection.';
            }
          }
          if (Object.values(captures).some((x) => x.status === 'inconclusive')) {
            record.status = 'inconclusive';
            record.capture = { stage: captures.stage.code, prod: captures.prod.code };
            const captureDetails = (capture) => ({
              status: capture.status,
              code: capture.code ?? null,
              httpStatus: capture.httpStatus ?? null,
              finalUrl: capture.finalUrl ?? null,
              blockedNavigation: capture.blockedNavigation ?? null,
              attempts: capture.attempts,
            });

            record.captureDetails = {
              stage: captureDetails(captures.stage),
              prod: captureDetails(captures.prod),
            };
            continue;
          }
          result.snapshots.push(...captures.prod.components, ...captures.stage.components);
          const matches = matchComponents(captures.prod.components, captures.stage.components);
          record.matches = matches;
          const componentDetails = (component) => {
            if (!component) {
              return null;
            }

            return {
              id: component.id,
              type: component.type,
              heading: component.heading,
              selector: component.selectorHint,
              parentId: component.parentId,
              siblingIndex: component.siblingIndex,
              bbox: component.bbox,
            };
          };

          const prodById = new Map(
            captures.prod.components.map((component) => [component.id, component]),
          );

          const stageById = new Map(
            captures.stage.components.map((component) => [component.id, component]),
          );

          record.componentMatches = matches.map((match) => ({
            matchId: match.id,
            status: match.status,
            confidence: match.confidence,
            reasons: match.reasons,
            evidenceId: `${pageId}-${match.id}`,

            stageComponent: componentDetails(stageById.get(match.candidateId)),

            prodComponent: componentDetails(prodById.get(match.referenceId)),
          }));

          record.componentMatchingStatus = 'completed';
          for (const m of matches) {
            const r = captures.prod.components.find((x) => x.id === m.referenceId),
              s = captures.stage.components.find((x) => x.id === m.candidateId),
              component = (s ?? r).heading || (s ?? r).type,
              evidenceId = pageId + '-' + m.id;
            const common = {
              componentMatchId: m.id,
              pageId,
              page: pageLabel,
              device: deviceName,
              component,
              evidenceId,
              confidence: m.confidence,
            };
            const evidence = {};
            if (r) evidence.reference = await imageData(r.screenshotPath);
            if (s) evidence.candidate = await imageData(s.screenshotPath);
            result.evidence[evidenceId] = evidence;
            if (m.status !== 'matched') {
              finding({
                ...common,
                category: m.status,
                severity: m.status === 'ambiguous' ? 'review' : 'high',
                expected: r?.type ?? null,
                actual: s?.type ?? null,
                explanation: m.reasons.join('; '),
              });
              continue;
            }
            try {
              const pair = await comparePair(
                r,
                s,
                m,
                c,
                path.join(dir, 'images', `${evidenceId}-diff.png`),
              );
              evidence.diff = await imageData(pair.diffPath);
              for (const f of pair.findings) finding({ ...common, ...f });
            } catch {
              record.status = 'inconclusive';
              finding({
                ...common,
                category: 'capture',
                severity: 'review',
                explanation: 'Comparison could not complete; review capture limits.',
              });
            }
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(c.limits.concurrency, jobs.length) }, work));
    }
  } finally {
    await browser?.close();
  }
  Object.assign(result, outcome(result.findings, result.pages));
  result.summary = {
    pages: result.pages.length,
    findings: result.findings.length,
    high: result.findings.filter((f) => f.severity === 'high').length,
    inconclusive: result.pages.filter((p) => p.status === 'inconclusive').length,
  };
  result.snapshots = result.snapshots.map((s) => ({
    ...s,
    screenshotPath: path.relative(dir, s.screenshotPath),
  }));
  await fs.writeFile(path.join(dir, 'results.json'), redact(JSON.stringify(result, null, 2)));
  await fs.writeFile(path.join(dir, 'report.html'), reportHtml(result));
  await fs.writeFile(path.resolve(c.outputDir, 'latest.txt'), runId);
  return { ...result, reportPath: path.join(dir, 'report.html') };
}
