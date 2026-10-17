// Zero-dependency assertions for the PR comments the action posts. Used by
// .github/workflows/_pass_release-pr-comment.yml. Reads the comments of a pull
// request as JSON lines ({id, login, body}) from stdin or --comments <file>:
//
//   gh api --paginate "repos/$GH_REPO/issues/$PR/comments" \
//     --jq '.[] | {id, login: .user.login, body} | tojson' \
//     | node assert-pr-comment.mjs --tag screenshots --images 9 --details-closed
//
// Only comments of the Actions bot that start with the action's hidden marker
// for --tag count. Exits 1 and prints every violated expectation.
import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import process from 'node:process';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

const BOT = 'github-actions[bot]';

const markerFor = tag => `<!-- screenshots-ci-action:${tag} -->`;

// Parses `gh api ... --jq '... | tojson'` output: one JSON object per line.
export function parseComments(text) {
	return text
		.split('\n')
		.filter(line => line.trim() !== '')
		.map(line => JSON.parse(line));
}

// The bot's comments of one tag, oldest first.
export function findTagged(comments, tag) {
	const marker = markerFor(tag);
	return comments.filter(comment =>
		comment.login === BOT
		&& typeof comment.body === 'string'
		&& (comment.body === marker || comment.body.startsWith(`${marker}\n`)),
	);
}

// Accordions: used at all, none of them open
function checkDetails(body, spec) {
	const failures = [];
	if (spec.detailsClosed) {
		if (!body.includes('<details')) {
			failures.push('Expected the comment to use <details>');
		}

		if (/<details\s+open/v.test(body)) {
			failures.push('Expected every <details> to be closed, found <details open');
		}
	}

	return failures;
}

// Image count and width/height attributes
function checkImages(imageTags, spec) {
	const unsized = spec.sizedImages
		? imageTags.filter(tag => !/\swidth="\d+"/v.test(tag) || !/\sheight="\d+"/v.test(tag))
		: [];
	return [
		spec.images !== undefined && imageTags.length !== Number(spec.images)
			? `Expected ${spec.images} <img> in the comment, found ${imageTags.length}`
			: '',
		spec.noImages && imageTags.length > 0
			? `Expected no <img> in the comment, found ${imageTags.length}`
			: '',
		spec.sizedImages && imageTags.length === 0
			? 'Expected <img> with width and height, found no <img>'
			: '',
		unsized.length > 0
			? `${unsized.length} <img> without width and height: ${unsized[0]}`
			: '',
	].filter(Boolean);
}

function checkText(body, spec) {
	return [
		...(spec.contains ?? [])
			.filter(text => !body.includes(text))
			.map(text => `The comment does not contain: ${text}`),
		...(spec.notContains ?? [])
			.filter(text => body.includes(text))
			.map(text => `The comment must not contain: ${text}`),
	];
}

/**
 Check the comments of one tag against an expectation.
 @param {{id: number, login: string, body: string}[]} comments All comments of the pull request.
 @param {object} spec tag; expectComments (default 1); expectId, notId; images, noImages; detailsClosed; sizedImages; contains[], notContains[].
 @returns {{failures: string[], comment?: object, tagged: object[], images: number}} The failures (empty when all hold), the comment that was checked and how many images it embeds.
 */
export function checkComments(comments, spec) {
	const failures = [];
	const tagged = findTagged(comments, spec.tag);
	const expected = spec.expectComments ?? 1;
	if (tagged.length !== expected) {
		failures.push(`Expected ${expected} comment(s) with the marker for tag "${spec.tag}" by ${BOT}, found ${tagged.length} (ids: ${tagged.map(comment => comment.id).join(', ') || 'none'})`);
	}

	const [comment] = tagged;
	if (!comment) {
		return {failures, tagged, images: 0};
	}

	const {body} = comment;
	const imageTags = body.match(/<img\b[^>]*>/gv) ?? [];

	if (spec.expectId !== undefined && comment.id !== Number(spec.expectId)) {
		failures.push(`Expected the comment to keep id ${spec.expectId} (updated in place), got ${comment.id}`);
	}

	if (spec.notId !== undefined && comment.id === Number(spec.notId)) {
		failures.push(`Expected a separate comment, but the id is still ${spec.notId}`);
	}

	failures.push(
		...checkDetails(body, spec),
		...checkImages(imageTags, spec),
		...checkText(body, spec),
	);

	return {
		failures, comment, tagged, images: imageTags.length,
	};
}

function run(argv) {
	const {values} = parseArgs({
		args: argv,
		options: {
			tag: {type: 'string'},
			comments: {type: 'string'},
			'expect-comments': {type: 'string'},
			'expect-id': {type: 'string'},
			'not-id': {type: 'string'},
			images: {type: 'string'},
			'no-images': {type: 'boolean'},
			'details-closed': {type: 'boolean'},
			'sized-images': {type: 'boolean'},
			contains: {type: 'string', multiple: true},
			'not-contains': {type: 'string', multiple: true},
			'write-body': {type: 'string'},
			'write-id': {type: 'string'},
			title: {type: 'string'},
		},
	});
	if (!values.tag) {
		console.error('::error::--tag is required');
		return 2;
	}

	const input = values.comments
		? fs.readFileSync(values.comments, 'utf8')
		: fs.readFileSync(0, 'utf8');
	const result = checkComments(parseComments(input), {
		tag: values.tag,
		expectComments: values['expect-comments'] === undefined ? undefined : Number(values['expect-comments']),
		expectId: values['expect-id'],
		notId: values['not-id'],
		images: values.images,
		noImages: values['no-images'],
		detailsClosed: values['details-closed'],
		sizedImages: values['sized-images'],
		contains: values.contains,
		notContains: values['not-contains'],
	});

	const title = values.title ?? `PR comment "${values.tag}"`;
	if (result.comment) {
		console.log(`${title}: comment ${result.comment.id}, ${result.images} image(s), ${result.comment.body.length} characters`);
		if (values['write-body']) {
			fs.writeFileSync(values['write-body'], result.comment.body);
		}

		if (values['write-id']) {
			fs.writeFileSync(values['write-id'], String(result.comment.id));
		}
	}

	for (const failure of result.failures) {
		console.error(`::error title=${title}::${failure}`);
	}

	if (process.env.GITHUB_STEP_SUMMARY && result.comment) {
		fs.appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			`- ${title}: comment ${result.comment.id} (${result.failures.length === 0 ? 'ok' : 'FAILED'}), ${result.images} image(s), ${Buffer.byteLength(result.comment.body)} bytes\n`,
		);
	}

	return result.failures.length === 0 ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.exitCode = run(process.argv.slice(2));
}
