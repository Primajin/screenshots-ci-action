import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import {
	analyzePng,
	checkScreenshots,
	compareSliced,
	decodePng,
	detectFormat,
	globToRegExp,
	main,
	parseImage,
	toMarkdown,
} from './assert-screenshots.mjs';

const png = (width, height) => {
	const buffer = Buffer.alloc(33);
	Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]).copy(buffer);
	buffer.writeUInt32BE(13, 8);
	buffer.write('IHDR', 12, 'ascii');
	buffer.writeUInt32BE(width, 16);
	buffer.writeUInt32BE(height, 20);
	return buffer;
};

// SOI, an APP0 segment (must be skipped), then SOF0 with height/width.
const jpeg = (width, height, marker = 0xC0) => {
	const app0 = Buffer.from([0xFF, 0xE0, 0x00, 0x04, 0x00, 0x00]);
	const sof = Buffer.alloc(11);
	sof[0] = 0xFF;
	sof[1] = marker;
	sof.writeUInt16BE(9, 2);
	sof[4] = 8;
	sof.writeUInt16BE(height, 5);
	sof.writeUInt16BE(width, 7);
	return Buffer.concat([Buffer.from([0xFF, 0xD8]), app0, sof]);
};

describe('parseImage', () => {
	it('reads PNG dimensions from the IHDR chunk', () => {
		expect(parseImage(png(1170, 1992))).toEqual({
			format: 'png',
			width: 1170,
			height: 1992,
		});
	});

	it('reads JPEG dimensions from the SOF marker, skipping other segments', () => {
		expect(parseImage(jpeg(540, 405))).toEqual({
			format: 'jpeg',
			width: 540,
			height: 405,
		});
		expect(parseImage(jpeg(10, 20, 0xC2))).toMatchObject({
			width: 10,
			height: 20,
		});
	});

	it('skips an EXIF thumbnail and returns the size of the real SOF2 frame', () => {
		// APP1 payload: "Exif" header plus an embedded thumbnail that itself
		// starts with SOI + SOF0 (16x16). The parser must skip the whole segment.
		const thumbnail = Buffer.from([
			0xFF,
			0xD8,
			0xFF,
			0xC0,
			0x00,
			0x0B,
			0x08,
			0x00,
			0x10,
			0x00,
			0x10,
			0x01,
			0x01,
			0x11,
			0x00,
		]);
		const payload = Buffer.concat([Buffer.from('Exif\0\0'), thumbnail]);
		const app1 = Buffer.alloc(4);
		app1[0] = 0xFF;
		app1[1] = 0xE1;
		app1.writeUInt16BE(payload.length + 2, 2);
		const progressive = jpeg(1170, 1992, 0xC2);
		const buffer = Buffer.concat([
			progressive.subarray(0, 2),
			app1,
			payload,
			progressive.subarray(2),
		]);
		expect(parseImage(buffer)).toEqual({
			format: 'jpeg',
			width: 1170,
			height: 1992,
		});
	});

	it('rejects unknown content and truncated files', () => {
		expect(() => parseImage(Buffer.from('GIF89a'))).toThrow('magic bytes');
		expect(() => parseImage(png(1, 1).subarray(0, 20))).toThrow('IHDR');
		expect(() =>
			parseImage(Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0, 2])),
		).toThrow('SOF');
		expect(() =>
			parseImage(
				Buffer.from([
					0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x02, 0x11, 0x22, 0x33, 0x44,
				]),
			),
		).toThrow('marker expected');
	});

	it('detects the format by magic bytes only', () => {
		expect(detectFormat(png(1, 1))).toBe('png');
		expect(detectFormat(jpeg(1, 1))).toBe('jpeg');
		expect(detectFormat(Buffer.alloc(2))).toBeUndefined();
	});
});

describe('globToRegExp', () => {
	it('supports * and ? and escapes everything else', () => {
		expect(globToRegExp('desktopPage*').test('desktopPage540x405.png')).toBe(
			true,
		);
		expect(globToRegExp('a?c.png').test('abc.png')).toBe(true);
		expect(globToRegExp('a.png').test('abpng')).toBe(false);
	});
});

