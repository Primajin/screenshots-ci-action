// The "other site" of the iframe scenario: a page that is one solid colour
// (magenta, ff00ff), served on 127.0.0.1 so it is a different site from the
// fixture page on localhost. Usage: node second-origin-server.js [port]
// (default 8082). It exits by itself after 30 minutes, so a local run never
// leaves it behind.
import http from 'node:http';
import process from 'node:process';

const port = Number(process.argv[2] ?? 8082);
const PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Second origin</title></head>
<body style="margin:0;background:#ff00ff;color:#ffffff;font:700 28px sans-serif">second origin on port ${port}</body>
</html>`;

const server = http
	.createServer((_request, response) => {
		response.writeHead(200, {'content-type': 'text/html; charset=utf-8'});
		response.end(PAGE);
	})
	.listen(port, '127.0.0.1');

// Closing the server ends the process
setTimeout(() => {
	server.close();
	server.closeAllConnections();
}, 30 * 60 * 1000).unref();
