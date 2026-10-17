import {describe, expect, it} from 'vitest';
import {
	buildContextOptions,
	buildSelectorWaitOptions,
	findCloseDevices,
	formatInvalidDevicesError,
	mapWaitUntil,
	describeWaitUntil,
	normalizeScreenshotType,
	resolveDevices,
} from './utils.js';

const DEVICES = [
	'iPad Pro 11',
	'iPad Pro 11 landscape',
	'iPhone 13',
	'iPhone 13 landscape',
	'iPhone 13 Pro',
	'Galaxy S III',
	'Pixel 5',
];

describe('mapWaitUntil', () => {
	it('passes Playwright values through', () => {
		for (const value of ['load', 'domcontentloaded', 'networkidle', 'commit']) {
			expect(mapWaitUntil(value)).toEqual({value, fallback: false});
		}
	});

	it('maps legacy Puppeteer network idle values', () => {
		expect(mapWaitUntil('networkidle0')).toEqual({
			value: 'networkidle',
			fallback: false,
			mappedFrom: 'networkidle0',
		});
		expect(mapWaitUntil('networkidle2').value).toBe('networkidle');
	});

	it('defaults to networkidle when empty and flags unknown values', () => {
		expect(mapWaitUntil('')).toEqual({value: 'networkidle', fallback: false});
		expect(mapWaitUntil(undefined).value).toBe('networkidle');
		expect(mapWaitUntil('bogus')).toEqual({
			value: 'networkidle',
			fallback: true,
		});
	});

	it('is case/whitespace insensitive', () => {
		expect(mapWaitUntil(' LOAD ').value).toBe('load');
	});
});

describe('findCloseDevices', () => {
	it('finds substring matches case-insensitively', () => {
		expect(findCloseDevices('ipad pro', DEVICES)).toEqual([
			'iPad Pro 11',
			'iPad Pro 11 landscape',
		]);
	});

	it('finds near-typos', () => {
		expect(findCloseDevices('iPhone13', DEVICES)[0]).toBe('iPhone 13');
		expect(findCloseDevices('Pixle 5', DEVICES)).toContain('Pixel 5');
	});

	it('returns nothing for gibberish or empty input', () => {
		expect(findCloseDevices('zzzzzzzz', DEVICES)).toEqual([]);
		expect(findCloseDevices('', DEVICES)).toEqual([]);
	});

	it('respects the limit', () => {
		expect(findCloseDevices('iphone', DEVICES, 2)).toHaveLength(2);
	});
});

describe('resolveDevices', () => {
	it('accepts exact names and ignores empty entries', () => {
		expect(resolveDevices('iPhone 13, Pixel 5,,', DEVICES)).toEqual({
			valid: ['iPhone 13', 'Pixel 5'],
			invalid: [],
		});
		expect(resolveDevices('', DEVICES)).toEqual({valid: [], invalid: []});
	});

	it('normalises case-insensitive exact matches', () => {
		expect(resolveDevices('iphone 13', DEVICES).valid).toEqual(['iPhone 13']);
	});

	it('dedupes repeated devices, including case variants', () => {
		expect(
			resolveDevices('iPhone 13,iPhone 13, iphone 13', DEVICES).valid,
		).toEqual(['iPhone 13']);
	});

	it('treats an ambiguous case-insensitive match as unknown', () => {
		const result = resolveDevices('PIXEL 5', ['Pixel 5', 'pixel 5']);
		expect(result.valid).toEqual([]);
		expect(result.invalid.map(({name}) => name)).toEqual(['PIXEL 5']);
	});

	it('reports unknown names with suggestions', () => {
		const result = resolveDevices('iPad Pro,iPhone 13', DEVICES);
		expect(result.valid).toEqual(['iPhone 13']);
		expect(result.invalid).toEqual([
			{
				name: 'iPad Pro',
				suggestions: ['iPad Pro 11', 'iPad Pro 11 landscape'],
			},
		]);
	});
});