describe('checkScreenshots', () => {
	let directory;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-screenshots-'));
	});

	afterEach(() => {
		fs.rmSync(directory, {recursive: true, force: true});
	});

	const write = (name, buffer) =>
		fs.writeFileSync(path.join(directory, name), buffer);

	it('passes when every expectation holds', () => {
		write('desktopPage540x405-abc1234.png', png(540, 405));
		write('iPhone_13-abc1234.png', png(1170, 1992));
		const {errors, rows} = checkScreenshots(directory, {
			expectCount: 2,
			expect: ['iPhone_13*=1170x1992'],
			expectFromName: 'desktopPage*',
			type: 'png',
			withHash: true,
			minHeight: 405,
			maxHeight: 1992,
		});
		expect(errors).toEqual([]);
		expect(rows).toHaveLength(2);
	});

	it('derives the expected size from the file name', () => {
		write('desktopPage540x405.png', png(540, 405));
		write('desktopPage600x450.png', png(600, 400));
		const {errors} = checkScreenshots(directory, {
			match: 'desktopPage*',
			expectFromName: 'desktopPage*',
		});
		expect(errors).toEqual([
			'desktopPage600x450.png: file name says 600x450, image is 600x400',
		]);
	});

	it('reports a name without dimensions', () => {
		write('iPhone_13.png', png(1, 1));
		expect(checkScreenshots(directory, {expectFromName: '*'}).errors).toEqual(
			['iPhone_13.png: no <W>x<H> in the file name'],
		);
	});

	it('flags wrong count, wrong size and unmatched expectations', () => {
		write('a-1234567.png', png(10, 10));
		const {errors} = checkScreenshots(directory, {
			expectCount: 2,
			expect: ['a*=20x20', 'b*=1x1'],
		});
		expect(errors).toEqual([
			'Expected 2 file(s) matching "*", found 1: a-1234567.png',
			'a-1234567.png: expected 20x20, got 10x10',
			'--expect b*=1x1: no file matches "b*"',
		]);
	});

	it('fails per-file options that select zero files instead of passing vacuously', () => {
		write('desktopPage1x1.png', png(1, 1));
		const options = [
			['match', {match: 'iPhone*'}],
			['min-height', {match: 'iPhone*', minHeight: 1}],
			['max-height', {match: 'iPhone*', maxHeight: 9}],
			['type', {match: 'iPhone*', type: 'png'}],
			['no-hash', {match: 'iPhone*', noHash: true}],
			['with-hash', {match: 'iPhone*', withHash: true}],
			['expect-from-name', {match: 'iPhone*', expectFromName: '*'}],
		];
		for (const [name, option] of options) {
			const {errors} = checkScreenshots(directory, option);
			expect(errors[0], name).toMatch(
				'No file matches "iPhone*" but per-file assertions were requested',
			);
			expect(errors[0], name).toContain(name);
		}
	});

	it('does not complain about an empty selection without per-file options', () => {
		expect(checkScreenshots(directory, {expectCount: 0}).errors).toEqual([]);
		expect(checkScreenshots(directory, {}).errors).toEqual([]);
	});

	it('fails an empty directory when a type is expected', () => {
		expect(checkScreenshots(directory, {type: 'png'}).errors).toHaveLength(1);
	});

	it('flags height bounds', () => {
		write('a.png', png(10, 100));
		expect(checkScreenshots(directory, {minHeight: 200}).errors[0]).toMatch(
			'below the expected minimum 200',
		);
		expect(checkScreenshots(directory, {maxHeight: 50}).errors[0]).toMatch(
			'above the expected maximum 50',
		);
	});

	it('checks type by magic bytes and extension', () => {
		write('real.jpeg', jpeg(5, 5));
		write('fake.png', jpeg(5, 5));
		write('renamed.jpeg', png(5, 5));
		const {errors} = checkScreenshots(directory, {type: 'jpeg'});
		expect(errors).toEqual([
			'fake.png: expected jpeg, got jpeg content with .png extension',
			'renamed.jpeg: expected jpeg, got png content with .jpeg extension',
		]);
	});

	it('detects hash and timestamp suffixes', () => {
		write('desktopPage540x405-abc1234.png', png(1, 1));
		write('iPhone_13-1700000000000.png', png(1, 1));
		write('iPad_Pro_11.png', png(1, 1));
		const noHash = checkScreenshots(directory, {noHash: true}).errors;
		expect(noHash).toHaveLength(2);
		expect(noHash[0]).toMatch('desktopPage540x405-abc1234.png');
		const withHash = checkScreenshots(directory, {withHash: true}).errors;
		expect(withHash).toEqual([
			'iPad_Pro_11.png: file name has no commit hash or timestamp suffix',
		]);
	});

	it('supports absence checks and reports corrupt files', () => {
		write('desktopPage1x1.png', png(1, 1));
		write('broken.png', Buffer.from('nope'));
		const {errors} = checkScreenshots(directory, {
			expectAbsent: ['desktopPage*', 'nothing*'],
		});
		expect(errors).toEqual([
			'broken.png: neither PNG nor JPEG magic bytes',
			'desktopPage1x1.png: no file matching "desktopPage*" expected',
		]);
	});

	it('fails for a missing directory', () => {
		expect(
			checkScreenshots(path.join(directory, 'missing'), {expectAbsent: ['*']})
				.errors,
		).toEqual([
			'Directory "' + path.join(directory, 'missing') + '" does not exist',
		]);
	});

	it('rejects malformed dimensions', () => {
		write('a.png', png(1, 1));
		expect(() => checkScreenshots(directory, {expect: ['a*=big']})).toThrow(
			'expected WxH',
		);
	});
});

