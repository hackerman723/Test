const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

const mimeTypes = {
  '.html': 'text/html; charset=UTF-8',
  '.css': 'text/css; charset=UTF-8',
  '.js': 'application/javascript; charset=UTF-8',
  '.json': 'application/json; charset=UTF-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const sendResponse = (res, statusCode, data, contentType = 'text/plain; charset=UTF-8') => {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(data);
};

const serveStaticFile = (res, filePath) => {
  const resolvedPath = path.join(PUBLIC_DIR, filePath);

  if (!resolvedPath.startsWith(PUBLIC_DIR)) {
    sendResponse(res, 403, 'Forbidden');
    return;
  }

  fs.stat(resolvedPath, (err, stats) => {
    if (err || !stats.isFile()) {
      sendResponse(res, 404, 'Not found');
      return;
    }

    const ext = path.extname(resolvedPath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';
    const stream = fs.createReadStream(resolvedPath);

    stream.on('open', () => {
      res.writeHead(200, { 'Content-Type': contentType });
      stream.pipe(res);
    });

    stream.on('error', () => {
      sendResponse(res, 500, 'Internal server error');
    });
  });
};

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url);

  if (parsedUrl.pathname === '/health') {
    sendResponse(res, 200, JSON.stringify({ status: 'ok' }), 'application/json; charset=UTF-8');
    return;
  }

  let requestPath = parsedUrl.pathname;

  if (requestPath === '/' || requestPath === '') {
    requestPath = '/index.html';
  }

  serveStaticFile(res, requestPath);
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Speech-to-text web app listening on port ${PORT}`);
});
