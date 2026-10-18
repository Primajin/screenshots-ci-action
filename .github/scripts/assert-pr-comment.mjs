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
		&& (comment.body === marker || comment.body.startsWith(`${marker}\n`) || comment.body.startsWith(`${marker}\r\n`)),
	);
}

// The sections of a comment that was posted with comment-section: the hidden
//   <!-- screenshots-ci-action:<tag>:section:<slug> --> ... <!-- /screenshots-ci-action:<tag>:section:<slug> -->
// pairs, in the order they are in. Returns {sections: [{slug, content}], problems}
// where problems lists markers that are not balanced.
export function findSections(body, tag) {
	const prefix = `<!-- screenshots-ci-action:${tag}:section:`;
	const closePrefix = `<!-- /screenshots-ci-action:${tag}:section:`;
	const sections = [];
	const problems = [];
	let open;
	for (const line of body.split('\n')) {
		if (line.startsWith(prefix) && line.endsWith(' -->')) {
			if (open) {
				problems.push(`The section "${open.slug}" is not closed before "${line}"`);
			}

			open = {slug: line.slice(prefix.length, -' -->'.length), lines: []};
		} else if (line.startsWith(closePrefix) && line.endsWith(' -->')) {
			const slug = line.slice(closePrefix.length, -' -->'.length);
			if (open?.slug === slug) {
				sections.push({slug, content: open.lines.join('\n')});
			} else {
				problems.push(`The end marker of the section "${slug}" has no matching start marker`);
			}

			open = undefined;
		} else if (open) {
			open.lines.push(line);
		}
	}

	if (open) {
		problems.push(`The section "${open.slug}" is not closed`);
	}

	return {sections, problems};
}

// "slug=value" -> [slug, value]
const splitPair = pair => {
	const index = pair.indexOf('=');
	return index === -1 ? [pair, ''] : [pair.slice(0, index), pair.slice(index + 1)];
};

// The sections the spec talks about at all
const hasSectionSpec = spec => spec.sections !== undefined
	|| ['sectionContains', 'sectionNotContains', 'sectionImages', 'sectionEquals'].some(key => (spec[key] ?? []).length > 0);

// Checks of one section by slug; `failures` collects what is wrong
function checkSectionContent(sections, spec, failures) {
	const contentOf = (slug, what) => {
		const section = sections.find(item => item.slug === slug);
		if (!section) {
			failures.push(`There is no section "${slug}" to check ${what}`);
		}

		return section?.content;
	};

	for (const pair of spec.sectionContains ?? []) {
		const [slug, text] = splitPair(pair);
		const content = contentOf(slug, `for the text: ${text}`);
		if (content !== undefined && !content.includes(text)) {
			failures.push(`The section "${slug}" does not contain: ${text}`);
		}
	}

	for (const pair of spec.sectionNotContains ?? []) {
		const [slug, text] = splitPair(pair);
		const content = contentOf(slug, `for the text: ${text}`);
		if (content !== undefined && content.includes(text)) {
			failures.push(`The section "${slug}" must not contain: ${text}`);
		}
	}

	for (const pair of spec.sectionImages ?? []) {
		const [slug, count] = splitPair(pair);
		const content = contentOf(slug, 'for the number of images');
		const images = (content?.match(/<img\b[^>]*>/gv) ?? []).length;
		if (content !== undefined && images !== Number(count)) {
			failures.push(`Expected ${count} <img> in the section "${slug}", found ${images}`);
		}
	}

	for (const {slug, content: expected} of spec.sectionEquals ?? []) {
		const content = contentOf(slug, 'for equality');
		if (content !== undefined && content !== expected) {
			failures.push(`The section "${slug}" is not the same as before (it must be left untouched)`);
		}
	}
}

// What a call with comment-section must have left in the comment
function checkSections(body, spec) {
	if (!hasSectionSpec(spec)) {
		return [];
	}

	const {sections, problems} = findSections(body, spec.tag);
	const failures = [...problems];
	if (spec.sections !== undefined) {
		const found = sections.map(section => section.slug);
		const expected = spec.sections.filter(Boolean);
		if (found.join(',') !== expected.join(',')) {
			failures.push(`Expected the sections [${expected.join(', ')}] in this order, found [${found.join(', ')}]`);
		}
	}

	checkSectionContent(sections, spec, failures);
	return failures;
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
 @param {object} spec tag; expectComments (default 1); expectId, notId; images, noImages; detailsClosed; sizedImages; contains[], notContains[]; sections (the ordered slugs), sectionContains[], sectionNotContains[], sectionImages[] ("slug=text" or "slug=count") and sectionEquals[] ({slug, content}).
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
		...checkSections(body, spec),
	);

	return {
		failures, comment, tagged, images: imageTags.length,
	};
}

const OPTIONS = {
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
	sections: {type: 'string'},
	'section-contains': {type: 'string', multiple: true},
	'section-not-contains': {type: 'string', multiple: true},
	'section-images': {type: 'string', multiple: true},
	'section-equals': {type: 'string', multiple: true},
	'write-section': {type: 'string', multiple: true},
	'write-body': {type: 'string'},
	'write-id': {type: 'string'},
	title: {type: 'string'},
};

// Util.parseArgs refuses `--contains -abc1234.` (a value that starts with a
// dash looks like an option to it). Join every `--name value` of a string option
// to `--name=value`, which it accepts for any value, so both forms work.
export function normalizeArgs(argv) {
	const result = [];
	for (let index = 0; index < argv.length; index++) {
		const argument = argv[index];
		const name = argument.startsWith('--') ? argument.slice(2) : undefined;
		if (name !== undefined && OPTIONS[name]?.type === 'string' && index + 1 < argv.length) {
			result.push(`${argument}=${argv[++index]}`);
		} else {
			result.push(argument);
		}
	}

	return result;
}

function run(argv) {
	let values;
	try {
		({values} = parseArgs({args: normalizeArgs(argv), options: OPTIONS}));
	} catch (error) {
		console.error(`::error::${error.message}`);
		return 2;
	}

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
		sections: values.sections === undefined ? undefined : values.sections.split(',').map(slug => slug.trim()),
		sectionContains: values['section-contains'],
		sectionNotContains: values['section-not-contains'],
		sectionImages: values['section-images'],
		// "slug=file": the section must be what an earlier --write-section put into the file
		sectionEquals: (values['section-equals'] ?? []).map(pair => {
			const [slug, file] = splitPair(pair);
			return {slug, content: fs.readFileSync(file, 'utf8')};
		}),
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

		// "slug=file": the content of one section, to compare with --section-equals later
		for (const pair of values['write-section'] ?? []) {
			const [slug, file] = splitPair(pair);
			const section = findSections(result.comment.body, values.tag).sections.find(item => item.slug === slug);
			fs.writeFileSync(file, section ? section.content : '');
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

// Compare real paths, so a symlinked checkout does not turn the script into a
// silent no-op; an argv[1] that is missing or does not exist (an import from a
// REPL, a test runner) is not this script running
function isRunDirectly() {
	try {
		return Boolean(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href;
	} catch {
		return false;
	}
}

if (isRunDirectly()) {
	process.exitCode = run(process.argv.slice(2));
}