describe('toMarkdown', () => {
	it('renders a table row per file', () => {
		expect(
			toMarkdown('Title', [
				{
					name: 'a.png', format: 'png', width: 2, height: 3, bytes: 2048,
				},
			]),
		).toBe(
			'### Title\n\n| File | Format | Dimensions | Size |\n| --- | --- | --- | --- |\n| a.png | png | 2x3 | 2.0 KiB |\n\n',
		);
	});
});

describe('main (CLI)', () => {
	let directory;
	let summary;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-screenshots-'));
		summary = path.join(directory, 'summary.md');
		fs.mkdirSync(path.join(directory, 'shots'));
		fs.writeFileSync(
			path.join(directory, 'shots', 'iPhone_13.jpeg'),
			jpeg(1170, 1992),
		);
		vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		vi.unstubAllEnvs();
		vi.restoreAllMocks();
		fs.rmSync(directory, {recursive: true, force: true});
	});

	const run = (...args) =>
		main(['--dir', path.join(directory, 'shots'), ...args]);

	it('wires --match, --no-hash, --with-hash and --expect-absent through main', () => {
		fs.writeFileSync(
			path.join(directory, 'shots', 'desktopPage1x1-abc1234.jpeg'),
			jpeg(1, 1),
		);
		// IPhone_13.jpeg has no hash suffix, desktopPage1x1-abc1234.jpeg has one.
		expect(run('--no-hash')).toBe(1);
		expect(run('--with-hash')).toBe(1);
		expect(run('--match', 'iPhone*', '--no-hash')).toBe(0);
		expect(run('--match', 'desktop*', '--with-hash')).toBe(0);
		expect(run('--match', 'desktop*', '--no-hash')).toBe(1);
		expect(run('--expect-absent', 'desktop*')).toBe(1);
		expect(run('--expect-absent', 'nothing*')).toBe(0);
		expect(run('--match', 'nope*', '--type', 'jpeg')).toBe(1);
		// A match that selects nothing is an error even with an explicit count
		expect(run('--match', 'nope*', '--expect-count', '0')).toBe(1);
	});

	it('returns 0, writes the summary and archives the files on success', () => {
		const archive = path.join(directory, 'archive');
		expect(
			run(
				'--expect',
				'iPhone_13*=1170x1992',
				'--title',
				'T',
				'--archive-to',
				archive,
			),
		).toBe(0);
		expect(fs.readFileSync(summary, 'utf8')).toContain(
			'| iPhone_13.jpeg | jpeg | 1170x1992 |',
		);
		expect(fs.existsSync(path.join(archive, 'iPhone_13.jpeg'))).toBe(true);
	});

	it('returns 1 and annotates every failure', () => {
		expect(run('--expect-count', '2', '--type', 'png')).toBe(1);
		expect(console.error).toHaveBeenCalledTimes(2);
	});

	it('rejects invalid numbers', () => {
		expect(() => run('--min-height', 'abc')).toThrow('non-negative integer');
	});
});

// ---- pixel checks ----

const chunk = (type, data) => {
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const length = Buffer.alloc(4);
	length.writeUInt32BE(data.length);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(zlib.crc32(body));
	return Buffer.concat([length, body, crc]);
};

