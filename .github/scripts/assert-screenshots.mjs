// Zero-dependency assertions for the screenshots produced by the action.
// Used by the scenario workflows (.github/workflows/_pass_*.yml). Exits 1 and
// prints every violated expectation when something is off.
import crypto from 'node:crypto';
import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {parseArgs} from 'node:util';
import zlib from 'node:zlib';
import {pathToFileURL} from 'node:url';

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
]);

// SOF0-SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
const isSofMarker = marker =>
	marker >= 0xC0 && marker <= 0xCF && ![0xC4, 0xC8, 0xCC].includes(marker);

// Returns 'png', 'jpeg' or undefined based on the magic bytes.
export function detectFormat(buffer) {
	if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
		return 'png';
	}

	if (
		buffer.length >= 3
		&& buffer[0] === 0xFF
		&& buffer[1] === 0xD8
		&& buffer[2] === 0xFF
	) {
		return 'jpeg';
	}

	return undefined;
}

function parsePngSize(buffer) {
	// 8 byte signature, 4 byte length, "IHDR", then width and height (uint32 BE).
	if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
		throw new Error('PNG without IHDR chunk');
	}

	return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

function parseJpegSize(buffer) {
	let offset = 2;
	while (offset + 4 <= buffer.length) {
		if (buffer[offset] !== 0xFF) {
			throw new Error(`JPEG marker expected at byte ${offset}`);
		}

		const marker = buffer[offset + 1];
		if (marker === 0xFF) {
			offset += 1; // Fill byte
			continue;
		}

		if (isSofMarker(marker)) {
			return {
				width: buffer.readUInt16BE(offset + 7),
				height: buffer.readUInt16BE(offset + 5),
			};
		}

		offset += 2 + buffer.readUInt16BE(offset + 2);
	}

	throw new Error('JPEG without SOF marker');
}

// Reads {format, width, height} from the file header without any dependency.
export function parseImage(buffer) {
	const format = detectFormat(buffer);
	if (format === 'png') {
		return {format, ...parsePngSize(buffer)};
	}

	if (format === 'jpeg') {
		return {format, ...parseJpegSize(buffer)};
	}

	throw new Error('neither PNG nor JPEG magic bytes');
}

// ---- pixel checks (PNG only, decoded with node:zlib, no dependencies) ----

const BAND_HEIGHT = 250;
const FLAT_TOLERANCE = 8; // Per channel, a band within this range is "empty"
const CHANNELS_BY_COLOR_TYPE = {
	0: 1, 2: 3, 4: 2, 6: 4,
};

function paeth(left, up, upLeft) {
	const estimate = left + up - upLeft;
	const distanceLeft = Math.abs(estimate - left);
	const distanceUp = Math.abs(estimate - up);
	const distanceUpLeft = Math.abs(estimate - upLeft);
	if (distanceLeft <= distanceUp && distanceLeft <= distanceUpLeft) {
		return left;
	}

	return distanceUp <= distanceUpLeft ? up : upLeft;
}

// PNG filter types 0 (none), 1 (sub), 2 (up), 3 (average), 4 (paeth).
const PREDICTORS = [
	() => 0,
	left => left,
	(left, up) => up,
	(left, up) => Math.floor((left + up) / 2),
	(left, up, upLeft) => paeth(left, up, upLeft),
];

function unfilterRow(filter, line, previous, bytesPerPixel) {
	const row = Buffer.alloc(line.length);
	const predict = PREDICTORS[filter];
	for (const [i, element] of line.entries()) {
		const left = i >= bytesPerPixel ? row[i - bytesPerPixel] : 0;
		const upLeft = i >= bytesPerPixel ? previous[i - bytesPerPixel] : 0;
		row[i] = (element + predict(left, previous[i], upLeft)) % 256;
	}

	return row;
}

// The IHDR fields and the concatenated IDAT data of a PNG file.
function readPngChunks(buffer) {
	let offset = 8;
	let header;
	const data = [];
	while (offset + 12 <= buffer.length) {
		const type = buffer.toString('ascii', offset + 4, offset + 8);
		if (type === 'IEND') {
			break;
		}

		const length = buffer.readUInt32BE(offset);
		const chunk = buffer.subarray(offset + 8, offset + 8 + length);
		if (type === 'IHDR') {
			header = {
				width: chunk.readUInt32BE(0),
				height: chunk.readUInt32BE(4),
				depth: chunk[8],
				colorType: chunk[9],
				interlace: chunk[12],
			};
		} else if (type === 'IDAT') {
			data.push(chunk);
		}

		offset += 12 + length;
	}

	return {header, data};
}