describe('formatInvalidDevicesError', () => {
	it('lists suggestions and links to the Playwright device list', () => {
		const message = formatInvalidDevicesError([
			{name: 'iPad Pro', suggestions: ['iPad Pro 11']},
			{name: 'nope', suggestions: []},
		]);
		expect(message).toContain('- "iPad Pro" (did you mean: "iPad Pro 11"?)');
		expect(message).toContain('- "nope"');
		expect(message).toContain('deviceDescriptorsSource.json');
	});
});

describe('buildSelectorWaitOptions', () => {
	it('uses state attached by default', () => {
		expect(buildSelectorWaitOptions({})).toEqual({
			state: 'attached',
			timeout: 30_000,
		});
	});

	it('maps visible and hidden', () => {
		expect(buildSelectorWaitOptions({visible: true}).state).toBe('visible');
		expect(buildSelectorWaitOptions({hidden: true}).state).toBe('hidden');
		expect(
			buildSelectorWaitOptions({visible: true, hidden: true}).state,
		).toBe('visible');
	});

	it('honours the timeout, including 0 (disabled)', () => {
		expect(buildSelectorWaitOptions({timeout: '1500'}).timeout).toBe(1500);
		expect(buildSelectorWaitOptions({timeout: '0'}).timeout).toBe(0);
		expect(buildSelectorWaitOptions({timeout: 0}).timeout).toBe(0);
	});

	it('falls back to the default for empty/invalid/negative timeouts', () => {
		for (const timeout of ['', ' '.repeat(3), undefined, null, 'abc', '-5']) {
			expect(buildSelectorWaitOptions({timeout}).timeout).toBe(30_000);
		}
	});
});

describe('buildContextOptions', () => {
	const descriptor = {
		viewport: {width: 390, height: 664},
		userAgent: 'test-agent',
		isMobile: true,
	};
	const storageState = {cookies: [{name: 'session', value: '1'}]};

	it('merges storageState without overwriting the descriptor', () => {
		expect(buildContextOptions(descriptor, storageState)).toEqual({
			...descriptor,
			storageState,
		});
	});

	it('omits storageState when undefined', () => {
		const options = buildContextOptions(descriptor, undefined);
		expect(options).toEqual(descriptor);
		expect('storageState' in options).toBe(false);
	});

	it('does not mutate the descriptor', () => {
		const copy = {...descriptor};
		buildContextOptions(descriptor, storageState);
		expect(descriptor).toEqual(copy);
	});

	it('works without a descriptor', () => {
		expect(buildContextOptions(undefined, undefined)).toEqual({});
	});
});

describe('normalizeScreenshotType', () => {
	it('lowercases supported types', () => {
		expect(normalizeScreenshotType('PNG', 'jpeg')).toBe('png');
		expect(normalizeScreenshotType('jpeg', 'png')).toBe('jpeg');
	});

	it('falls back for empty or unsupported values', () => {
		expect(normalizeScreenshotType('', 'jpeg')).toBe('jpeg');
		expect(normalizeScreenshotType(undefined, 'jpeg')).toBe('jpeg');
		expect(normalizeScreenshotType('gif', 'jpeg')).toBe('jpeg');
	});
});

describe('describeWaitUntil', () => {
	it('warns on fallbacks', () => {
		expect(describeWaitUntil('bogus', {value: 'networkidle', fallback: true}))
			.toEqual({warning: 'Unknown waitUntil "bogus", using "networkidle".', notice: undefined});
	});

	it('notes legacy values', () => {
		expect(describeWaitUntil('networkidle0', mapWaitUntil('networkidle0')).notice)
			.toBe('waitUntil "networkidle0" is a legacy Puppeteer value, using Playwright\'s "networkidle".');
	});

	it('is silent for Playwright values', () => {
		expect(describeWaitUntil('load', mapWaitUntil('load'))).toEqual({warning: undefined, notice: undefined});
	});
});
