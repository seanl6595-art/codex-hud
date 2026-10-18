'use strict';
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { randomBytes, timingSafeEqual } = require('node:crypto');
const { createService } = require('./service');
const { listenLoopback, validatePort } = require('./listen');
async function startServer(options = {}) {
  validatePort(options.port ?? 4317);
  const assets = options.assets || path.resolve(__dirname, '../../dist/gui');
  if (!fs.existsSync(path.join(assets, 'index.html'))) throw new Error('GUI assets are missing. Run npm run build:gui in a source checkout.');
  const service = createService(options), token = randomBytes(32).toString('hex');
  let origin;
  const json = (res, status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (req.headers.host !== new URL(origin).host || (req.headers.origin && req.headers.origin !== origin)) return json(res, 403, { error: 'Local origin required.', code: 'FORBIDDEN' });
    try {
      const url = new URL(req.url, origin), route = url.pathname;
      if (route === '/api/bootstrap' && req.method === 'GET') return json(res, 200, { token, apiVersion: 2, capabilities: { modelAnalytics: true, recorderDiagnostics: true, sessionClassification: true }, timezone: service.timezone, version: require('../../package.json').version });
      if (route.startsWith('/api/')) {
        const provided = String(req.headers['x-codex-hud-token'] || '');
        if (provided.length !== token.length || !timingSafeEqual(Buffer.from(provided), Buffer.from(token))) return json(res, 403, { error: 'Reload this page to reconnect to the local server.', code: 'FORBIDDEN' });
        let data;
        if (req.method === 'GET') {
          if (route === '/api/stats') data = await service.stats(url.searchParams);
          else if (route === '/api/heatmap') data = await service.heatmap(url.searchParams.get('timezone') || undefined, url.searchParams.get('weeks') || 12, url.searchParams.get('offset') || 0);
          else if (route === '/api/sessions') data = await service.sessions();
          else if (route.startsWith('/api/sessions/')) data = await service.detail(decodeURIComponent(route.slice(14)));
          else if (route === '/api/recorder') data = await service.status();
          else if (route === '/api/recorder/diagnostics') data = await service.diagnostics();
          else return json(res, 404, { error: 'Endpoint not found.' });
        } else if (req.method === 'POST' && /^\/api\/recorder\/(start|stop|sync)$/.test(route)) {
          if (Number(req.headers['content-length'] || 0) > 1024 || req.headers['transfer-encoding']) return json(res, 413, { error: 'Request body is too large.' });
          req.resume(); data = await service.control(route.split('/').pop());
        } else return json(res, 405, { error: 'Method not allowed.' });
        return json(res, 200, data);
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { error: 'Method not allowed.' });
      const relative = decodeURIComponent(route).replace(/^\/+/, '') || 'index.html';
      const file = path.resolve(assets, relative);
      if (!file.startsWith(path.resolve(assets) + path.sep)) return json(res, 403, { error: 'Invalid asset path.' });
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: 'Asset not found.' });
      const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
      if (req.method === 'HEAD') res.end(); else fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (e) {
      const status = e.code === 'DB_MISSING' || e.code === 'NOT_FOUND' ? 404 : e.code === 'READ_ERROR' || e.code === 'RECORDER_ERROR' ? 503 : 400;
      json(res, status, { error: e.message, code: e.code || 'INVALID_REQUEST' });
    }
  });
  try {
    await listenLoopback(server, options.port ?? 4317);
  } catch (e) { await service.close(); throw e; }
  origin = 'http://127.0.0.1:' + server.address().port;
  return { server, url: origin, service, async close() {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await service.close();
  } };
}
module.exports = { startServer };