// PNG filter types 0 (none), 1 (sub), 2 (up), 3 (average), 4 (paeth).
const PREDICTORS = [
	() => 0,
	left => left,
	(left, up) => up,
	(left, up) => Math.floor((left + up) / 2),
	(left, up, upLeft) => {
		const estimate = left + up - upLeft;
		const distances = [left, up, upLeft].map(value => Math.abs(estimate - value));
		return [left, up, upLeft][distances.indexOf(Math.min(...distances))];
	},
];

const encodeRow = (width, channels, y, pixel) => {
	const row = Buffer.alloc(width * channels);
	for (let x = 0; x < width; x++) {
		const [red, green, blue] = pixel(x, y);
		row.set(channels === 4 ? [red, green, blue, 255] : [red, green, blue], x * channels);
	}

	return row;
};

// Encodes an RGB or RGBA PNG; pixel(x, y) returns [r, g, b]; filterFor(y) picks
// the PNG filter type of a row.
const encodePng = (width, height, pixel, {alpha = false, filterFor = () => 0} = {}) => {
	const channels = alpha ? 4 : 3;
	const lines = [];
	let previous = Buffer.alloc(width * channels);
	for (let y = 0; y < height; y++) {
		const row = encodeRow(width, channels, y, pixel);
		const filter = filterFor(y);
		const filtered = Buffer.alloc(row.length + 1);
		filtered[0] = filter;
		for (const [i, value] of row.entries()) {
			const left = i >= channels ? row[i - channels] : 0;
			const upLeft = i >= channels ? previous[i - channels] : 0;
			filtered[i + 1] = (value - PREDICTORS[filter](left, previous[i], upLeft) + 256) % 256;
		}

		lines.push(filtered);
		previous = row;
	}

	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = alpha ? 6 : 2;
	const compressed = zlib.deflateSync(Buffer.concat(lines));
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
		chunk('IHDR', header),
		chunk('IDAT', compressed),
		chunk('IEND', Buffer.alloc(0)),
	]);
};

// A busy picture: diagonal stripes whose colour depends on the 500px section.
const busy = (offset = 0) => (x, y) => {
	const stripe = Math.floor((x + y + offset) / 16) % 2 === 1 ? 40 : 200;
	return [stripe, (Math.floor((y + offset) / 500) * 20) % 256, 255 - stripe];
};

const blank = () => [248, 250, 252];

describe('decodePng', () => {
	it('decodes every filter type back to the original pixels', () => {
		for (const alpha of [false, true]) {
			const image = encodePng(37, 11, busy(), {
				alpha,
				filterFor: y => y % 5,
			});
			const rows = [];
			decodePng(image, (y, row, channels) => {
				rows.push(Buffer.from(row));
				expect(channels).toBe(alpha ? 4 : 3);
			});
			expect(rows).toHaveLength(11);
			for (let y = 0; y < 11; y++) {
				const channels = alpha ? 4 : 3;
				const [r, g, b] = busy()(5, y);
				const start = 5 * channels;
				expect([...rows[y].subarray(start, start + 3)]).toEqual([
					r,
					g,
					b,
				]);
			}
		}
	});

	it('rejects unsupported PNGs', () => {
		const image = encodePng(2, 2, blank);
		image[24] = 16; // Bit depth in IHDR
		expect(() => decodePng(image, () => {})).toThrow('8 bit');
	});
});

describe('analyzePng', () => {
	it('counts blank bands', () => {
		const image = encodePng(60, 1000, (x, y) =>
			y < 500 ? busy()(x, y) : blank(),
		);
		expect(analyzePng(image)).toMatchObject({bands: 4, flatBands: 2});
	});

	it('counts a partial last band and finds none in a busy image', () => {
		const image = encodePng(60, 600, busy());
		expect(analyzePng(image)).toMatchObject({bands: 3, flatBands: 0});
	});

	it('fingerprints the first band', () => {
		const a = analyzePng(encodePng(30, 300, busy(0)));
		const b = analyzePng(encodePng(30, 300, busy(0)));
		const c = analyzePng(encodePng(30, 300, busy(8)));
		expect(a.topSignature).toBe(b.topSignature);
		expect(a.topSignature).not.toBe(c.topSignature);
	});
});

