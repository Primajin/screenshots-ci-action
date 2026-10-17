import {describe, expect, it} from 'vitest';
import {
	MAX_COMMENT_LENGTH,
	buildCommentBody,
	captureLabel,
	commentMarker,
	displaySize,
	formatBytes,
	parseFileName,
	renderComment,
} from './comment.js';

const entry = (fileName, url, bytes = 1024, size = {}) => ({
	fileName,
	name: `2026-10-16T10.00.00.000Z-${fileName}`,
	url,
	bytes,
	...size,
});

// Two desktop sizes, a phone in three parts (part 2 failed) and a tablet
const files = [
	'desktopPage1140x640-abc1234.jpeg',
	'desktopPage540x405-abc1234.jpeg',
	'iPhone_13-part1-abc1234.jpeg',
	'iPhone_13-part2-abc1234.jpeg',
	'iPhone_13-part3-abc1234.jpeg',
	'iPad_Pro_11-abc1234.jpeg',
];
const uploaded = [
	entry(files[0], 'https://x/d1140', 2048, {width: 1140, height: 640}),
	entry(files[1], 'https://x/d540', 1024, {width: 540, height: 405}),
	entry(files[2], 'https://x/p1', 3 * 1024 * 1024, {width: 1170, height: 16_000}),
	entry(files[4], 'https://x/p3', 1024 * 1024, {width: 1170, height: 4276}),
	entry(files[5], 'https://x/ipad', 4096, {width: 1668, height: 2388}),
];

const count = (text, pattern) => text.split(pattern).length - 1;

describe('parseFileName', () => {
	it('detects parts before the commit hash', () => {
		expect(parseFileName('iPhone_13-part2-abc1234.jpeg')).toEqual({
			group: 'iPhone_13-abc1234.jpeg',
			part: 2,
		});
		expect(parseFileName('desktopPage540x405-part10.png')).toEqual({
			group: 'desktopPage540x405.png',
			part: 10,
		});
	});

	it('leaves other names alone', () => {
		expect(parseFileName('iPhone_13-abc1234.jpeg')).toEqual({
			group: 'iPhone_13-abc1234.jpeg',
			part: null,
		});
		expect(parseFileName('party-part-abc1234.jpeg').part).toBeNull();
	});
});

describe('formatBytes', () => {
	it('uses KB and MB', () => {
		expect(formatBytes(100)).toBe('1 KB');
		expect(formatBytes(2048)).toBe('2 KB');
		expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB');
	});
});

describe('captureLabel', () => {
	it('drops extension, commit hash and underscores', () => {
		expect(captureLabel('iPhone_13-abc1234.jpeg')).toBe('iPhone 13');
		expect(captureLabel('Galaxy_S_III_landscape-abc1234.png')).toBe('Galaxy S III landscape');
		expect(captureLabel('iPad_Pro_11.jpeg')).toBe('iPad Pro 11');
	});

	it('drops the timestamp fallback of the hash', () => {
		expect(captureLabel('iPhone_13-1760000000000.jpeg')).toBe('iPhone 13');
	});

	it('shows the viewport width of desktop captures', () => {
		expect(captureLabel('desktopPage540x405-abc1234.jpeg')).toBe('Desktop 540');
		expect(captureLabel('desktopPage1920x1080.png')).toBe('Desktop 1920');
	});
});

describe('displaySize', () => {
	it('shrinks wide images to the width and keeps the aspect ratio', () => {
		expect(displaySize({width: 1920, height: 1080}, 600)).toEqual({width: 600, height: 338});
		expect(displaySize({width: 1170, height: 16_000}, 600)).toEqual({width: 600, height: 8205});
	});

	it('never enlarges an image', () => {
		expect(displaySize({width: 540, height: 405}, 600)).toEqual({width: 540, height: 405});
	});

	it('has no size without a width limit or without a known size', () => {
		expect(displaySize({width: 540, height: 405}, 0)).toBeUndefined();
		expect(displaySize({}, 600)).toBeUndefined();
		expect(displaySize({width: 10}, 600)).toBeUndefined();
	});

	it('keeps at least one pixel of height', () => {
		expect(displaySize({width: 6000, height: 1}, 600).height).toBe(1);
	});
});

describe('commentMarker', () => {
	it('is a hidden comment with the tag', () => {
		expect(commentMarker('screenshots')).toBe('<!-- screenshots-ci-action:screenshots -->');
	});
});