// Decode an 8 bit, non-interlaced PNG row by row.
export function decodePng(buffer, onRow) {
	const {header, data} = readPngChunks(buffer);
	const channels = header && CHANNELS_BY_COLOR_TYPE[header.colorType];
	if (!channels || header.depth !== 8 || header.interlace !== 0) {
		throw new Error('only 8 bit, non-interlaced PNG files can be analysed');
	}

	const raw = zlib.inflateSync(Buffer.concat(data));
	const stride = header.width * channels;
	let previous = Buffer.alloc(stride);
	for (let y = 0; y < header.height; y++) {
		const start = y * (stride + 1);
		const row = unfilterRow(
			raw[start],
			raw.subarray(start + 1, start + 1 + stride),
			previous,
			channels,
		);
		onRow(y, row, channels);
		previous = row;
	}
}

// Count the bands of `bandHeight` rows whose sampled pixels are (nearly) one
// colour, and fingerprint the first band (to spot a repeated page top).
export function analyzePng(buffer, bandHeight = BAND_HEIGHT) {
	const topHash = crypto.createHash('sha1');
	let low = [];
	let high = [];
	let bands = 0;
	let flatBands = 0;
	let height = 0;
	const sampledChannels = channels => Math.min(3, channels);
	decodePng(buffer, (y, row, channels) => {
		if (y % bandHeight === 0) {
			low = [255, 255, 255];
			high = [0, 0, 0];
		}

		if (y < bandHeight) {
			topHash.update(row);
		}

		if (y % 3 === 0) {
			for (let x = 0; x < row.length; x += 3 * channels) {
				for (let c = 0; c < sampledChannels(channels); c++) {
					low[c] = Math.min(low[c], row[x + c]);
					high[c] = Math.max(high[c], row[x + c]);
				}
			}
		}

		height = y + 1;
		if (y % bandHeight !== bandHeight - 1) {
			return;
		}

		bands++;
		flatBands += high.every((value, c) => value - low[c] <= FLAT_TOLERANCE)
			? 1
			: 0;
	});
	if (height % bandHeight !== 0) {
		bands++;
		flatBands += high.every((value, c) => value - low[c] <= FLAT_TOLERANCE)
			? 1
			: 0;
	}

	return {bands, flatBands, topSignature: topHash.digest('hex')};
}

function checkPixels(directory, rows, options, errors) {
	if (options.expectTotalHeight !== undefined) {
		const total = rows.reduce((sum, row) => sum + row.height, 0);
		if (total !== options.expectTotalHeight) {
			errors.push(
				`Expected the images to add up to ${options.expectTotalHeight} px in height, got ${total}`,
			);
		}
	}

	if (options.maxEmptyFraction === undefined && !options.distinctParts) {
		return;
	}

	const tops = new Map();
	for (const row of rows) {
		if (row.format !== 'png') {
			errors.push(`${row.name}: pixel checks need a png`);
			continue;
		}

		const analysis = analyzePng(
			fs.readFileSync(path.join(directory, row.name)),
		);
		const fraction = analysis.flatBands / analysis.bands;
		if (
			options.maxEmptyFraction !== undefined
			&& fraction > options.maxEmptyFraction
		) {
			errors.push(
				`${row.name}: ${analysis.flatBands} of ${
					analysis.bands
				} bands of ${BAND_HEIGHT}px are blank (${(fraction * 100).toFixed(
					1,
				)}%), more than ${(options.maxEmptyFraction * 100).toFixed(1)}%`,
			);
		}

		if (tops.has(analysis.topSignature)) {
			if (options.distinctParts) {
				errors.push(
					`${row.name} starts with the same ${BAND_HEIGHT} rows as ${tops.get(
						analysis.topSignature,
					)} (the top of the page repeats)`,
				);
			}
		} else {
			tops.set(analysis.topSignature, row.name);
		}
	}
}

const REGEXP_SPECIAL = new Set(String.raw`$()+.[\]^{|}`);

// Supports "*" and "?" only, which is all the scenarios need.
export function globToRegExp(glob) {
	const source = [...glob]
		.map(character => {
			if (character === '*') {
				return '.*';
			}

			if (character === '?') {
				return '.';
			}

			return REGEXP_SPECIAL.has(character) ? `\\${character}` : character;
		})
		.join('');
	return new RegExp(`^${source}$`, 'v');
}

