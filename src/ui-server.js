import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fork, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BrowserAuth } from './browser-auth.js';
import { validateConfig } from './config.js';
import { startFixtures } from '../fixtures/server.js';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function buildConfig(input, outputDir) {
  const sitemap = new URL(input.sitemapUrl),
    prod = new URL(input.prodUrl);
  if (sitemap.username || sitemap.password || prod.username || prod.password)
    throw Error('Enter credentials in the login fields, not in URLs.');
  const env = {};
  const environments = {};
  for (const name of ['stage', 'prod']) {
    const auth = input[name + 'Auth'] ?? 'none';
    if (!['none', 'httpBasic', 'browserSession'].includes(auth))
      throw Error('Choose public access, Basic Auth or browser sign-in.');
    environments[name] = {
      baseUrl: name === 'stage' ? sitemap.origin : prod.origin,
      auth: { type: auth },
      assetOrigins: (input[name + 'Assets'] ?? '')
        .split(/\s*,\s*|\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    if (auth === 'httpBasic') {
      const user = input[name + 'User'],
        pass = input[name + 'Pass'];
      if (!user || !pass) throw Error(`Enter ${name} username and password.`);
      const prefix = 'UI_' + name.toUpperCase();
      env[prefix + '_USER'] = user;
      env[prefix + '_PASS'] = pass;
      environments[name].auth = {
        type: auth,
        usernameEnv: prefix + '_USER',
        passwordEnv: prefix + '_PASS',
      };
    }
  }
  const devices = {};
  if (input.desktop !== false) devices.desktop = { width: 1440, height: 900, dpr: 1 };
  if (input.mobile !== false) devices.mobile = { width: 390, height: 844, dpr: 1, isMobile: true };
  let overrides = {};
  for (const line of (input.overrides ?? '').split('\n').filter((x) => x.trim())) {
    const parts = line.split('=>').map((x) => x.trim());
    if (parts.length !== 2 || !parts[0].startsWith('/') || !parts[1].startsWith('/'))
      throw Error('Each path mapping must look like /stage-path => /production-path');
    overrides[parts[0]] = parts[1];
  }
  const config = validateConfig({
    schemaVersion: 1,
    project: input.project?.trim() || 'Visual UI comparison',
    mode: 'sitemap',
    sitemapUrl: sitemap.href,
    environments,
    allowHttp: input.allowHttp === true,
    devices,
    limits: { maxPages: Number(input.maxPages ?? 5), timeoutMs: 30000, concurrency: 2, retries: 1 },
    mapping: { overrides },
    capture: {
      masks: (input.masks ?? '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean),
    },
    outputDir,
  });
  return { config, env };
}
function stopChild(child) {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') {
      const p = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      p.on('error', () => child.kill());
    } else process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill();
  }
}
export async function startUi({
  port = 4173,
  outputDir = path.join(root, 'runs'),
  open = false,
  authManager = new BrowserAuth(),
} = {}) {
  const token = crypto.randomBytes(32).toString('hex'),
    jobs = new Map(),
    children = new Set();
  let active = null,
    fixtures = null,
    cancelActive = null;
  const send = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    try {
      const origin = `http://127.0.0.1:${server.address().port}`;
      if (req.headers.host !== new URL(origin).host)
        return send(res, 403, { error: 'Use the local application address.' });
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Cache-Control', 'no-store');
      const url = new URL(req.url, origin);
      if (req.method === 'GET' && url.pathname === '/') {
        const html = (await fs.readFile(path.join(root, 'ui/index.html'), 'utf8')).replace(
          '__TOKEN__',
          token,
        );
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader(
          'Content-Security-Policy',
          "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'",
        );
        return res.end(html);
      }
      if (req.method === 'GET' && ['/app.js', '/style.css'].includes(url.pathname)) {
        res.setHeader(
          'Content-Type',
          url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css',
        );
        return res.end(await fs.readFile(path.join(root, 'ui', url.pathname.slice(1))));
      }
      if (
        req.method === 'GET' &&
        /^\/reports\/[a-zA-Z0-9-]+\/(report.html|results.json)$/.test(url.pathname)
      ) {
        const [, , id, file] = url.pathname.split('/');
        const content = await fs.readFile(path.join(outputDir, id, file));
        res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : 'application/json');
        if (file.endsWith('.html'))
          res.setHeader(
            'Content-Security-Policy',
            "sandbox allow-scripts allow-downloads; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:",
          );
        return res.end(content);
      }
      if (!url.pathname.startsWith('/api/')) return send(res, 404, { error: 'Not found' });
      if (
        req.headers['x-ui-token'] !== token ||
        (req.headers.origin && req.headers.origin !== origin)
      )
        return send(res, 403, { error: 'Session expired. Reload this page.' });
      if (req.method === 'GET' && url.pathname === '/api/auth/status')
        return send(res, 200, { sessions: authManager.status() });
      if (req.method === 'GET' && url.pathname === '/api/jobs') {
        return send(res, 200, { jobs: [...jobs.values()].reverse() });
      }
      if (req.method === 'GET' && url.pathname === '/api/history') {
        await fs.mkdir(outputDir, { recursive: true });
        const entries = (await fs.readdir(outputDir, { withFileTypes: true }))
          .filter((x) => x.isDirectory() && /^[a-zA-Z0-9-]+$/.test(x.name))
          .sort((a, b) => b.name.localeCompare(a.name))
          .slice(0, 30);
        const history = [];
        for (const e of entries)
          try {
            const r = JSON.parse(
              await fs.readFile(path.join(outputDir, e.name, 'results.json'), 'utf8'),
            );
            history.push({
              runId: e.name,
              project: r.project,
              createdAt: r.createdAt,
              status: r.status,
              summary: r.summary,
            });
          } catch {}
        return send(res, 200, { history });
      }
      if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed' });
      if (!req.headers['content-type']?.startsWith('application/json'))
        return send(res, 415, { error: 'JSON required' });
      let data = '',
        size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 32768) {
          send(res, 413, { error: 'Form too large' });
          return;
        }
        data += chunk;
      }
      let input;
      try {
        input = JSON.parse(data || '{}');
      } catch {
        return send(res, 400, { error: 'Invalid form data' });
      }
      if (url.pathname === '/api/cancel') {
        if (!active || !cancelActive) return send(res, 400, { error: 'No active task.' });
        cancelActive();
        return send(res, 200, { message: 'Stopping task…' });
      }
      if (active)
        return send(res, 409, { error: 'A task is already running. Wait for it to finish.' });
      if (url.pathname.startsWith('/api/auth/')) {
        const kind = input.environment;
        if (!['stage', 'prod'].includes(kind))
          return send(res, 400, { error: 'Choose Stage or Production.' });
        if (url.pathname === '/api/auth/disconnect') {
          await authManager.disconnect(kind);
          return send(res, 200, { disconnected: true });
        }
        if (url.pathname === '/api/auth/complete')
          return send(res, 200, { session: await authManager.complete(kind) });
        if (url.pathname === '/api/auth/start') {
          const { config } = buildConfig(input, outputDir);
          const origin = config.environments[kind].baseUrl;
          const extraOrigins = (input[kind + 'LoginOrigins'] ?? '')
            .split(/[,\n]/)
            .map((x) => x.trim())
            .filter(Boolean);
          return send(res, 200, {
            session: await authManager.start(kind, {
              origin,
              url: kind === 'stage' ? config.sitemapUrl : origin,
              allowHttp: config.allowHttp,
              extraOrigins,
            }),
          });
        }
        return send(res, 404, { error: 'Not found' });
      }
      if (url.pathname === '/api/demo') {
        fixtures ??= await startFixtures({ stagePort: 0, prodPort: 0 });
        return send(res, 200, {
          sitemapUrl: fixtures.stage + '/sitemap.xml',
          prodUrl: fixtures.prod,
        });
      }
      if (url.pathname === '/api/install') {
        const id = crypto.randomUUID(),
          job = {
            id,
            action: 'install',
            state: 'running',
            message: 'Installing Chromium for browser sign-in and headless comparisons…',
            startedAt: new Date().toISOString(),
          };
        jobs.set(id, job);
        active = id;
        const child = spawn(
          process.execPath,
          [path.join(root, 'node_modules/playwright/cli.js'), 'install', 'chromium'],
          { cwd: root, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] },
        );
        children.add(child);
        cancelActive = () => {
          job.cancelled = true;
          job.message = 'Stopping task…';
          stopChild(child);
        };
        for (const stream of [child.stdout, child.stderr])
          stream.on('data', (chunk) => {
            job.message = chunk
              .toString()
              .replace(/\x1b\[[0-9;]*m/g, '')
              .trim()
              .slice(-800);
          });
        child.on('error', () => {
          job.state = 'error';
          job.message = 'Could not start the installer.';
          active = null;
          children.delete(child);
        });
        child.on('close', (code) => {
          job.state = code === 0 ? 'done' : 'error';
          job.message =
            code === 0
              ? 'Browser installed. You can start a comparison.'
              : 'Browser installation failed. Check your connection and system permissions. ' +
                job.message;
          if (job.cancelled) {
            job.state = 'cancelled';
            job.message = 'Task cancelled.';
          }
          active = null;
          cancelActive = null;
          children.delete(child);
        });
        return send(res, 202, { id });
      }
      if (!['/api/discover', '/api/run'].includes(url.pathname))
        return send(res, 404, { error: 'Not found' });
      const { config, env } = buildConfig(input, outputDir);
      const sessions = {};
      for (const kind of ['stage', 'prod'])
        if (config.environments[kind].auth.type === 'browserSession')
          sessions[kind] = authManager.get(kind, config.environments[kind].baseUrl);
      const action = url.pathname.slice(5),
        id = crypto.randomUUID();
      const job = {
        id,
        action,
        state: 'running',
        message: action === 'discover' ? 'Fetching sitemap…' : 'Starting comparison…',
        startedAt: new Date().toISOString(),
      };
      jobs.set(id, job);
      while (jobs.size > 50) jobs.delete(jobs.keys().next().value);
      active = id;
      const child = fork(path.join(root, 'src/ui-worker.js'), [], {
        cwd: root,
        detached: process.platform !== 'win32',
        env: { ...process.env, ...env },
        stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      });
      children.add(child);
      cancelActive = () => {
        job.cancelled = true;
        job.message = 'Stopping task…';
        stopChild(child);
      };
      let completion = null;
      child.on('message', (message) => {
        if (message.type === 'auth-required') {
          authManager.disconnect(message.env).catch(() => {});
        }
        if (message.type === 'progress') job.message = message.event.message;
        if (message.type === 'done') {
          completion = 'done';
          job.result = message.result;
          job.message =
            action === 'discover'
              ? 'Pages fetched. Review the pairs below.'
              : 'Comparison complete.';
        }
        if (message.type === 'error') {
          completion = 'error';
          job.message = message.message;
        }
      });
      child.on('error', () => {
        job.state = 'error';
        job.message = 'Unable to start the task.';
      });
      child.on('exit', () => {
        if (completion) job.state = completion;
        if (job.state === 'running') {
          job.state = 'error';
          job.message = 'Task stopped unexpectedly.';
        }
        if (job.cancelled) {
          job.state = 'cancelled';
          job.message = 'Task cancelled.';
        }
        active = null;
        cancelActive = null;
        children.delete(child);
      });
      child.send({ action, config, sessions });
      return send(res, 202, { id });
    } catch (e) {
      const safe = /^(AUTH:|CONFIG:|Enter |Choose |Each |Invalid URL)/.test(e.message);
      send(res, e.code === 'ENOENT' ? 404 : 400, {
        error: safe ? e.message : 'Unable to process this request. Check the URLs and form values.',
      });
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = `http://127.0.0.1:${server.address().port}`;
  if (open) {
    const cmd =
      process.platform === 'win32'
        ? 'explorer'
        : process.platform === 'darwin'
          ? 'open'
          : 'xdg-open';
    const p = spawn(cmd, [address], { stdio: 'ignore' });
    p.on('error', () => {});
    p.unref();
  }
  return {
    address,
    close: async () => {
      for (const c of children) stopChild(c);
      await authManager.close();
      await fixtures?.close();
      await new Promise((r) => server.close(r));
    },
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ui = await startUi({ open: process.argv.includes('--open') });
  console.log('Visual UI Testing: ' + ui.address + '\nKeep this window open while using the app.');
  for (const s of ['SIGINT', 'SIGTERM'])
    process.once(s, async () => {
      await ui.close();
      process.exit();
    });
}