describe('renderComment defaults', () => {
	const body = renderComment(uploaded, files);

	it('starts with the marker and the headline', () => {
		expect(body.startsWith('<!-- screenshots-ci-action:screenshots -->\n### Screenshots\n\n')).toBe(true);
	});

	it('renders one closed accordion per capture', () => {
		expect(count(body, '<details>')).toBe(4);
		expect(body).not.toContain('<details open');
		expect(count(body, '</details>')).toBe(4);
	});

	it('shows the name, pixel size and file size in the summary', () => {
		expect(body).toContain('<summary><b>Desktop 540</b> · 540 × 405 px · 1 KB</summary>');
		expect(body).toContain('<summary><b>Desktop 1140</b> · 1,140 × 640 px · 2 KB</summary>');
		expect(body).toContain('<summary><b>iPad Pro 11</b> · 1,668 × 2,388 px · 4 KB</summary>');
	});

	it('sorts desktop sizes numerically before the devices', () => {
		const order = ['Desktop 540', 'Desktop 1140', 'iPad Pro 11', 'iPhone 13'].map(label => body.indexOf(`<b>${label}</b>`));
		expect(order).toEqual(order.toSorted((a, b) => a - b));
		expect(order.every(position => position > 0)).toBe(true);
	});

	it('puts width and height on every image', () => {
		expect(count(body, '<img ')).toBe(5);
		expect(body).toContain('alt="Desktop 540" width="540" height="405">');
		expect(body).toContain('alt="Desktop 1140" width="600" height="337">');
		expect(body).toContain('alt="iPhone 13, part 1 of 3" width="600" height="8205">');
		expect(body).toContain('alt="iPhone 13, part 3 of 3" width="600" height="2193">');
		expect(body.match(/<img [^>]*>/gv).every(tag => /width="\d+" height="\d+"/v.test(tag))).toBe(true);
	});

	it('shows no footer without commit and run information', () => {
		expect(body).not.toContain('<sub>');
	});
});

describe('parts', () => {
	const body = renderComment(uploaded, files);

	it('groups the parts of a capture under one accordion with the part count', () => {
		expect(body).toContain('<summary><b>iPhone 13</b> · 1,170 × 20,276 px · 3 parts · 4.0 MB · part 2 failed to upload</summary>');
		expect(count(body, '<b>iPhone 13</b>')).toBe(1);
	});

	it('lists the links with part numbers out of the known part count', () => {
		expect(body).toContain('- part 1 of 3: https://x/p1\n- part 3 of 3: https://x/p3\n');
		expect(body).not.toContain('part 2 of 3');
	});

	it('puts the images of one capture directly next to each other, in part order', () => {
		expect(body).toMatch(/alt="iPhone 13, part 1 of 3"[^>]*><img [^>]*alt="iPhone 13, part 3 of 3"/v);
	});

	it('orders parts by number, not by text', () => {
		const names = Array.from({length: 11}, (_, index) => `a-part${index + 1}.jpeg`);
		const result = renderComment(
			names.toReversed().map(name => entry(name, `https://x/${name}`)),
			names,
		);
		const positions = names.map(name => result.indexOf(`<img src="https://x/${name}"`));
		expect(positions).toEqual(positions.toSorted((a, b) => a - b));
		expect(result).toContain('11 parts');
	});

	it('names every part that failed to upload, also the last one, and nothing when complete', () => {
		const partFiles = ['a-part1.jpeg', 'a-part2.jpeg', 'a-part3.jpeg', 'a-part4.jpeg'];
		const failed = renderComment([entry(partFiles[0], 'https://x/1')], partFiles);
		expect(failed).toContain('4 parts · 1 KB · parts 2, 3, 4 failed to upload');
		const complete = renderComment(
			partFiles.map((file, index) => entry(file, `https://x/${index}`)),
			partFiles,
		);
		expect(complete).not.toContain('failed to upload');
	});

	it('keeps the failed part note for the other groupings', () => {
		const allBody = renderComment(uploaded, files, {groupBy: 'all'});
		expect(allBody).toContain('> [!WARNING]\n> iPhone 13: part 2 failed to upload\n');
		const noneBody = renderComment(uploaded, files, {groupBy: 'none'});
		expect(noneBody).toContain('> iPhone 13: part 2 failed to upload');
		// The capture grouping already says it in the summary
		expect(body).not.toContain('[!WARNING]');
	});

	it('warns about a capture of which nothing was uploaded', () => {
		const result = renderComment(
			[entry('a.jpeg', 'https://x/a')],
			['a.jpeg', 'iPhone_13-part1-abc1234.jpeg', 'iPhone_13-part2-abc1234.jpeg'],
		);
		expect(result).toContain('> [!WARNING]\n> iPhone 13: failed to upload\n');
	});

	it('returns an empty string when nothing was uploaded', () => {
		expect(renderComment([], files)).toBe('');
	});
});

