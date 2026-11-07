import { validateConfig } from '../src/config.js';
export function config(stage = 'http://127.0.0.1:4171', prod = 'http://127.0.0.1:4172') {
  return validateConfig({
    schemaVersion: 1,
    project: 'test',
    allowHttp: true,
    sitemapUrl: stage + '/sitemap.xml',
    environments: { stage: { baseUrl: stage }, prod: { baseUrl: prod } },
  });
}
