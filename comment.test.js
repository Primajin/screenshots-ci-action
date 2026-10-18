import {describe, expect, it} from 'vitest';
import {
	GITHUB_MAX_IMAGE_HEIGHT,
	MAX_COMMENT_LENGTH,
	buildCommentBody,
	captureLabel,
	commentMarker,
	displaySize,
	formatBytes,
	mergeSection,
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

	it('shows the size, the scale and mobile of a custom size', () => {
		expect(captureLabel('size1440x900-abc1234.jpeg')).toBe('Size 1,440 × 900');
		expect(captureLabel('size1440x900-2x-abc1234.jpeg')).toBe('Size 1,440 × 900 @2x');
		expect(captureLabel('size390x844-3x-mobile-abc1234.png')).toBe('Size 390 × 844 @3x, mobile');
		expect(captureLabel('size390x844-mobile-1760000000000.jpeg')).toBe('Size 390 × 844, mobile');
		expect(captureLabel('size800x600-1.5x.png')).toBe('Size 800 × 600 @1.5x');
	});

	it('leaves a device that only starts with size alone', () => {
		expect(captureLabel('size_chart-abc1234.jpeg')).toBe('size chart');
	});
});

describe('custom sizes in the comment', () => {
	const names = ['iPhone_13-abc1234.jpeg', 'size390x844-3x-mobile-abc1234.jpeg', 'size1440x900-abc1234.jpeg', 'desktopPage540x405-abc1234.jpeg'];
	const items = names.map(name => entry(name, `https://x/${name}`, 1024, {width: 100, height: 100}));

	it('sorts desktop sizes first, then the custom sizes, then the devices', () => {
		const body = renderComment(items, names);
		const order = ['Desktop 540', 'Size 390 × 844 @3x, mobile', 'Size 1,440 × 900', 'iPhone 13'].map(label => body.indexOf(`<b>${label}</b>`));
		expect(order.every(position => position > 0)).toBe(true);
		expect(order).toEqual(order.toSorted((a, b) => a - b));
	});

	it('orders the custom sizes by width, height, scale and mobile, whatever the commit hash says', () => {
		// The hashes are in the opposite order of what is expected
		const sizes = [
			'size1440x900-2x-mobile-aaaaaaa.jpeg',
			'size1440x900-2x-bbbbbbb.jpeg',
			'size1440x900-ccccccc.jpeg',
			'size1440x900-mobile-ddddddd.jpeg',
			'size390x844-3x-mobile-eeeeeee.jpeg',
			'size390x844-fffffff.jpeg',
			'size390x1000-0000001.jpeg',
			'size1280x720-1.5x-0000002.jpeg',
		];
		const body = renderComment(sizes.map(name => entry(name, `https://x/${name}`, 1024, {width: 10, height: 10})), sizes);
		const labels = [
			'Size 390 × 844',
			'Size 390 × 844 @3x, mobile',
			'Size 390 × 1,000',
			'Size 1,280 × 720 @1.5x',
			'Size 1,440 × 900',
			'Size 1,440 × 900, mobile',
			'Size 1,440 × 900 @2x',
			'Size 1,440 × 900 @2x, mobile',
		];
		const positions = labels.map(label => body.indexOf(`<b>${label}</b>`));
		expect(positions.every(position => position > 0), positions.join(',')).toBe(true);
		expect(positions).toEqual(positions.toSorted((a, b) => a - b));
	});

	it('keeps the parts of a custom size together', () => {
		const parts = ['size390x844-3x-part1-abc1234.jpeg', 'size390x844-3x-part2-abc1234.jpeg'];
		const body = renderComment(parts.map(name => entry(name, `https://x/${name}`)), parts);
		expect(body).toContain('<summary><b>Size 390 × 844 @3x</b> · 2 parts');
		expect(count(body, '<details>')).toBe(1);
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

	it('puts width and height on every image that GitHub keeps them for', () => {
		expect(count(body, '<img ')).toBe(5);
		expect(body).toContain('alt="Desktop 540" width="540" height="405">');
		expect(body).toContain('alt="Desktop 1140" width="600" height="337">');
		expect(body).toContain('alt="iPad Pro 11" width="600" height="859">');
		// Parts are far taller than 2000 pixels: only the width (see the tall page tests)
		expect(body).toContain('alt="iPhone 13, part 1 of 3" width="600">');
		expect(body).toContain('alt="iPhone 13, part 3 of 3" width="600">');
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
		expect(body).toContain('- [part 1 of 3: open full size](https://x/p1)\n- [part 3 of 3: open full size](https://x/p3)\n');
		expect(body).not.toContain('part 2 of 3');
	});

	it('stacks the images of one capture with a line break between them, in part order', () => {
		expect(body).toMatch(/alt="iPhone 13, part 1 of 3"[^>]*><br><img [^>]*alt="iPhone 13, part 3 of 3"/v);
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

					it('never writes a height above what GitHub keeps', () => {
						for (const [, height] of body.matchAll(/height="(?<height>\d+)"/gv)) {
							expect(Number(height)).toBeLessThanOrEqual(2000);
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
		expect(body).toContain('#### Desktop 540 · 540 × 405 px · 1 KB\n\n- [open full size](https://x/d540)\n\n<img ');
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
			'<!-- screenshots-ci-action:screenshots -->\n### Screenshots\n\n#### iPhone 13 · 1 KB\n\n- [open full size](https://x/b.jpeg)\n\n<img src="https://x/b.jpeg" alt="iPhone 13">\n\n',
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

describe('tall pages (parts)', () => {
	// The iPad Pro 11 capture of the CI scenario: 1668 x 16000, 16000 and 8552
	const tallFiles = ['iPad_Pro_11-part1-abc1234.jpeg', 'iPad_Pro_11-part2-abc1234.jpeg', 'iPad_Pro_11-part3-abc1234.jpeg'];
	const tall = tallFiles.map((name, index) => entry(name, `https://x/${index + 1}`, 1024, {width: 1668, height: index === 2 ? 8552 : 16_000}));
	const imgTags = body => body.match(/<img [^>]*>/gv);
	const widths = body => imgTags(body).map(tag => Number(/width="(?<width>\d+)"/v.exec(tag).groups.width));

	it('shows every part at the full display width, with the height left to the browser', () => {
		const body = renderComment(tall, tallFiles);
		expect(imgTags(body)).toHaveLength(3);
		for (const tag of imgTags(body)) {
			expect(tag).toContain(' width="600"');
			// GitHub would cut a height above 2000 and shrink the width with it
			expect(tag).not.toContain('height=');
		}

		expect(body).not.toMatch(/height="\d{4,}"/v);
	});

	it('never makes a part narrower than the first because of its height', () => {
		for (const options of [{}, {imageWidth: 300}, {imageWidth: 1000}, {imageWidth: 5000}, {layout: 'inline'}, {groupBy: 'none'}, {groupBy: 'all'}]) {
			const sizes = widths(renderComment(tall, tallFiles, options));
			expect(new Set(sizes).size).toBe(1);
			expect(Math.min(...sizes)).toBe(Math.min(1668, options.imageWidth ?? 600));
		}
	});

	it('keeps an explicit height for parts that stay within what GitHub keeps', () => {
		const short = tallFiles.map((name, index) => entry(name, `https://x/${index}`, 1024, {width: 1200, height: 3000}));
		const body = renderComment(short, tallFiles);
		expect(body).toContain('width="600" height="1500"');
		expect(body).not.toContain('width="600">');
		// 6000 high at 600 wide would be 3000 > 2000
		const tallBody = renderComment(tall, tallFiles, {imageWidth: 1000});
		expect(tallBody).not.toContain('height=');
	});

	it('uses the GitHub limit exactly: 2000 keeps the height, 2001 does not', () => {
		const at = height => renderComment([entry('a.jpeg', 'https://x/a', 1024, {width: 600, height})], ['a.jpeg']);
		expect(GITHUB_MAX_IMAGE_HEIGHT).toBe(2000);
		expect(at(2000)).toContain('width="600" height="2000">');
		expect(at(2001)).toContain('width="600">');
	});

	it('puts a line break between consecutive parts, always, and nothing else', () => {
		for (const options of [{}, {imageWidth: 0}, {imageWidth: 300}, {imageWidth: 1000}, {imageHeight: 'none'}, {layout: 'inline'}]) {
			const body = renderComment(tall, tallFiles, options);
			expect(count(body, '<br>')).toBe(2);
			expect(body).toMatch(/><br><img [^>]*><br><img /v);
			expect(body).not.toMatch(/>\s+<img /v);
		}
	});

	it('breaks between N parts N-1 times and not at all for a single image', () => {
		for (const parts of [2, 5, 11]) {
			const names = Array.from({length: parts}, (_, index) => `b-part${index + 1}.jpeg`);
			const body = renderComment(names.map(name => entry(name, `https://x/${name}`, 1024, {width: 1000, height: 9000})), names);
			expect(count(body, '<br>')).toBe(parts - 1);
		}

		expect(renderComment([entry('a.jpeg', 'https://x/a', 1024, {width: 300, height: 10})], ['a.jpeg'])).not.toContain('<br>');
	});

	it('breaks between the parts of every capture of a single accordion, not between captures', () => {
		const other = tall.map(item => ({...item, fileName: item.fileName.replace('iPad_Pro_11', 'Tab')}));
		const body = renderComment([...other, ...uploaded], [...other.map(item => item.fileName), ...files], {groupBy: 'all'});
		expect(count(body, '<br>')).toBe(3);
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

describe('mergeSection', () => {
	const frame = {headline: 'Showcase', footer: '<sub>Commit abc1234</sub>\n'};
	const marker = '<!-- screenshots-ci-action:showcase -->';
	const start = slug => `<!-- screenshots-ci-action:showcase:section:${slug} -->`;
	const end = slug => `<!-- /screenshots-ci-action:showcase:section:${slug} -->`;
	const block = (slug, content) => `${start(slug)}\n${content}\n${end(slug)}\n\n`;

	it('builds the whole comment when there is no previous body', () => {
		const expected = `${marker}\n### Showcase\n\n${block('desktop-light', 'LIGHT')}<sub>Commit abc1234</sub>\n`;
		expect(mergeSection(undefined, 'showcase', 'desktop-light', 'LIGHT\n\n', frame)).toBe(expected);
		expect(mergeSection('', 'showcase', 'desktop-light', 'LIGHT', frame)).toBe(expected);
	});

	it('adds a section after the existing ones and leaves them byte for byte as they were', () => {
		const first = mergeSection(undefined, 'showcase', 'desktop-light', '<details>\nLIGHT\n</details>\n', frame);
		const second = mergeSection(first, 'showcase', 'desktop-dark', 'DARK', frame);
		expect(second).toBe(`${marker}\n### Showcase\n\n${block('desktop-light', '<details>\nLIGHT\n</details>')}${block('desktop-dark', 'DARK')}<sub>Commit abc1234</sub>\n`);
		expect(second.indexOf('LIGHT')).toBeLessThan(second.indexOf('DARK'));
	});

	it('replaces its own section where it is, so the order is the order of first insertion', () => {
		let body;
		for (const [slug, content] of [['a', 'A1'], ['b', 'B1'], ['c', 'C1']]) {
			body = mergeSection(body, 'showcase', slug, content, frame);
		}

		const updated = mergeSection(body, 'showcase', 'a', 'A2', frame);
		expect(updated).toBe(`${marker}\n### Showcase\n\n${block('a', 'A2')}${block('b', 'B1')}${block('c', 'C1')}<sub>Commit abc1234</sub>\n`);
		expect(mergeSection(updated, 'showcase', 'b', 'B2', frame))
			.toBe(`${marker}\n### Showcase\n\n${block('a', 'A2')}${block('b', 'B2')}${block('c', 'C1')}<sub>Commit abc1234</sub>\n`);
	});

	it('is idempotent for the same section', () => {
		const once = mergeSection(mergeSection(undefined, 'showcase', 'a', 'A', frame), 'showcase', 'b', 'B', frame);
		expect(mergeSection(once, 'showcase', 'b', 'B', frame)).toBe(once);
	});

	it('takes the headline and the footer from the latest call, and may drop the footer', () => {
		const first = mergeSection(undefined, 'showcase', 'a', 'A', frame);
		const second = mergeSection(first, 'showcase', 'b', 'B', {headline: 'New <headline>'});
		expect(second.startsWith(`${marker}\n### New &lt;headline&gt;\n\n`)).toBe(true);
		expect(second).not.toContain('<sub>');
		expect(second).toContain(block('a', 'A'));
	});

	it('keeps sections whose content has blank lines, markdown and html', () => {
		const content = '<details open>\n<summary><b>x</b></summary>\n\n- [open](https://x/1)\n\n<img src="https://x/1">\n\n</details>';
		const merged = mergeSection(mergeSection(undefined, 'showcase', 'a', content, frame), 'showcase', 'b', 'B', frame);
		expect(merged).toContain(block('a', content));
	});

	it('ignores sections of another tag', () => {
		const other = '<!-- screenshots-ci-action:other -->\n### X\n\n<!-- screenshots-ci-action:other:section:a -->\nOTHER\n<!-- /screenshots-ci-action:other:section:a -->\n\n';
		const merged = mergeSection(other, 'showcase', 'b', 'B', frame);
		expect(merged).not.toContain('OTHER');
		expect(merged).toContain(block('b', 'B'));
	});

	it('starts over for a previous comment that has no sections (the tag was used without a section before)', () => {
		const old = `${marker}\n### Screenshots\n\n<details>\nOLD\n</details>\n\n<sub>Commit 1111111</sub>\n`;
		const merged = mergeSection(old, 'showcase', 'a', 'A', frame);
		expect(merged).not.toContain('OLD');
		expect(merged).toBe(`${marker}\n### Showcase\n\n${block('a', 'A')}<sub>Commit abc1234</sub>\n`);
	});

	it('does not keep a section whose end marker is missing or whose slug is not a slug', () => {
		const damaged = `${marker}\n### X\n\n${start('a')}\nA\n\n<!-- screenshots-ci-action:showcase:section:b c -->\nBAD\n<!-- /screenshots-ci-action:showcase:section:b c -->\n\n${block('d', 'D')}`;
		const merged = mergeSection(damaged, 'showcase', 'e', 'E', frame);
		expect(merged).toBe(`${marker}\n### Showcase\n\n${block('d', 'D')}${block('e', 'E')}<sub>Commit abc1234</sub>\n`);
	});

	it('keeps only the first of two sections with the same slug, a comment edited by hand', () => {
		const duplicated = `${marker}\n### X\n\n${block('a', 'FIRST')}${block('b', 'B')}${block('a', 'SECOND')}`;
		const merged = mergeSection(duplicated, 'showcase', 'c', 'C', frame);
		expect(merged).toBe(`${marker}\n### Showcase\n\n${block('a', 'FIRST')}${block('b', 'B')}${block('c', 'C')}<sub>Commit abc1234</sub>\n`);
		const replaced = mergeSection(duplicated, 'showcase', 'a', 'NEW', frame);
		expect(replaced).toBe(`${marker}\n### Showcase\n\n${block('a', 'NEW')}${block('b', 'B')}<sub>Commit abc1234</sub>\n`);
		expect(replaced).not.toContain('SECOND');
	});

	it('works for a tag with spaces and dots', () => {
		const first = mergeSection(undefined, 'my tag.v2', 'a', 'A', frame);
		expect(first).toContain('<!-- screenshots-ci-action:my tag.v2:section:a -->');
		expect(mergeSection(first, 'my tag.v2', 'b', 'B', frame)).toContain('A\n<!-- /screenshots-ci-action:my tag.v2:section:a -->');
	});

	it('works for slugs in other languages', () => {
		const first = mergeSection(undefined, 'showcase', 'dunkel-übersicht', 'A', frame);
		expect(mergeSection(first, 'showcase', 'dunkel-übersicht', 'B', frame)).toBe(`${marker}\n### Showcase\n\n${block('dunkel-übersicht', 'B')}<sub>Commit abc1234</sub>\n`);
	});
});

describe('renderComment with a section', () => {
	const section = {name: 'Desktop · light theme', slug: 'desktop-light-theme'};
	const sectionStart = '<!-- screenshots-ci-action:screenshots:section:desktop-light-theme -->';
	const sectionEnd = '<!-- /screenshots-ci-action:screenshots:section:desktop-light-theme -->';
	const desktop = ['desktopPage1440x900-abc1234.png'];
	const oneCapture = [entry(desktop[0], 'https://x/d1440', 2048, {width: 1440, height: 900})];

	it('wraps one group titled with the section name in the markers, below the shared headline', () => {
		const body = renderComment(oneCapture, desktop, {section});
		expect(body.startsWith('<!-- screenshots-ci-action:screenshots -->\n### Screenshots\n\n' + sectionStart + '\n<details>\n')).toBe(true);
		expect(body).toContain('<summary><b>Desktop · light theme</b> · 1,440 × 900 px · 2 KB</summary>');
		expect(body).toContain(`</details>\n${sectionEnd}\n\n`);
		expect(count(body, '<details')).toBe(1);
	});

	it('shows one group for several captures, whatever comment-group-by says', () => {
		for (const groupBy of ['capture', 'all', 'none']) {
			const body = renderComment(uploaded, files, {section, groupBy});
			expect(count(body, '<details'), groupBy).toBe(1);
			expect(body, groupBy).toContain('<summary><b>Desktop · light theme</b> · 4 captures · 5 images · ');
			expect(body, groupBy).toContain('**Desktop 540** · 540 × 405 px');
			expect(body, groupBy).toContain('**iPhone 13**');
		}
	});

	it('lists a capture of one tall page with its parts and its failures in the summary', () => {
		const tall = files.slice(2, 5);
		const body = renderComment([entry(tall[0], 'https://x/1', 1024, {width: 390, height: 16_000}), entry(tall[2], 'https://x/3', 1024, {width: 390, height: 4000})], tall, {section});
		expect(body).toContain('<summary><b>Desktop · light theme</b> · 390 × 20,000 px · 3 parts · 2 KB · part 2 failed to upload</summary>');
		expect(body).not.toContain('> [!WARNING]');
	});

	it('puts failed uploads of several captures into the section, before its end marker', () => {
		const body = renderComment(uploaded, files, {section});
		expect(body).toContain('> [!WARNING]');
		expect(body.indexOf('> [!WARNING]')).toBeLessThan(body.indexOf(sectionEnd));
	});

	it('applies comment-open within the call: first and all open the section, none keeps it closed', () => {
		expect(renderComment(oneCapture, desktop, {section, open: 'first'})).toContain('<details open>');
		expect(renderComment(oneCapture, desktop, {section, open: 'all'})).toContain('<details open>');
		expect(renderComment(oneCapture, desktop, {section, open: 'none'})).not.toContain('<details open');
		expect(count(renderComment(uploaded, files, {section, open: 'all'}), '<details open>')).toBe(1);
	});

	it('supports the inline and links layouts', () => {
		const inline = renderComment(oneCapture, desktop, {section, layout: 'inline'});
		expect(inline).toContain('#### Desktop · light theme · 1,440 × 900 px · 2 KB');
		expect(inline).toContain('<img ');
		const links = renderComment(uploaded, files, {section, layout: 'links'});
		expect(links).not.toContain('<img');
		expect(links).toContain('- **Desktop · light theme** · ');
		expect(links.indexOf(sectionStart)).toBeLessThan(links.indexOf(sectionEnd));
	});

	it('escapes the section name', () => {
		const body = renderComment(oneCapture, desktop, {section: {name: '<script>"x"&', slug: 'script-x'}});
		expect(body).toContain('<summary><b>&lt;script&gt;&quot;x&quot;&amp;</b>');
		expect(body).not.toContain('<script>');
	});

	it('merges into the previous body: the other sections stay, this one is replaced in place', () => {
		const dark = {name: 'Desktop · dark theme', slug: 'desktop-dark-theme'};
		const darkFiles = ['desktopPage1440x900-abc1234.png'];
		const first = renderComment(oneCapture, desktop, {section});
		const second = renderComment(
			[entry(darkFiles[0], 'https://x/dark', 1024, {width: 1440, height: 900})],
			darkFiles,
			{section: dark, previousBody: first},
		);
		expect(second.indexOf('Desktop · light theme')).toBeLessThan(second.indexOf('Desktop · dark theme'));
		expect(second).toContain('https://x/d1440');
		expect(second).toContain('https://x/dark');
		expect(count(second, '<details')).toBe(2);

		const third = renderComment(
			[entry(desktop[0], 'https://x/d1440-new', 4096, {width: 1440, height: 900})],
			desktop,
			{section, previousBody: second},
		);
		expect(third).not.toContain('https://x/d1440"');
		expect(third).toContain('https://x/d1440-new');
		expect(third).toContain('https://x/dark');
		expect(third.indexOf('Desktop · light theme')).toBeLessThan(third.indexOf('Desktop · dark theme'));
		expect(count(third, '<details')).toBe(2);
	});

	it('puts the footer once, after the last section', () => {
		const footer = {sha: 'abcdef1234567', runUrl: 'https://github.com/o/r/actions/runs/1'};
		const first = renderComment(oneCapture, desktop, {section, footer});
		const second = renderComment(oneCapture, desktop, {section: {name: 'B', slug: 'b'}, previousBody: first, footer});
		expect(count(second, '<sub>')).toBe(1);
		expect(second.trimEnd().endsWith('</sub>')).toBe(true);
	});

	it('does not render a section for nothing', () => {
		expect(renderComment([], desktop, {section})).toBe('');
	});

	it('renders as before without a section', () => {
		const plain = renderComment(uploaded, files);
		expect(plain).not.toContain(':section:');
		expect(renderComment(uploaded, files, {section: null})).toBe(plain);
	});
});

describe('buildCommentBody with a section', () => {
	const bigFiles = Array.from({length: 40}, (_, index) => `iPhone_${index}-abc1234.jpeg`);
	const bigUploaded = bigFiles.map(name => entry(name, `https://x/${name}`, 1024, {width: 300, height: 600}));
	const other = {name: 'Other', slug: 'other'};
	const mine = {name: 'Mine', slug: 'mine'};
	const otherFiles = ['desktopPage1440x900-abc1234.png'];
	const previousBody = renderComment([entry(otherFiles[0], 'https://x/other-image', 1024, {width: 1440, height: 900})], otherFiles, {section: other});

	it('merges without warnings when the comment fits', () => {
		const {body, warnings} = buildCommentBody(bigUploaded.slice(0, 2), bigFiles.slice(0, 2), {section: mine, previousBody});
		expect(warnings).toEqual([]);
		expect(body).toContain('https://x/other-image');
		expect(body).toContain('<!-- screenshots-ci-action:screenshots:section:mine -->');
	});

	it('turns only its own section into links when the merged comment is too long', () => {
		const full = renderComment(bigUploaded, bigFiles, {section: mine, previousBody});
		const limit = full.length - 100;
		const {body, warnings} = buildCommentBody(bigUploaded, bigFiles, {section: mine, previousBody}, limit);
		expect(body.length).toBeLessThanOrEqual(limit);
		expect(warnings[0]).toContain('The section "Mine" makes the comment');
		expect(warnings[0]).toContain('only links instead of the images for this section');
		// The other section is untouched, with its image
		expect(body).toContain('<img src="https://x/other-image"');
		expect(count(body, '<img ')).toBe(1);
		expect(body).toContain('- **Mine** · ');
		expect(body.indexOf('Other')).toBeLessThan(body.indexOf('Mine'));
	});

	it('cuts the list of its own section when even the links do not fit, and keeps the other section', () => {
		const links = renderComment(bigUploaded, bigFiles, {section: mine, previousBody, layout: 'links'});
		const limit = links.length - 200;
		const {body, warnings} = buildCommentBody(bigUploaded, bigFiles, {section: mine, previousBody}, limit);
		expect(body.length).toBeLessThanOrEqual(limit);
		expect(warnings.some(message => message.includes('images are not listed'))).toBe(true);
		expect(body).toContain('…and ');
		expect(body).toContain('https://x/other-image');
		expect(body).toContain('<!-- /screenshots-ci-action:screenshots:section:mine -->');
	});

	it('does not offer a body when the other sections leave less room than even the note needs', () => {
		// The limit is what the other section alone takes: nothing can be added
		const {body, warnings, full} = buildCommentBody(bigUploaded, bigFiles, {section: mine, previousBody}, previousBody.length);
		expect(full).toBe(true);
		expect(body).toBe('');
		expect(warnings.at(-1)).toBe('The comment is full: the section "Mine" could not be added, not even as a note. Shorten the other sections or use a different comment-tag.');
		expect(warnings.some(message => message.includes('was replaced by a note'))).toBe(false);
	});

	// The smallest list the section can show is one link and "...and 39 more": less than that is a note
	const oneLink = renderComment(bigUploaded.slice(0, 1), bigFiles.slice(0, 1), {
		section: mine, previousBody, layout: 'links', omitted: 39,
	}).length;

	it('still offers the note when even one link does not fit but the note does, and is not full', () => {
		const result = buildCommentBody(bigUploaded, bigFiles, {section: mine, previousBody}, oneLink - 1);
		expect(result.full).toBeUndefined();
		expect(result.body).toContain('…40 images not listed');
		expect(result.body.length).toBeLessThanOrEqual(oneLink - 1);
	});

	it('never produces a body above the limit: it is either within it or not offered', () => {
		const base = renderComment([entry(otherFiles[0], 'https://x/other-image', 1024, {width: 1440, height: 900})], otherFiles, {section: other});
		for (let limit = base.length - 50; limit < base.length + 400; limit += 7) {
			const result = buildCommentBody(bigUploaded, bigFiles, {section: mine, previousBody}, limit);
			expect(result.full ? '' : result.body.slice(0, 0), `limit ${limit}`).toBe('');
			if (!result.full) {
				expect(result.body.length, `limit ${limit}`).toBeLessThanOrEqual(limit);
			}
		}
	});

	it('replaces its section by a note instead of cutting the body when nothing of it fits', () => {
		const {body, warnings} = buildCommentBody(bigUploaded, bigFiles, {section: mine, previousBody}, oneLink - 1);
		expect(warnings.some(message => message.includes('was replaced by a note'))).toBe(true);
		expect(body).toContain('…40 images not listed, see the release assets.');
		expect(body).toContain('<!-- /screenshots-ci-action:screenshots:section:mine -->');
		expect(body).toContain('https://x/other-image');
	});
});
