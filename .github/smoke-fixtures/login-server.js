// Login fixture for the pre-script scenarios, themed like the demo shop.
// GET /login -> sign-in form; POST /login -> Set-Cookie session=1 and redirect;
// GET / -> "Signed in as demo-user" only with the cookie, "Signed out"
// otherwise. Every request's Cookie header is appended to argv[2]; the
// scenario asserts on those lines, so keep the log format as it is.
const http = require('http');
const fs = require('fs');
const path = require('path');

const logFile = process.argv[2] || 'requests.log';
const siteDir = path.join(__dirname, 'site');
const STATIC = {
  '/demo.css': 'text/css',
  '/demo.js': 'text/javascript',
};

const shell = (body) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Acme Demo Shop</title>
  <link rel="stylesheet" href="/demo.css">
</head>
<body data-mode="login">
  <div id="page">
    <div id="ruler" aria-hidden="true"></div>
    <header class="probe">
      <b>Acme Demo Shop</b>
      <span id="probe-size">measuring...</span>
      <span id="bp" class="badge"></span>
      <small id="probe-css"></small>
    </header>
    <nav><a href="/">Acme</a><a href="/">Account</a><a href="/login">Sign in</a></nav>
    <main>${body}</main>
    <footer><span id="end-marker"></span></footer>
  </div>
  <script src="/demo.js"></script>
</body>
</html>`;

const account = `
  <section class="cards">
    <article class="card"><i style="background:#bfdbfe"></i><h3>Orders</h3><p>3 open orders</p></article>
    <article class="card"><i style="background:#bbf7d0"></i><h3>Wishlist</h3><p>12 items</p></article>
    <article class="card"><i style="background:#fde68a"></i><h3>Rewards</h3><p>480 points</p></article>
  </section>`;

http
  .createServer((req, res) => {
    const cookie = req.headers.cookie || '';
    fs.appendFileSync(logFile, `${req.method} ${req.url} cookie=[${cookie}]\n`);
    if (STATIC[req.url]) {
      res.setHeader('content-type', STATIC[req.url]);
      return res.end(fs.readFileSync(path.join(siteDir, req.url)));
    }
    res.setHeader('content-type', 'text/html');
    if (req.url === '/login' && req.method === 'POST') {
      req.resume();
      res.writeHead(302, { 'set-cookie': 'session=1; Path=/', location: '/' });
      return res.end();
    }
    if (req.url === '/login') {
      return res.end(
        shell(`
  <div class="notice warn">Sign in to continue</div>
  <form class="signin" method="post" action="/login">
    <input name="user" aria-label="user name" placeholder="user name">
    <button>Sign in</button>
  </form>`)
      );
    }
    res.end(
      shell(
        cookie.includes('session=1')
          ? `<div class="notice ok">Signed in as demo-user</div>${account}`
          : '<div class="notice warn">Signed out: no session cookie was sent</div>'
      )
    );
  })
  .listen(8081);
