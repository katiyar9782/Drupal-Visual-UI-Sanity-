// Local test double for a redirect-based identity provider. Not an OAuth server.
import http from 'node:http';
export async function startSsoFixture() {
  const servers = [];
  const serve = async (handler) => {
    const server = http.createServer(handler);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}`;
  };
  let identity;
  const markup =
    '<main><section class="paragraph--type--text"><h2>Protected section</h2><p>Fixture content.</p></section></main>';
  const stage = await serve((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/callback' && url.searchParams.get('code') === 'fixture-only') {
      res.writeHead(302, {
        'set-cookie': 'sso=fixture; HttpOnly; Path=/; SameSite=Lax',
        location: '/sitemap.xml',
      });
      return res.end();
    }
    if (!req.headers.cookie?.includes('sso=fixture')) {
      res.writeHead(302, { location: identity + '/authorize' });
      return res.end();
    }
    if (url.pathname === '/sitemap.xml') {
      res.setHeader('content-type', 'application/xml');
      return res.end(`<urlset><url><loc>${stage}/home</loc></url></urlset>`);
    }
    res.setHeader('content-type', 'text/html');
    res.end(markup);
  });
  identity = await serve((req, res) => {
    if (req.url === '/approve' && req.method === 'POST') {
      res.writeHead(302, { location: stage + '/callback?code=fixture-only' });
      return res.end();
    }
    res.setHeader('content-type', 'text/html');
    res.end(
      '<h1>Local identity fixture</h1><form method="POST" action="/approve"><button>Approve fixture sign-in</button></form>',
    );
  });
  const prod = await serve((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(markup);
  });
  return {
    stage,
    identity,
    prod,
    close: () => Promise.all(servers.map((s) => new Promise((r) => s.close(r)))),
  };
}