const parseDimensions = value => {
	const match = /^(?<width>\d+)x(?<height>\d+)$/v.exec(value);
	if (!match) {
		throw new Error(`Invalid dimensions "${value}", expected WxH`);
	}

	return {width: Number(match.groups.width), height: Number(match.groups.height)};
};

// <name>-<7 hex commit hash> or <name>-<epoch millis> before the extension.
const HASH_SUFFIX = /-(?:[\da-f]{7}|\d{10,})\.[a-z]+$/v;

function checkRow(row, options, errors) {
	const {name, width, height, format} = row;
	if (
		options.expectFromName
		&& globToRegExp(options.expectFromName).test(name)
	) {
		const fromName = /(?<width>\d{1,5})x(?<height>\d{1,5})(?:-|\.)/v.exec(name);
		if (!fromName) {
			errors.push(`${name}: no <W>x<H> in the file name`);
		} else if (
			Number(fromName.groups.width) !== width
			|| Number(fromName.groups.height) !== height
		) {
			errors.push(
				`${name}: file name says ${fromName.groups.width}x${fromName.groups.height}, image is ${width}x${height}`,
			);
		}
	}

	if (options.minHeight !== undefined && height < options.minHeight) {
		errors.push(
			`${name}: height ${height} is below the expected minimum ${options.minHeight}`,
		);
	}

	if (options.maxHeight !== undefined && height > options.maxHeight) {
		errors.push(
			`${name}: height ${height} is above the expected maximum ${options.maxHeight}`,
		);
	}

	if (options.type) {
		const extension = path.extname(name).slice(1);
		if (format !== options.type || extension !== options.type) {
			errors.push(
				`${name}: expected ${options.type}, got ${format} content with .${extension} extension`,
			);
		}
	}

	if (options.noHash && HASH_SUFFIX.test(name)) {
		errors.push(`${name}: file name carries a commit hash or timestamp suffix`);
	}

	if (options.withHash && !HASH_SUFFIX.test(name)) {
		errors.push(`${name}: file name has no commit hash or timestamp suffix`);
	}
}

// Options that apply to each selected file and so need a non-empty selection.
function perFileOptionNames(options) {
	return [
		options.match && options.match !== '*' ? 'match' : undefined,
		options.minHeight === undefined ? undefined : 'min-height',
		options.maxHeight === undefined ? undefined : 'max-height',
		options.type ? 'type' : undefined,
		options.noHash ? 'no-hash' : undefined,
		options.withHash ? 'with-hash' : undefined,
		options.expectFromName ? 'expect-from-name' : undefined,
		options.maxEmptyFraction === undefined ? undefined : 'max-empty-fraction',
		options.distinctParts ? 'distinct-parts' : undefined,
		options.expectTotalHeight === undefined ? undefined : 'expect-total-height',
	].filter(Boolean);
}

function checkExpectations({rows, allNames, options, errors}) {
	for (const expectation of options.expect || []) {
		const [glob, dimensions] = expectation.split('=', 2);
		const expected = parseDimensions(dimensions);
		const expectedMatcher = globToRegExp(glob);
		const candidates = rows.filter(row => expectedMatcher.test(row.name));
		if (candidates.length === 0) {
			errors.push(`--expect ${expectation}: no file matches "${glob}"`);
		}

		for (const row of candidates) {
			if (row.width !== expected.width || row.height !== expected.height) {
				errors.push(
					`${row.name}: expected ${dimensions}, got ${row.width}x${row.height}`,
				);
			}
		}
	}

	for (const glob of options.expectAbsent || []) {
		const absentMatcher = globToRegExp(glob);
		const present = allNames.filter(file => absentMatcher.test(file));
		for (const name of present) {
			errors.push(`${name}: no file matching "${glob}" expected`);
		}
	}
}