describe('pixel assertions', () => {
	let directory;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-pixels-'));
	});

	afterEach(() => {
		fs.rmSync(directory, {recursive: true, force: true});
	});

	const write = (name, buffer) =>
		fs.writeFileSync(path.join(directory, name), buffer);

	it('passes a fully rendered capture', () => {
		write('p-part1.png', encodePng(40, 750, busy(0)));
		write('p-part2.png', encodePng(40, 500, busy(750)));
		const {errors} = checkScreenshots(directory, {
			expectTotalHeight: 1250,
			maxEmptyFraction: 0.02,
			distinctParts: true,
		});
		expect(errors).toEqual([]);
	});

	it('fails a capture with a big blank region (control)', () => {
		write(
			'p-part1.png',
			encodePng(40, 2000, (x, y) => (y < 500 ? busy()(x, y) : blank())),
		);
		const {errors} = checkScreenshots(directory, {maxEmptyFraction: 0.02});
		expect(errors).toEqual([
			'p-part1.png: 6 of 8 bands of 250px are blank (75.0%), more than 2.0%',
		]);
	});

	it('tolerates a few blank bands up to the given fraction', () => {
		write(
			'p.png',
			encodePng(40, 2500, (x, y) => (y < 250 ? blank() : busy()(x, y))),
		);
		expect(
			checkScreenshots(directory, {maxEmptyFraction: 0.1}).errors,
		).toEqual([]);
		expect(
			checkScreenshots(directory, {maxEmptyFraction: 0.05}).errors,
		).toHaveLength(1);
	});

	it('fails when a part repeats the top of the page', () => {
		write('p-part1.png', encodePng(40, 600, busy(0)));
		write('p-part2.png', encodePng(40, 600, busy(0)));
		expect(checkScreenshots(directory, {distinctParts: true}).errors).toEqual(
			[
				'p-part2.png starts with the same 250 rows as p-part1.png (the top of the page repeats)',
			],
		);
	});

	it('checks the total height', () => {
		write('a.png', encodePng(10, 300, busy()));
		expect(
			checkScreenshots(directory, {expectTotalHeight: 301}).errors,
		).toEqual(['Expected the images to add up to 301 px in height, got 300']);
	});

	it('needs a png for pixel checks', () => {
		write('a.jpeg', jpeg(10, 10));
		expect(
			checkScreenshots(directory, {maxEmptyFraction: 0.1}).errors,
		).toEqual(['a.jpeg: pixel checks need a png']);
	});

	it('fails the pixel options on an empty selection', () => {
		expect(
			checkScreenshots(directory, {match: 'x*', distinctParts: true})
				.errors[0],
		).toContain('distinct-parts');
	});
});

describe('main (pixel flags)', () => {
	it('wires --expect-total-height, --max-empty-fraction and --distinct-parts', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-main-'));
		fs.writeFileSync(
			path.join(directory, 'p-part1.png'),
			encodePng(20, 500, busy(0)),
		);
		fs.writeFileSync(
			path.join(directory, 'p-part2.png'),
			encodePng(20, 500, blank),
		);
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect(main(['--dir', directory, '--expect-total-height', '1000'])).toBe(
				0,
			);
			expect(main(['--dir', directory, '--expect-total-height', '999'])).toBe(
				1,
			);
			expect(main(['--dir', directory, '--max-empty-fraction', '0'])).toBe(1);
			expect(main(['--dir', directory, '--max-empty-fraction', '1'])).toBe(0);
			expect(main(['--dir', directory, '--distinct-parts'])).toBe(0);
			expect(() =>
				main(['--dir', directory, '--max-empty-fraction', '2']),
			).toThrow('between 0 and 1');
		} finally {
			vi.restoreAllMocks();
			fs.rmSync(directory, {recursive: true, force: true});
		}
	});
});

describe('analyzePng, partial bands', () => {
	it('does not count a one row last band of busy pixels as blank', () => {
		// 250 rows + 1 row: the last band has only row 250, which is not a multiple of 3
		const image = encodePng(60, 251, busy());
		expect(analyzePng(image)).toMatchObject({bands: 2, flatBands: 0});
	});

	it('still counts a blank one row last band as blank', () => {
		const image = encodePng(60, 251, (x, y) => (y < 250 ? busy()(x, y) : blank()));
		expect(analyzePng(image)).toMatchObject({bands: 2, flatBands: 1});
	});
});

