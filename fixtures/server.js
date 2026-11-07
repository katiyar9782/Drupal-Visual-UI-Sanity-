import http from 'node:http';
import { pathToFileURL } from 'node:url';
const routes = ['/home', '/about', '/services', '/news', '/contact'];
function page(path, changed) {
  const block = (type, title, body = '', style = '') =>
    `<section class="paragraph paragraph--type--${type}" style="${style}"><h2>${title}</h2>${body}</section>`;
  const hero = block(
    'hero',
    'Welcome to Drupal',
    '<p>Reliable experiences for every visitor.</p>',
    changed && path === '/home' ? 'padding:48px;font-size:22px' : '',
  );
  const cards = block(
    'cards',
    'Our services',
    block('card', 'Design', '<p>Accessible interfaces.</p>') +
      block('card', 'Engineering', '<p>Robust platforms.</p>'),
  );
  const picture = block(
    'media',
    'Our landscape',
    `<img loading="lazy" width="320" height="160" style="object-fit:${changed && path === '/news' ? 'contain' : 'cover'}" src="${changed && path === '/about' ? '/missing.svg' : '/landscape.svg'}" alt="Mountains">`,
  );
  const extra =
    changed && path === '/services'
      ? block('text', 'New middle section', '<p>A deliberate insertion.</p>')
      : '';
  const end =
    changed && path === '/contact'
      ? ''
      : block('text', 'Contact the team', '<p>Start a conversation.</p>');
  return /* HTML */ `<!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width" />
        <title>Drupal fixture</title>
        <style>
          * {
            box-sizing: border-box;
          }
          body {
            margin: 0;
            font: 16px Arial;
            color: #172b43;
            background: #f1f5fa;
          }
          header,
          footer {
            padding: 20px;
            background: #172b43;
            color: white;
          }
          main {
            max-width: 1000px;
            margin: auto;
            padding: 16px;
          }
          .paragraph {
            background: white;
            padding: 24px;
            margin: 16px 0;
            border: 1px solid #ccd7e5;
          }
          .paragraph--type--card {
            display: inline-block;
            width: 46%;
            vertical-align: top;
            margin: 1%;
          }
          img {
            max-width: 100%;
          }
          h2 {
            margin: 0 0 16px;
          }
          @media (max-width: 500px) {
            .paragraph--type--card {
              width: 98%;
            }
            .paragraph {
              padding: 16px;
            }
          }
          .hidden {
            display: none;
          }
        </style>
      </head>
      <body>
        <header>Drupal demonstration</header>
        <main>
          ${hero}${cards}${extra}${picture}${end}
          <section class="paragraph--type--hidden hidden">Hidden</section>
          <div class="xparagraph--type--fake">Not a Paragraph</div>
          <article>
            <h2>Editorial fallback</h2>
            <p>Semantic discovery.</p>
          </article>
        </main>
        <footer>Fixture environment</footer>
      </body>
    </html>`;
}
export async function startFixtures({ stagePort = 4171, prodPort = 4172, mutations = true } = {}) {
  const servers = [];
  for (const [env, port] of [
    ['stage', stagePort],
    ['prod', prodPort],
  ]) {
    const server = http.createServer((req, res) => {
      const base = `http://127.0.0.1:${server.address().port}`,
        u = new URL(req.url, base);
      if (
        u.pathname === '/basic.xml' &&
        req.headers.authorization !==
          'Basic ' + Buffer.from('tester:fixture-pass').toString('base64')
      ) {
        res.writeHead(401, { 'www-authenticate': 'Basic realm="fixture"' });
        return res.end('Unauthorized');
      }
      if (u.pathname === '/login' && req.method === 'POST') {
        let body = '';
        req.on('data', (d) => (body += d));
        req.on('end', () => {
          if (body !== 'user=tester&pass=fixture-pass') {
            res.writeHead(401);
            return res.end('Denied');
          }
          res.writeHead(302, {
            'set-cookie': `session=${env}; HttpOnly; Path=/`,
            location: '/private',
          });
          res.end();
        });
        return;
      }
      if (u.pathname === '/login') {
        res.setHeader('content-type', 'text/html');
        return res.end(
          '<form method="post"><input name="user"><input name="pass" type="password"><button>Sign in</button></form>',
        );
      }
      if (u.pathname === '/private' || u.pathname === '/private.xml') {
        if (!req.headers.cookie?.includes(`session=${env}`)) {
          res.writeHead(401);
          return res.end('Unauthorized');
        }
        if (u.pathname === '/private') {
          res.setHeader('content-type', 'text/html');
          return res.end('<main id="logged-in">Private fixture</main>');
        }
      }
      if (u.pathname === '/redirect.xml') {
        res.writeHead(302, { location: '/sitemap.xml' });
        return res.end();
      }
      if (u.pathname === '/external.xml') {
        res.writeHead(302, { location: 'https://example.invalid/sitemap.xml' });
        return res.end();
      }
      if (u.pathname === '/bad.xml') return res.end('<urlset><url>');
      if (u.pathname === '/sitemap.xml') {
        res.setHeader('content-type', 'application/xml');
        return res.end(
          `<sitemapindex><sitemap><loc>${base}/pages.xml</loc></sitemap><sitemap><loc>${base}/pages.xml</loc></sitemap></sitemapindex>`,
        );
      }
      if (['/pages.xml', '/basic.xml', '/private.xml'].includes(u.pathname)) {
        res.setHeader('content-type', 'application/xml');
        return res.end(
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...routes, routes[0], 'https://example.invalid/unsafe'].map((p) => `<url><loc>${p.startsWith('http') ? p : base + p}</loc></url>`).join('')}</urlset>`,
        );
      }
      if (u.pathname === '/landscape.svg') {
        res.setHeader('content-type', 'image/svg+xml');
        return res.end(
          '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="160"><rect width="400" height="160" fill="#8bcbe8"/><path d="M0 160L120 20L220 160L300 50L400 160" fill="#26795b"/></svg>',
        );
      }
      if (routes.includes(u.pathname) || u.pathname === '/timeout') {
        res.setHeader('content-type', 'text/html');
        return res.end(page(u.pathname, env === 'stage' && mutations));
      }
      res.writeHead(404);
      res.end('Not found');
    });
    await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));
    servers.push(server);
  }
  return {
    stage: `http://127.0.0.1:${servers[0].address().port}`,
    prod: `http://127.0.0.1:${servers[1].address().port}`,
    close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))),
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const x = await startFixtures({ mutations: !process.argv.includes('--clean') });
  console.log(`Fixtures: Stage ${x.stage}; Production ${x.prod}`);
  for (const sig of ['SIGINT', 'SIGTERM'])
    process.on(sig, async () => {
      await x.close();
      process.exit();
    });
}