describe('every layout x open x group-by', () => {
	const layouts = ['details', 'inline', 'links'];
	const opens = ['none', 'first', 'all'];
	const groupBys = ['capture', 'all', 'none'];
	// Groups for the 4 captures / 5 uploaded images of the fixture
	const groupCount = {capture: 4, all: 1, none: 5};

	for (const layout of layouts) {
		for (const open of opens) {
			for (const groupBy of groupBys) {
				describe(`${layout} / open ${open} / group by ${groupBy}`, () => {
					const body = renderComment(uploaded, files, {layout, open, groupBy});

					it('always carries the marker once, first', () => {
						expect(body.startsWith('<!-- screenshots-ci-action:screenshots -->\n')).toBe(true);
						expect(count(body, 'screenshots-ci-action:')).toBe(1);
					});

					it('embeds images only unless the layout is links', () => {
						expect(count(body, '<img ')).toBe(layout === 'links' ? 0 : 5);
					});

					it('uses accordions only for the details layout', () => {
						const details = count(body, '<details');
						expect(details).toBe(layout === 'details' ? groupCount[groupBy] : 0);
						expect(count(body, '</details>')).toBe(details);
					});

					it('opens the accordions as asked', () => {
						const opened = count(body, '<details open>');
						if (layout !== 'details' || open === 'none') {
							expect(opened).toBe(0);
						} else if (open === 'first') {
							expect(opened).toBe(1);
							expect(body.indexOf('<details open>')).toBe(body.indexOf('<details'));
						} else {
							expect(opened).toBe(groupCount[groupBy]);
						}
					});

					it('links every uploaded image', () => {
						for (const {url} of uploaded) {
							expect(body).toContain(url);
						}
					});
				});
			}
		}
	}

	it('renders inline groups as headings', () => {
		const body = renderComment(uploaded, files, {layout: 'inline'});
		expect(count(body, '#### ')).toBe(4);
		expect(body).toContain('#### Desktop 540 · 540 × 405 px · 1 KB\n\n- https://x/d540\n\n<img ');
	});

	it('names a single accordion with everything and lists the captures inside', () => {
		const body = renderComment(uploaded, files, {groupBy: 'all', open: 'first'});
		expect(body).toContain('<details open>\n<summary><b>All captures</b> · 4 captures · 5 images · 4.0 MB</summary>');
		expect(body).toContain('**iPhone 13** · 1,170 × 20,276 px · 3 parts · part 2 failed to upload');
		expect(body).toContain('**Desktop 540** · 540 × 405 px');
	});

	it('gives every image its own accordion with its own size', () => {
		const body = renderComment(uploaded, files, {groupBy: 'none'});
		expect(body).toContain('<summary><b>iPhone 13 · part 1 of 3</b> · 1,170 × 16,000 px · 3.0 MB</summary>');
		expect(body).toContain('<summary><b>iPhone 13 · part 3 of 3</b> · 1,170 × 4,276 px · 1.0 MB</summary>');
	});

	it('renders the links layout as a list', () => {
		const body = renderComment(uploaded, files, {layout: 'links'});
		expect(body).toContain('- **Desktop 540** · 540 × 405 px · 1 KB: [image](https://x/d540)\n');
		expect(body).toContain('[part 1 of 3](https://x/p1) · [part 3 of 3](https://x/p3)');
		const all = renderComment(uploaded, files, {layout: 'links', groupBy: 'all'});
		expect(all).toContain('- **All captures** · 4 captures · 5 images · 4.0 MB\n  - **Desktop 540**: [image](https://x/d540)\n');
	});
});

