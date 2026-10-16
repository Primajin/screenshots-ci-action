// Tiny login fixture for the pre-script smoke test.
// GET /login -> form; POST /login -> Set-Cookie session=1; GET / -> LOGGED IN
// only with the cookie. Every request's Cookie header is appended to argv[2].
import http from 'node:http';
import fs from 'node:fs';
import process from 'node:process';

const logFile = process.argv[2] || 'requests.log';
http
  .createServer((req, res) => {
    const cookie = req.headers.cookie || '';
    fs.appendFileSync(logFile, `${req.method} ${req.url} cookie=[${cookie}]\n`);
    res.setHeader('content-type', 'text/html');
    if (req.url === '/login' && req.method === 'POST') {
      req.resume();
      res.writeHead(302, { 'set-cookie': 'session=1; Path=/', location: '/' });
      return res.end();
    }
    if (req.url === '/login') {
      return res.end(
        '<form method=post action=/login><input name=user><button>Go</button></form>'
      );
    }
    res.end(
      cookie.includes('session=1') ? '<h1>LOGGED IN</h1>' : '<h1>LOGGED OUT</h1>'
    );
  })
  .listen(8081);