describe('compareSliced', () => {
	let root;

	beforeEach(() => {
		root = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-compare-'));
	});

	afterEach(() => {
		fs.rmSync(root, {recursive: true, force: true});
	});

	// Writes the parts of the busy test page; `start` is the source row each
	// part begins at, so a gap or an overlap is a start that is off by a pixel.
	const writeParts = (name, parts) => {
		const directory = path.join(root, name);
		fs.mkdirSync(directory);
		for (const [index, {start, height}] of parts.entries()) {
			fs.writeFileSync(
				path.join(directory, `p-part${index + 1}-abc1234.png`),
				encodePng(40, height, busy(start)),
			);
		}

		return directory;
	};

	it('accepts the same page cut at different heights', () => {
		const a = writeParts('a', [
			{start: 0, height: 400},
			{start: 400, height: 300},
			{start: 700, height: 300},
		]);
		const b = writeParts('b', [
			{start: 0, height: 500},
			{start: 500, height: 500},
		]);
		expect(compareSliced(a, b)).toEqual({errors: [], rows: 1000});
	});

	it('orders parts by number, not by text (part10 after part2)', () => {
		const directory = path.join(root, 'many');
		fs.mkdirSync(directory);
		for (let index = 0; index < 11; index++) {
			fs.writeFileSync(
				path.join(directory, `p-part${index + 1}-abc1234.png`),
				encodePng(20, 10, busy(index * 10)),
			);
		}

		const single = path.join(root, 'single');
		fs.mkdirSync(single);
		fs.writeFileSync(path.join(single, 'p-abc1234.png'), encodePng(20, 110, busy(0)));
		expect(compareSliced(directory, single).errors).toEqual([]);
	});

	it('fails on a one pixel gap at a seam (control)', () => {
		const a = writeParts('a', [{start: 0, height: 1000}]);
		const b = writeParts('b', [
			{start: 0, height: 500},
			{start: 501, height: 500}, // Row 500 of the page is missing
		]);
		const {errors} = compareSliced(a, b);
		expect(errors).toHaveLength(1);
		expect(errors[0]).toContain('the first is row 500 (p-part1-abc1234.png in');
		expect(errors[0]).toContain('p-part2-abc1234.png in');
	});

	it('fails on a one pixel overlap at a seam (control)', () => {
		const a = writeParts('a', [{start: 0, height: 1000}]);
		const b = writeParts('b', [
			{start: 0, height: 500},
			{start: 499, height: 500}, // Row 499 is repeated
		]);
		expect(compareSliced(a, b).errors[0]).toContain('the first is row 500');
	});

	it('reports different total heights', () => {
		const a = writeParts('a', [{start: 0, height: 1000}]);
		const b = writeParts('b', [
			{start: 0, height: 500},
			{start: 500, height: 499},
		]);
		expect(compareSliced(a, b).errors[0]).toContain('different heights: 1000 rows in');
	});

	it('needs pngs and existing directories', () => {
		const a = writeParts('a', [{start: 0, height: 10}]);
		const jpegDirectory = path.join(root, 'jpeg');
		fs.mkdirSync(jpegDirectory);
		fs.writeFileSync(path.join(jpegDirectory, 'p-part1.jpeg'), jpeg(10, 10));
		expect(compareSliced(a, jpegDirectory).errors).toContain('p-part1.jpeg: pixel checks need a png');
		expect(compareSliced(a, path.join(root, 'missing')).errors[0]).toContain('does not exist');
		const empty = path.join(root, 'empty');
		fs.mkdirSync(empty);
		expect(compareSliced(a, empty).errors[0]).toContain('No images in');
	});

	it('is wired into main with two directories', () => {
		const a = writeParts('a', [{start: 0, height: 600}]);
		const b = writeParts('b', [
			{start: 0, height: 300},
			{start: 300, height: 300},
		]);
		const c = writeParts('c', [
			{start: 0, height: 300},
			{start: 301, height: 300},
		]);
		vi.spyOn(console, 'log').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			expect(main(['--compare-sliced', a, b])).toBe(0);
			expect(main(['--compare-sliced', a, c])).toBe(1);
			expect(() => main(['--compare-sliced', a])).toThrow('two directories');
		} finally {
			vi.restoreAllMocks();
		}
	});
});
