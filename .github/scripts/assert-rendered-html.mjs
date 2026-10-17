// Zero-dependency assertions for how GitHub renders the comment. GitHub rewrites
// <img> tags (a height above 2000 is cut to 2000 and the width is scaled with it,
// which turns a tall part into a narrow strip), so what the action wrote is not
// enough: this checks the rendered HTML (the `body_html` of the comment, fetched
// with `-H "Accept: application/vnd.github.full+json"`).
//
//   node assert-rendered-html.mjs --html rendered.html --images 9 --min-image-width 500
import fs from 'node:fs';
import process from 'node:process';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';

const attribute = (tag, name) => new RegExp(String.raw`\s${name}="(?<value>[^"]*)"`, 'v').exec(tag)?.groups.value;

/**
 Check the images of a rendered comment.
 @param {string} html Body of the rendered comment (body_html).
 @param {{images?: number, minImageWidth?: number, noHeightAttribute?: boolean}} spec images: exact count; minImageWidth: every image has a width attribute of at least this; noHeightAttribute: no image has a height attribute.
 @returns {{failures: string[], images: {width?: number, height?: number}[]}} The failures (empty when all hold) and the sizes of the images.
 */
export function checkRenderedHtml(html, spec) {
	const tags = html.match(/<img\b[^>]*>/gv) ?? [];
	const images = tags.map(tag => ({
		width: attribute(tag, 'width') === undefined ? undefined : Number(attribute(tag, 'width')),
		height: attribute(tag, 'height') === undefined ? undefined : Number(attribute(tag, 'height')),
	}));
	const describe = image => `#${image.index + 1} width=${image.width} height=${image.height}`;
	const narrow = spec.minImageWidth === undefined
		? []
		: images
			.map((image, index) => ({...image, index}))
			.filter(image => image.width === undefined || image.width < Number(spec.minImageWidth));
	const withHeight = spec.noHeightAttribute
		? images.filter(image => image.height !== undefined)
		: [];
	const failures = [
		spec.images !== undefined && images.length !== Number(spec.images)
			? `Expected ${spec.images} rendered <img>, found ${images.length}`
			: '',
		narrow.length > 0
			? `${narrow.length} rendered <img> narrower than ${spec.minImageWidth} px (GitHub shrinks an image with a height above 2000): ${narrow.map(image => describe(image)).join(', ')}`
			: '',
		withHeight.length > 0
			? `${withHeight.length} rendered <img> with a height attribute, expected none (heights: ${withHeight.map(image => image.height).join(', ')})`
			: '',
	].filter(Boolean);

	return {failures, images};
}

function run(argv) {
	let values;
	try {
		({values} = parseArgs({
			args: argv,
			options: {
				html: {type: 'string'},
				images: {type: 'string'},
				'min-image-width': {type: 'string'},
				'no-height-attr': {type: 'boolean'},
				title: {type: 'string'},
			},
		}));
	} catch (error) {
		console.error(`::error::${error.message}`);
		return 2;
	}

	if (!values.html) {
		console.error('::error::--html is required');
		return 2;
	}

	const title = values.title ?? 'Rendered comment';
	const result = checkRenderedHtml(fs.readFileSync(values.html, 'utf8'), {
		images: values.images,
		minImageWidth: values['min-image-width'],
		noHeightAttribute: values['no-height-attr'],
	});
	console.log(`${title}: ${result.images.length} image(s), widths ${[...new Set(result.images.map(image => image.width))].join(', ')}`);
	for (const failure of result.failures) {
		console.error(`::error title=${title}::${failure}`);
	}

	if (process.env.GITHUB_STEP_SUMMARY) {
		fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${title}: ${result.failures.length === 0 ? 'ok' : 'FAILED'}, ${result.images.length} image(s) rendered\n`);
	}

	return result.failures.length === 0 ? 0 : 1;
}

// Compare real paths, so a symlinked checkout does not turn the script into a silent no-op
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
	process.exitCode = run(process.argv.slice(2));
}