describe('image width', () => {
	it('omits width and height with 0', () => {
		const body = renderComment(uploaded, files, {imageWidth: 0});
		expect(body).not.toContain('width=');
		expect(body).not.toContain('height=');
		// The pixel size stays in the summary
		expect(body).toContain('540 × 405 px');
	});

	it('uses the given width as the limit', () => {
		const body = renderComment(uploaded, files, {imageWidth: 300});
		expect(body).toContain('alt="Desktop 540" width="300" height="225">');
	});

	it('leaves the size out for images of unknown size', () => {
		const body = renderComment(
			[entry('a.jpeg', 'https://x/a')],
			['a.jpeg'],
		);
		expect(body).toContain('<img src="https://x/a" alt="a">');
		expect(body).toContain('<summary><b>a</b> · 1 KB</summary>');
	});

	it('gets close to the former plain comment with inline, no width and no footer (heading and marker differ)', () => {
		const body = renderComment(
			[entry('iPhone_13-abc1234.jpeg', 'https://x/b.jpeg')],
			['iPhone_13-abc1234.jpeg'],
			{layout: 'inline', imageWidth: 0, headline: 'Screenshots'},
		);
		expect(body).toBe(
			'<!-- screenshots-ci-action:screenshots -->\n### Screenshots\n\n#### iPhone 13 · 1 KB\n\n- https://x/b.jpeg\n\n<img src="https://x/b.jpeg" alt="iPhone 13">\n\n',
		);
	});
});

describe('image height', () => {
	it('puts only the width with none', () => {
		const body = renderComment(uploaded, files, {imageHeight: 'none'});
		expect(body).toContain('alt="Desktop 540" width="540">');
		expect(body).toContain('alt="iPhone 13, part 1 of 3" width="600">');
		expect(body).not.toContain('height=');
	});

	it('puts both with auto-ratio and by default', () => {
		for (const options of [{}, {imageHeight: 'auto-ratio'}]) {
			expect(renderComment(uploaded, files, options)).toContain('alt="Desktop 540" width="540" height="405">');
		}
	});

	it('still has no attributes at all with a width of 0', () => {
		expect(renderComment(uploaded, files, {imageWidth: 0, imageHeight: 'none'})).not.toContain('width=');
	});
});

describe('narrow parts', () => {
	const partFiles = ['a-part1.jpeg', 'a-part2.jpeg'];
	const parts = width => partFiles.map(name => entry(name, `https://x/${name}`, 1024, {width, height: 1000}));

	it('stacks parts that would sit side by side with a line break', () => {
		const body = renderComment(parts(1000), partFiles, {imageWidth: 300});
		expect(body).toMatch(/width="300" height="300"><br><img /v);
		const natural = renderComment(parts(375), partFiles);
		expect(natural).toContain('><br><img ');
	});

	it('puts nothing between wide parts, so they read as one page', () => {
		const body = renderComment(parts(1000), partFiles, {imageWidth: 600});
		expect(body).not.toContain('<br>');
		expect(body).toContain('><img ');
		expect(renderComment(parts(1000), partFiles, {imageWidth: 0})).not.toContain('<br>');
	});

	it('does not break a single image', () => {
		expect(renderComment([entry('a.jpeg', 'https://x/a', 1024, {width: 300, height: 10})], ['a.jpeg'])).not.toContain('<br>');
	});
});

describe('buildCommentBody', () => {
	const many = Array.from({length: 40}, (_, index) => `d${String(index).padStart(2, '0')}-abc1234.jpeg`);
	const manyEntries = many.map(name => entry(name, `https://example.com/${'x'.repeat(100)}/${name}`, 2048, {width: 800, height: 600}));

	it('returns the normal body when it fits, without warnings', () => {
		const result = buildCommentBody(uploaded, files, {layout: 'details'});
		expect(result.body).toBe(renderComment(uploaded, files, {layout: 'details'}));
		expect(result.warnings).toEqual([]);
	});

	it('returns an empty body when nothing was uploaded', () => {
		expect(buildCommentBody([], files, {})).toEqual({body: '', warnings: []});
	});

	it('uses the default limit of 65000 characters', () => {
		expect(MAX_COMMENT_LENGTH).toBe(65_000);
	});

	it('falls back to links when the body is too long', () => {
		const full = renderComment(manyEntries, many, {layout: 'details'});
		const links = renderComment(manyEntries, many, {layout: 'links'});
		const limit = Math.floor((full.length + links.length) / 2);
		const result = buildCommentBody(manyEntries, many, {layout: 'details'}, limit);
		expect(result.body).toBe(links);
		expect(result.body).not.toContain('<img');
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('only links');
	});

	it('cuts the list with "...and N more" when even the links are too long', () => {
		const links = renderComment(manyEntries, many, {layout: 'links'});
		const limit = Math.floor(links.length / 2);
		const result = buildCommentBody(manyEntries, many, {layout: 'inline'}, limit);
		expect(result.body.length).toBeLessThanOrEqual(limit);
		expect(result.body).toMatch(/…and \d+ more images not shown/v);
		expect(result.body).not.toContain('failed to upload');
		expect(result.body.startsWith('<!-- screenshots-ci-action:screenshots -->\n')).toBe(true);
		expect(result.warnings).toHaveLength(2);
		expect(result.warnings[1]).toContain(' of 40 images are not listed');
		// The count in the text is the number that is really missing
		const shown = (result.body.match(/\]\(https/gv) ?? []).length;
		const omitted = Number(/…and (?<count>\d+) more/v.exec(result.body).groups.count);
		expect(shown + omitted).toBe(40);
	});

	it('cuts the list for the links layout too', () => {
		const result = buildCommentBody(manyEntries, many, {layout: 'links'}, 2000);
		expect(result.body.length).toBeLessThanOrEqual(2000);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toContain('links alone');
	});

	it('never exceeds the limit, even when nothing fits', () => {
		const result = buildCommentBody(manyEntries, many, {headline: 'h'.repeat(500)}, 300);
		expect(result.body.length).toBeLessThanOrEqual(300);
	});

	it('shows a failed capture note among the images that remain', () => {
		const partFiles = ['a-part1.jpeg', 'a-part2.jpeg', ...many];
		const result = buildCommentBody([entry('a-part1.jpeg', 'https://x/a1'), ...manyEntries], partFiles, {}, 3000);
		expect(result.body).toContain('part 2 failed to upload');
	});
});

