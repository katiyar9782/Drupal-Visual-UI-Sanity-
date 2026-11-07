import { request as playwrightRequest } from 'playwright';
import { sessionFor } from './session-state.js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { safeUrl, secret } from './safety.js';
const list = (x) => (x == null ? [] : Array.isArray(x) ? x : [x]);
export function mapUrl(value, c) {
  const s = safeUrl(value, c.environments.stage.baseUrl, c.allowHttp);
  let route = c.mapping.overrides[s.pathname + s.search] ?? s.pathname + s.search;
  const u = safeUrl(route, c.environments.prod.baseUrl, c.allowHttp);
  if (c.mapping.trailingSlash === 'remove' && u.pathname !== '/')
    u.pathname = u.pathname.replace(/\/+$/, '');
  if (c.mapping.trailingSlash === 'add' && !u.pathname.endsWith('/')) u.pathname += '/';
  return u.href;
}
export async function fetchXml(url, c, request) {
  if (c.environments.stage.auth.type !== 'browserSession') {
    return fetchXmlRequest(url, c, request);
  }

  // Match verifyAccess's standalone API configuration. Browser-context API
  // clients can send a different User-Agent from the successful verification.
  const session = sessionFor('stage', c.environments.stage.baseUrl);
  const api = await playwrightRequest.newContext({
    storageState: session.storage,
    timeout: 20000,
    ignoreHTTPSErrors: false,
  });
  try {
    const xml = await fetchXmlRequest(url, c, api);
    // Keep refreshed cookies for child sitemaps and subsequent page captures.
    session.storage.cookies = (await api.storageState()).cookies;
    return xml;
  } finally {
    await api.dispose();
  }
}

async function fetchXmlRequest(url, c, request) {
  const env = c.environments.stage;
  let current = safeUrl(url, env.baseUrl, c.allowHttp).href;
  for (let n = 0; n < 6; n++) {
    let status, headers, body;
    if (request) {
      const r = await request.get(current, { maxRedirects: 0, timeout: c.limits.timeoutMs });
      status = r.status();
      headers = r.headers();
      body = () => r.body();
    } else {
      const h = {};
      if (env.auth.type === 'httpBasic')
        h.Authorization =
          'Basic ' +
          Buffer.from(secret(env.auth.usernameEnv) + ':' + secret(env.auth.passwordEnv)).toString(
            'base64',
          );
      const r = await fetch(current, {
        redirect: 'manual',
        headers: h,
        signal: AbortSignal.timeout(c.limits.timeoutMs),
      });
      status = r.status;
      headers = Object.fromEntries(r.headers);
      body = async () => {
        const reader = r.body.getReader();
        let size = 0;
        const chunks = [];
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 2000000) {
            await reader.cancel();
            throw Error('Sitemap too large');
          }
          chunks.push(value);
        }
        return Buffer.concat(chunks);
      };
    }
    if (status >= 300 && status < 400) {
      current = safeUrl(new URL(headers.location, current).href, env.baseUrl, c.allowHttp).href;
      continue;
    }
    if (status !== 200) {
      const failedUrl = new URL(current);
      throw Error(
        `Sitemap HTTP failure: HTTP ${status}; URL: ${failedUrl.origin}${failedUrl.pathname}`,
      );
    }
    if (Number(headers['content-length']) > 2000000) throw Error('Sitemap too large');
    const text = (await body()).toString();
    if (
      text.length > 2000000 ||
      /<!DOCTYPE|<!ENTITY/i.test(text) ||
      XMLValidator.validate(text) !== true
    )
      throw Error('Invalid sitemap XML');
    return text;
  }
  throw Error('Too many sitemap redirects');
}
export async function discover(c, request) {
  const origin = c.environments.stage.baseUrl,
    seen = new Set(),
    pages = new Set(),
    warnings = [];
  function add(raw) {
    try {
      const u = safeUrl(raw, origin, c.allowHttp);
      const path = u.pathname + u.search;
      if (c.mapping.include.length && !c.mapping.include.some((p) => new RegExp(p).test(path)))
        return;
      if (c.mapping.exclude.some((p) => new RegExp(p).test(path))) return;
      if (pages.size < c.limits.maxPages) pages.add(u.href);
    } catch {
      warnings.push('External or invalid sitemap page rejected');
    }
  }
  async function visit(raw, depth) {
    const u = safeUrl(raw, origin, c.allowHttp).href;
    if (seen.has(u)) return;
    if (depth > c.limits.sitemapDepth) throw Error('Sitemap depth exceeded');
    if (seen.size >= c.limits.maxSitemaps) throw Error('Sitemap count exceeded');
    seen.add(u);
    const doc = new XMLParser({ removeNSPrefix: true, parseTagValue: false }).parse(
      await fetchXml(u, c, request),
    );
    if (doc.urlset) {
      for (const x of list(doc.urlset.url)) if (typeof x.loc === 'string') add(x.loc);
    }
    if (doc.sitemapindex)
      for (const x of list(doc.sitemapindex.sitemap)) {
        if (typeof x.loc !== 'string') throw Error('Invalid sitemap location');
        await visit(x.loc, depth + 1);
      }
    if (!doc.urlset && !doc.sitemapindex) throw Error('Missing sitemap root');
  }
  if (c.mode === 'single') for (const p of c.paths) add(p);
  else await visit(c.sitemapUrl, 0);
  if (!pages.size) throw Error('No allowed pages discovered');
  return { pages: [...pages].map((stage) => ({ stage, prod: mapUrl(stage, c) })), warnings };
}
