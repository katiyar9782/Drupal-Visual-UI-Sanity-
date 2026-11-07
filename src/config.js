import fs from 'node:fs/promises';
import YAML from 'yaml';
import Ajv from 'ajv';
export const schema = {
  type: 'object',
  required: ['schemaVersion', 'project', 'environments'],
  additionalProperties: false,
  properties: {
    schemaVersion: { const: 1 },
    project: { type: 'string', minLength: 1 },
    mode: { enum: ['sitemap', 'single'] },
    sitemapUrl: { type: 'string' },
    paths: { type: 'array', minItems: 1, items: { type: 'string' } },
    allowHttp: { type: 'boolean' },
    outputDir: { type: 'string' },
    environments: {
      type: 'object',
      required: ['stage', 'prod'],
      additionalProperties: false,
      properties: Object.fromEntries(
        ['stage', 'prod'].map((k) => [
          k,
          {
            type: 'object',
            required: ['baseUrl'],
            additionalProperties: false,
            properties: {
              baseUrl: { type: 'string' },
              auth: { type: 'object' },
              assetOrigins: { type: 'array', items: { type: 'string' } },
            },
          },
        ]),
      ),
    },
    devices: {
      type: 'object',
      minProperties: 1,
      additionalProperties: {
        type: 'object',
        required: ['width', 'height'],
        additionalProperties: false,
        properties: {
          width: { type: 'integer', minimum: 240, maximum: 4096 },
          height: { type: 'integer', minimum: 240, maximum: 4096 },
          dpr: { type: 'number', minimum: 1, maximum: 3 },
          isMobile: { type: 'boolean' },
        },
      },
    },
    limits: {
      type: 'object',
      additionalProperties: false,
      properties: Object.fromEntries(
        Object.entries({
          maxPages: [1, 1000],
          concurrency: [1, 4],
          sitemapDepth: [0, 10],
          maxSitemaps: [1, 100],
          timeoutMs: [100, 120000],
          retries: [0, 3],
          maxComponents: [1, 500],
          maxScrollSteps: [1, 100],
        }).map(([k, [minimum, maximum]]) => [k, { type: 'integer', minimum, maximum }]),
      ),
    },
    mapping: {
      type: 'object',
      additionalProperties: false,
      properties: {
        overrides: { type: 'object', additionalProperties: { type: 'string' } },
        trailingSlash: { enum: ['preserve', 'remove', 'add'] },
        include: { type: 'array', items: { type: 'string' } },
        exclude: { type: 'array', items: { type: 'string' } },
      },
    },
    detection: {
      type: 'object',
      additionalProperties: false,
      properties: {
        drupalParagraphs: { type: 'boolean' },
        semanticFallback: { type: 'boolean' },
        customSelectors: { type: 'array', items: { type: 'string' } },
      },
    },
    capture: {
      type: 'object',
      additionalProperties: false,
      properties: {
        readySelector: { type: 'string' },
        masks: { type: 'array', items: { type: 'string' } },
        redactSelectors: { type: 'array', items: { type: 'string' } },
        settleMs: { type: 'integer', minimum: 0, maximum: 5000 },
        maxImagePixels: { type: 'integer', minimum: 1000, maximum: 40000000 },
      },
    },
    comparison: {
      type: 'object',
      additionalProperties: false,
      properties: {
        geometryTolerancePx: { type: 'number', minimum: 0 },
        pixelThreshold: { type: 'number', minimum: 0, maximum: 1 },
        maxDiffPixelRatio: { type: 'number', minimum: 0, maximum: 1 },
        styles: { type: 'array', items: { type: 'string' } },
      },
    },
    report: {
      type: 'object',
      additionalProperties: false,
      properties: { offlineHtml: { const: true }, includeScreenshots: { const: true } },
    },
  },
};
const validate = new Ajv({ allErrors: true }).compile(schema);
export function validateConfig(raw) {
  if (!validate(raw))
    throw new Error(
      'CONFIG: ' + validate.errors.map((e) => `${e.instancePath} ${e.message}`).join('; '),
    );
  const c = { mode: 'sitemap', allowHttp: false, outputDir: 'runs', ...raw };
  c.devices ??= {
    desktop: { width: 1440, height: 900, dpr: 1 },
    mobile: { width: 390, height: 844, dpr: 1, isMobile: true },
  };
  c.limits = {
    maxPages: 5,
    concurrency: 2,
    sitemapDepth: 3,
    maxSitemaps: 20,
    timeoutMs: 15000,
    retries: 1,
    maxComponents: 150,
    maxScrollSteps: 30,
    ...raw.limits,
  };
  c.mapping = {
    overrides: {},
    trailingSlash: 'preserve',
    include: [],
    exclude: [],
    ...raw.mapping,
  };
  c.detection = {
    drupalParagraphs: true,
    semanticFallback: true,
    customSelectors: [],
    ...raw.detection,
  };
  c.capture = {
    masks: [],
    redactSelectors: [],
    settleMs: 100,
    maxImagePixels: 16000000,
    ...raw.capture,
  };
  c.comparison = {
    geometryTolerancePx: 2,
    pixelThreshold: 0.1,
    maxDiffPixelRatio: 0.01,
    styles: [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'padding',
      'margin',
      'color',
      'background-color',
      'display',
      'object-fit',
    ],
    ...raw.comparison,
  };
  for (const env of Object.values(c.environments)) {
    const u = new URL(env.baseUrl);
    if (u.username || u.password || u.search || u.hash || u.pathname !== '/')
      throw new Error('CONFIG: baseUrl must be a credential-free origin');
    if (!['https:', ...(c.allowHttp ? ['http:'] : [])].includes(u.protocol))
      throw new Error('CONFIG: HTTPS required (allowHttp enables local fixtures)');
    env.baseUrl = u.origin;
    env.auth ??= { type: 'none' };
    if (!['none', 'httpBasic', 'storageState', 'form', 'browserSession'].includes(env.auth.type))
      throw new Error('CONFIG: unsupported auth type');
    for (const origin of env.assetOrigins ?? [])
      if (new URL(origin).origin !== origin)
        throw new Error('CONFIG: assetOrigins must contain origins');
    const required = {
      none: [],
      browserSession: [],
      httpBasic: ['usernameEnv', 'passwordEnv'],
      storageState: ['pathEnv'],
      form: [
        'loginPath',
        'usernameSelector',
        'passwordSelector',
        'submitSelector',
        'successSelector',
        'usernameEnv',
        'passwordEnv',
      ],
    }[env.auth.type];
    for (const key of required)
      if (typeof env.auth[key] !== 'string' || !env.auth[key])
        throw new Error('CONFIG: auth missing ' + key);
  }
  if (c.mode === 'sitemap' && !c.sitemapUrl) throw new Error('CONFIG: sitemapUrl required');
  if (c.mode === 'single' && !c.paths?.length) throw new Error('CONFIG: paths required');
  for (const pattern of [...c.mapping.include, ...c.mapping.exclude]) new RegExp(pattern);
  return c;
}
export async function loadConfig(path) {
  return validateConfig(YAML.parse(await fs.readFile(path, 'utf8')));
}