describe('headline, tag and footer', () => {
	it('uses the headline and the tag', () => {
		const body = renderComment(uploaded, files, {headline: 'Preview', tag: 'preview'});
		expect(body.startsWith('<!-- screenshots-ci-action:preview -->\n### Preview\n\n')).toBe(true);
	});

	it('renders the commit and the workflow run', () => {
		const body = renderComment(uploaded, files, {footer: {sha: 'abcdef1234567890', runUrl: 'https://github.com/o/r/actions/runs/7'}});
		expect(body.endsWith('<sub>Commit abcdef1 · [workflow run](https://github.com/o/r/actions/runs/7)</sub>\n')).toBe(true);
	});

	it('renders what it has of the footer', () => {
		expect(renderComment(uploaded, files, {footer: {sha: 'abcdef1234567'}}).endsWith('<sub>Commit abcdef1</sub>\n')).toBe(true);
		expect(renderComment(uploaded, files, {footer: {runUrl: 'https://r'}}).endsWith('<sub>[workflow run](https://r)</sub>\n')).toBe(true);
		expect(renderComment(uploaded, files, {footer: {}})).not.toContain('<sub>');
		expect(renderComment(uploaded, files, {footer: null})).not.toContain('<sub>');
	});
});

describe('escaping', () => {
	it('escapes HTML in the headline, names and urls', () => {
		const nasty = ['<b onclick="x">&-abc1234.jpeg'];
		const body = renderComment(
			[entry(nasty[0], 'https://x/a"onload="y', 1024, {width: 10, height: 10})],
			nasty,
			{headline: '<script>alert("1")</script> & more'},
		);
		expect(body).toContain('### &lt;script&gt;alert(&quot;1&quot;)&lt;/script&gt; &amp; more\n');
		expect(body).toContain('<summary><b>&lt;b onclick=&quot;x&quot;&gt;&amp;</b>');
		expect(body).toContain('src="https://x/a&quot;onload=&quot;y"');
		expect(body).not.toContain('<script>');
		expect(body).not.toContain('<b onclick');
	});

	it('escapes the labels in the links layout and warnings too', () => {
		const names = ['<i>-part1.jpeg', '<i>-part2.jpeg'];
		const body = renderComment(
			[entry(names[0], 'https://x/1')],
			names,
			{layout: 'links', groupBy: 'none'},
		);
		expect(body).toContain('**&lt;i&gt; · part 1 of 2**');
		expect(body).toContain('> &lt;i&gt;: part 2 failed to upload');
	});
});

describe('mixing parts and single images', () => {
	it('keeps the single images in url order within their captures', () => {
		const mixed = ['a-part1.png', 'a-part2.png', 'b.png'];
		const body = renderComment(
			[
				entry(mixed[0], 'https://x/a1'),
				entry(mixed[1], 'https://x/a2'),
				entry(mixed[2], 'https://x/b'),
			],
			mixed,
		);
		expect(count(body, '<details>')).toBe(2);
		expect(body.indexOf('https://x/a1')).toBeLessThan(body.indexOf('https://x/b'));
	});
});
