// Tiny login fixture for the pre-script scenarios.
// GET /login -> form; POST /login -> Set-Cookie session=1; GET / -> LOGGED IN
// only with the cookie. Every request's Cookie header is appended to argv[2].
import http from 'node:http';
import fs from 'node:fs';
import process from 'node:process';

const logFile = process.argv[2] || 'requests.log';
http
	.createServer((request, response) => {
		const cookie = request.headers.cookie || '';
		fs.appendFileSync(logFile, `${request.method} ${request.url} cookie=[${cookie}]\n`);
		response.setHeader('content-type', 'text/html');
		if (request.url === '/login' && request.method === 'POST') {
			request.resume();
			response.writeHead(302, {'set-cookie': 'session=1; Path=/', location: '/'});
			return response.end();
		}

		if (request.url === '/login') {
			return response.end(
				'<form method=post action=/login><input name=user><button>Go</button></form>',
			);
		}

		response.end(
			cookie.includes('session=1') ? '<h1>LOGGED IN</h1>' : '<h1>LOGGED OUT</h1>',
		);
	})
	.listen(8081);