// Pure check so it can be unit tested. Returns {errors, rows}.
export function checkScreenshots(directory, options = {}) {
	const errors = [];
	const rows = [];
	const exists = fs.existsSync(directory);
	const matchGlob = options.match || '*';
	const matcher = globToRegExp(matchGlob);
	const allNames = exists ? fs.readdirSync(directory).toSorted((a, b) => a.localeCompare(b)) : [];
	const names = allNames.filter(name => matcher.test(name));

	if (!exists) {
		errors.push(`Directory "${directory}" does not exist`);
	}

	// Per-file options on an empty selection would pass vacuously.
	const perFileOptions = perFileOptionNames(options);
	if (exists && names.length === 0 && perFileOptions.length > 0) {
		errors.push(
			`No file matches "${matchGlob}" but per-file assertions were requested (${perFileOptions.join(
				', ',
			)})`,
		);
	}

	for (const name of names) {
		const buffer = fs.readFileSync(path.join(directory, name));
		try {
			rows.push({name, ...parseImage(buffer), bytes: buffer.length});
		} catch (error) {
			errors.push(`${name}: ${error.message}`);
		}
	}

	if (
		options.expectCount !== undefined
		&& names.length !== options.expectCount
	) {
		errors.push(
			`Expected ${options.expectCount} file(s) matching "${matchGlob}", found ${
				names.length
			}: ${names.join(', ')}`,
		);
	}

	for (const row of rows) {
		checkRow(row, options, errors);
	}

	checkPixels(directory, rows, options, errors);

	checkExpectations({
		rows, allNames, options, errors,
	});

	return {errors, rows};
}

export function toMarkdown(title, rows) {
	const lines = [
		`### ${title}`,
		'',
		'| File | Format | Dimensions | Size |',
		'| --- | --- | --- | --- |',
	];
	for (const row of rows) {
		lines.push(
			`| ${row.name} | ${row.format} | ${row.width}x${row.height} | ${(
				row.bytes / 1024
			).toFixed(1)} KiB |`,
		);
	}

	return `${lines.join('\n')}\n\n`;
}

const toNumber = (name, value) => {
	if (value === undefined) {
		return undefined;
	}

	const number = Number(value);
	if (!Number.isSafeInteger(number) || number < 0) {
		throw new Error(`--${name} must be a non-negative integer`);
	}

	return number;
};

const toFraction = value => {
	if (value === undefined) {
		return undefined;
	}

	const number = Number(value);
	if (!(number >= 0 && number <= 1)) {
		throw new Error('--max-empty-fraction must be between 0 and 1');
	}

	return number;
};

export function main(argv = process.argv.slice(2)) {
	const {values} = parseArgs({
		args: argv,
		options: {
			dir: {type: 'string', default: 'screenshots'},
			match: {type: 'string', default: '*'},
			'expect-count': {type: 'string'},
			expect: {type: 'string', multiple: true},
			'expect-absent': {type: 'string', multiple: true},
			'expect-from-name': {type: 'string'},
			'min-height': {type: 'string'},
			'max-height': {type: 'string'},
			'expect-total-height': {type: 'string'},
			'max-empty-fraction': {type: 'string'},
			'distinct-parts': {type: 'boolean', default: false},
			type: {type: 'string'},
			'no-hash': {type: 'boolean', default: false},
			'with-hash': {type: 'boolean', default: false},
			title: {type: 'string'},
			'archive-to': {type: 'string'},
		},
	});

	const {errors, rows} = checkScreenshots(values.dir, {
		match: values.match,
		expectCount: toNumber('expect-count', values['expect-count']),
		expect: values.expect,
		expectAbsent: values['expect-absent'],
		expectFromName: values['expect-from-name'],
		minHeight: toNumber('min-height', values['min-height']),
		maxHeight: toNumber('max-height', values['max-height']),
		expectTotalHeight: toNumber(
			'expect-total-height',
			values['expect-total-height'],
		),
		maxEmptyFraction: toFraction(values['max-empty-fraction']),
		distinctParts: values['distinct-parts'],
		type: values.type,
		noHash: values['no-hash'],
		withHash: values['with-hash'],
	});

	for (const row of rows) {
		console.log(
			`${row.name}: ${row.format} ${row.width}x${row.height} ${row.bytes} bytes`,
		);
	}

	// Reported even on failure so reviewers see what was produced.
	if (values.title && process.env.GITHUB_STEP_SUMMARY) {
		fs.appendFileSync(
			process.env.GITHUB_STEP_SUMMARY,
			toMarkdown(values.title, rows),
		);
	}

	if (values['archive-to']) {
		fs.mkdirSync(values['archive-to'], {recursive: true});
		for (const row of rows) {
			fs.copyFileSync(
				path.join(values.dir, row.name),
				path.join(values['archive-to'], row.name),
			);
		}
	}

	if (errors.length > 0) {
		for (const error of errors) {
			console.error(`::error::${error}`);
		}

		return 1;
	}

	console.log(`OK: ${rows.length} screenshot(s) passed all assertions`);
	return 0;
}

if (
	process.argv[1]
	&& import.meta.url === pathToFileURL(process.argv[1]).href
) {
	try {
		process.exitCode = main();
	} catch (error) {
		console.error(`::error::${error.message}`);
		process.exitCode = 2;
	}
}
