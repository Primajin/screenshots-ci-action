import {describe, expect, it} from 'vitest';
import {
	CONTEXT_OPTION_KEYS,
	buildContextOptions,
	buildSelectorWaitOptions,
	findCloseDevices,
	formatInvalidDevicesError,
	mapWaitUntil,
	describeWaitUntil,
	normalizeScreenshotType,
	parseSizes,
	resolveContextOptions,
	resolveDesktopViewports,
	resolveDevices,
	sizeContextOptions,
	sizeFileBase,
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
		expect(message).toContain('packages/isomorphic/deviceDescriptorsSource.json');
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

	it('lets the overrides win over the descriptor', () => {
		const overrides = {userAgent: 'custom', deviceScaleFactor: 3, colorScheme: 'dark'};
		expect(buildContextOptions(descriptor, undefined, overrides)).toEqual({
			viewport: {width: 390, height: 664},
			userAgent: 'custom',
			isMobile: true,
			deviceScaleFactor: 3,
			colorScheme: 'dark',
		});
	});

	it('replaces the whole viewport of the descriptor', () => {
		expect(buildContextOptions(descriptor, undefined, {viewport: {width: 800, height: 600}}).viewport)
			.toEqual({width: 800, height: 600});
	});

	it('never lets the overrides replace the storageState of the pre-script', () => {
		const options = buildContextOptions(descriptor, storageState, {colorScheme: 'dark', storageState: {cookies: []}});
		expect(options.storageState).toBe(storageState);
		expect(options.colorScheme).toBe('dark');
	});

	it('does not mutate the overrides', () => {
		const overrides = {colorScheme: 'dark'};
		buildContextOptions(descriptor, storageState, overrides);
		expect(overrides).toEqual({colorScheme: 'dark'});
	});

	it('is the descriptor alone for empty overrides', () => {
		expect(buildContextOptions(descriptor, undefined, {})).toEqual(descriptor);
	});
});

describe('resolveContextOptions', () => {
	it('is empty for an empty or missing input', () => {
		expect(resolveContextOptions('')).toEqual({});
		expect(resolveContextOptions(' \t\n ')).toEqual({});
		expect(resolveContextOptions(undefined)).toEqual({});
		expect(resolveContextOptions(null)).toEqual({});
	});

	it('accepts every allowed key', () => {
		const all = {
			colorScheme: 'dark',
			reducedMotion: 'reduce',
			forcedColors: 'active',
			deviceScaleFactor: 1.5,
			isMobile: true,
			hasTouch: true,
			viewport: {width: 390, height: 844},
			locale: 'de-DE',
			timezoneId: 'Europe/Berlin',
			userAgent: 'my agent/1.0',
		};
		expect(Object.keys(all).toSorted((a, b) => a.localeCompare(b))).toEqual([...CONTEXT_OPTION_KEYS].toSorted((a, b) => a.localeCompare(b)));
		expect(resolveContextOptions(JSON.stringify(all))).toEqual(all);
	});

	it('accepts the documented example and surrounding whitespace', () => {
		expect(resolveContextOptions('\t{"colorScheme": "dark", "reducedMotion": "reduce"}\n'))
			.toEqual({colorScheme: 'dark', reducedMotion: 'reduce'});
	});

	it('accepts every value of the enums', () => {
		for (const colorScheme of ['light', 'dark', 'no-preference']) {
			expect(resolveContextOptions(JSON.stringify({colorScheme}))).toEqual({colorScheme});
		}

		for (const reducedMotion of ['reduce', 'no-preference']) {
			expect(resolveContextOptions(JSON.stringify({reducedMotion}))).toEqual({reducedMotion});
		}

		for (const forcedColors of ['active', 'none']) {
			expect(resolveContextOptions(JSON.stringify({forcedColors}))).toEqual({forcedColors});
		}
	});

	it('accepts false for the booleans', () => {
		expect(resolveContextOptions('{"isMobile": false, "hasTouch": false}')).toEqual({isMobile: false, hasTouch: false});
	});

	it('fails for invalid JSON, naming the input', () => {
		expect(() => resolveContextOptions('{colorScheme: dark}')).toThrow(/context-options is not valid JSON/v);
		expect(() => resolveContextOptions('{"a": ')).toThrow(/not valid JSON/v);
		expect(() => resolveContextOptions('dark')).toThrow(/not valid JSON/v);
	});

	it('fails when the JSON is not an object', () => {
		for (const raw of ['[]', '[{"colorScheme":"dark"}]', '"dark"', '5', 'true', 'null']) {
			expect(() => resolveContextOptions(raw), raw).toThrow(/must be a JSON object/v);
		}
	});

	it('fails for an unknown key and lists the allowed ones', () => {
		const attempt = () => resolveContextOptions('{"colorscheme": "dark"}');
		expect(attempt).toThrow(/unknown option "colorscheme"/v);
		expect(attempt).toThrow(/Allowed: colorScheme, reducedMotion, forcedColors, deviceScaleFactor/v);
	});

	it('refuses options that could break the action or the pre-script session', () => {
		for (const key of ['storageState', 'proxy', 'extraHTTPHeaders', 'permissions', 'recordVideo', 'baseURL', 'screen', 'javaScriptEnabled']) {
			expect(() => resolveContextOptions(JSON.stringify({[key]: 'x'})), key).toThrow(/unknown option/v);
		}
	});

	it('does not accept inherited property names as keys', () => {
		expect(() => resolveContextOptions('{"toString": "x"}')).toThrow(/unknown option "toString"/v);
		expect(() => resolveContextOptions('{"__proto__": {"colorScheme": "dark"}}')).toThrow(/unknown option "__proto__"/v);
	});

	it('fails for a value that is not allowed for an enum', () => {
		expect(() => resolveContextOptions('{"colorScheme": "darkish"}')).toThrow(/"colorScheme" must be one of "light", "dark", "no-preference", got "darkish"/v);
		expect(() => resolveContextOptions('{"colorScheme": null}')).toThrow(/"colorScheme" must be one of/v);
		expect(() => resolveContextOptions('{"reducedMotion": "yes"}')).toThrow(/"reducedMotion" must be one of/v);
		expect(() => resolveContextOptions('{"forcedColors": true}')).toThrow(/"forcedColors" must be one of/v);
	});

	it('fails for a wrong deviceScaleFactor', () => {
		for (const value of ['2', 0, -1, null, true, [2], {}]) {
			expect(() => resolveContextOptions(JSON.stringify({deviceScaleFactor: value})), String(value)).toThrow(/"deviceScaleFactor" must be a number above 0/v);
		}
	});

	it('accepts a fractional deviceScaleFactor', () => {
		expect(resolveContextOptions('{"deviceScaleFactor": 0.5}')).toEqual({deviceScaleFactor: 0.5});
		expect(resolveContextOptions('{"deviceScaleFactor": 2.75}')).toEqual({deviceScaleFactor: 2.75});
	});

	it('fails for booleans that are not booleans', () => {
		for (const key of ['isMobile', 'hasTouch']) {
			for (const value of ['true', 1, 0, null]) {
				expect(() => resolveContextOptions(JSON.stringify({[key]: value})), `${key} ${value}`).toThrow(new RegExp(`"${key}" must be true or false`, 'v'));
			}
		}
	});

	it('fails for strings that are empty or not strings', () => {
		for (const key of ['locale', 'timezoneId', 'userAgent']) {
			for (const value of ['', '  ', 5, null, ['de']]) {
				expect(() => resolveContextOptions(JSON.stringify({[key]: value})), `${key} ${value}`).toThrow(new RegExp(`"${key}" must be a non-empty string`, 'v'));
			}
		}
	});

	it('fails for a viewport that is not {width, height} of positive whole numbers', () => {
		const bad = [
			'"1440x900"',
			'null',
			'[1440, 900]',
			'{"width": 1440}',
			'{"height": 900}',
			'{"width": 0, "height": 900}',
			'{"width": -1, "height": 900}',
			'{"width": 1440.5, "height": 900}',
			'{"width": "1440", "height": 900}',
			'{"width": 1440, "height": 900, "extra": 1}',
		];
		for (const viewport of bad) {
			expect(() => resolveContextOptions(`{"viewport": ${viewport}}`), viewport).toThrow(/"viewport" must be an object like/v);
		}
	});

	it('accepts the limits of the viewport and refuses a viewport above them', () => {
		expect(resolveContextOptions('{"viewport": {"width": 1, "height": 10000}}').viewport).toEqual({width: 1, height: 10_000});
		for (const viewport of ['{"width": 10001, "height": 900}', '{"width": 1440, "height": 10001}', '{"width": 99999999, "height": 1}']) {
			expect(() => resolveContextOptions(`{"viewport": ${viewport}}`), viewport).toThrow('with whole numbers from 1 to 10000');
		}
	});

	it('accepts a deviceScaleFactor up to 5 and refuses one above it', () => {
		expect(resolveContextOptions('{"deviceScaleFactor": 5}')).toEqual({deviceScaleFactor: 5});
		for (const value of [5.01, 6, 100, 1e9]) {
			expect(() => resolveContextOptions(JSON.stringify({deviceScaleFactor: value})), String(value)).toThrow('"deviceScaleFactor" must be a number above 0 and at most 5');
		}
	});

	it('accepts language tags and refuses text the browser would only refuse after it started', () => {
		for (const locale of ['en', 'de-DE', 'en-US', 'zh-Hant-TW', 'sr-Latn-RS', 'pt-BR']) {
			expect(resolveContextOptions(JSON.stringify({locale})).locale, locale).toBe(locale);
		}

		for (const locale of ['de_DE', 'not a locale', 'x', 'en-', '-en', 'de-DE,en', 'en US', '123', 'e']) {
			expect(() => resolveContextOptions(JSON.stringify({locale})), locale).toThrow(`"locale" must be a language tag such as "de-DE", got "${locale}"`);
		}
	});

	it('accepts IANA time zones and refuses unknown ones and UTC offsets', () => {
		for (const timezoneId of ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Kolkata', 'Australia/Lord_Howe']) {
			expect(resolveContextOptions(JSON.stringify({timezoneId})).timezoneId, timezoneId).toBe(timezoneId);
		}

		for (const timezoneId of ['Mars/Olympus', 'Europe/Berlinn', 'Berlin', '+01:00', '-0500', 'not a zone', 'Europe/']) {
			expect(() => resolveContextOptions(JSON.stringify({timezoneId})), timezoneId).toThrow(`"timezoneId" must be an IANA time zone such as "Europe/Berlin", got "${timezoneId}"`);
		}
	});

	it('returns a copy of the viewport', () => {
		const result = resolveContextOptions('{"viewport": {"width": 1, "height": 2}}');
		expect(result.viewport).toEqual({width: 1, height: 2});
	});

	it('reports the first problem of several', () => {
		expect(() => resolveContextOptions('{"colorScheme": "dark", "bogus": 1, "isMobile": "x"}')).toThrow(/unknown option "bogus"/v);
	});
});

describe('resolveDesktopViewports', () => {
	const defaults = [{width: 540, height: 405}, {width: 600, height: 450}];

	it('keeps the fixed sizes without a viewport override', () => {
		expect(resolveDesktopViewports(defaults)).toBe(defaults);
		expect(resolveDesktopViewports(defaults, {})).toBe(defaults);
		expect(resolveDesktopViewports(defaults, {colorScheme: 'dark'})).toBe(defaults);
	});

	it('uses only the viewport of the context-options when there is one', () => {
		expect(resolveDesktopViewports(defaults, {viewport: {width: 1440, height: 900}})).toEqual([{width: 1440, height: 900}]);
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
			.toEqual({warning: 'Unknown wait-until "bogus", using "networkidle".', notice: undefined});
	});

	it('notes legacy values', () => {
		expect(describeWaitUntil('networkidle0', mapWaitUntil('networkidle0')).notice)
			.toBe('wait-until "networkidle0" is a legacy Puppeteer value, using Playwright\'s "networkidle".');
	});

	it('is silent for Playwright values', () => {
		expect(describeWaitUntil('load', mapWaitUntil('load'))).toEqual({warning: undefined, notice: undefined});
	});
});

describe('parseSizes', () => {
	const size = (width, height, scale = 1, isMobile = false) => ({
		width, height, scale, mobile: isMobile,
	});

	it('is empty for an empty input', () => {
		for (const raw of ['', ' \t ', undefined, null, ',', ' , ,, ']) {
			expect(parseSizes(raw), String(raw)).toEqual([]);
		}
	});

	it('parses every form of an entry', () => {
		expect(parseSizes('1440x900')).toEqual([size(1440, 900)]);
		expect(parseSizes('1440x900@2')).toEqual([size(1440, 900, 2)]);
		expect(parseSizes('390x844:mobile')).toEqual([size(390, 844, 1, true)]);
		expect(parseSizes('390x844@3:mobile')).toEqual([size(390, 844, 3, true)]);
		expect(parseSizes('800x600@1.5')).toEqual([size(800, 600, 1.5)]);
		expect(parseSizes('800x600@2.75:mobile')).toEqual([size(800, 600, 2.75, true)]);
	});

	it('parses a list in the order it is written', () => {
		expect(parseSizes('1440x900,390x844@3:mobile,1920x1080@2')).toEqual([size(1440, 900), size(390, 844, 3, true), size(1920, 1080, 2)]);
	});

	it('ignores whitespace around entries and empty entries', () => {
		expect(parseSizes('  1440x900 ,\t390x844@3:mobile\n, ')).toEqual([size(1440, 900), size(390, 844, 3, true)]);
		expect(parseSizes('1440x900,')).toEqual([size(1440, 900)]);
		expect(parseSizes(',1440x900,,390x844')).toEqual([size(1440, 900), size(390, 844)]);
	});

	it('accepts an upper case x and :Mobile', () => {
		expect(parseSizes('1440X900@2:MOBILE')).toEqual([size(1440, 900, 2, true)]);
		expect(parseSizes('390x844:Mobile')).toEqual([size(390, 844, 1, true)]);
	});

	it('normalises numbers: leading zeros and trailing decimals', () => {
		expect(parseSizes('01440x0900@2.0')).toEqual([size(1440, 900, 2)]);
		expect(parseSizes('800x600@1.50')).toEqual([size(800, 600, 1.5)]);
	});

	it('captures entries that are the same after normalising once, keeping the first position', () => {
		expect(parseSizes('1440x900,390x844,1440x900')).toEqual([size(1440, 900), size(390, 844)]);
		expect(parseSizes('1440x900@1,1440X900,1440x900@1.0')).toEqual([size(1440, 900)]);
		expect(parseSizes('390x844:mobile,390x844:MOBILE')).toEqual([size(390, 844, 1, true)]);
	});

	it('keeps entries apart that differ in the scale or in mobile', () => {
		expect(parseSizes('1440x900,1440x900@2,1440x900:mobile,1440x900@2:mobile')).toHaveLength(4);
	});

	it('accepts the limits of width and height', () => {
		expect(parseSizes('1x1,10000x10000')).toEqual([size(1, 1), size(10_000, 10_000)]);
	});

	it('accepts the limits of the scale', () => {
		expect(parseSizes('100x100@5')).toEqual([size(100, 100, 5)]);
		expect(parseSizes('100x100@0.1')).toEqual([size(100, 100, 0.1)]);
	});

	it('fails for width or height out of the range', () => {
		for (const entry of ['0x900', '1440x0', '10001x900', '1440x10001', '00x00', '99999x1']) {
			expect(() => parseSizes(entry), entry).toThrow(`"${entry}": width and height must be whole numbers from 1 to 10000`);
		}
	});

	it('fails for a scale below 0.1 or above 5', () => {
		for (const entry of ['1440x900@0', '1440x900@0.0', '1440x900@0.09', '1440x900@0.01', '1440x900@5.01', '1440x900@6', '1440x900@100:mobile']) {
			expect(() => parseSizes(entry), entry).toThrow(`"${entry}": the scale must be a number from 0.1 to 5`);
		}
	});

	it('fails for every kind of malformed entry, naming it and the grammar', () => {
		const malformed = [
			'1440',
			'1440x',
			'x900',
			'1440*900',
			'1440 x 900',
			'1440x900@',
			'1440x900@x',
			'1440x900@.5',
			'1440x900@2.',
			'1440x900@-2',
			'1440x900@2@3',
			'-1440x900',
			'+1440x900',
			'1.5x900',
			'1440x900.5',
			'1e3x900',
			'1440x900:',
			'1440x900:desktop',
			'1440x900:mobile:mobile',
			'mobile',
			'iPhone 13',
			'1440x900x2',
			'0x1440x900',
			'１４４０x900',
		];
		for (const entry of malformed) {
			const attempt = () => parseSizes(entry);
			expect(attempt, entry).toThrow('does not match WIDTHxHEIGHT[@SCALE][:mobile]');
			expect(attempt, entry).toThrow('for example 1440x900, 1440x900@2, 390x844@3:mobile');
		}
	});

	it('lists every invalid entry, not only the first', () => {
		let message;
		try {
			parseSizes('1440x900, 1440*900, 0x10, 390x844@9, 390x844:mobile');
		} catch (error) {
			({message} = error);
		}

		expect(message).toContain('sizes has invalid entries');
		expect(message).toContain('- "1440*900": does not match');
		expect(message).toContain('- "0x10": width and height must be');
		expect(message).toContain('- "390x844@9": the scale must be');
		expect(message).not.toContain('1440x900"');
		expect(message).not.toContain('"390x844:mobile"');
	});

	it('says "an invalid entry" for one', () => {
		expect(() => parseSizes('big')).toThrow('sizes has an invalid entry; each entry must look like WIDTHxHEIGHT[@SCALE][:mobile]');
		// The examples end with a full stop, not with a colon that reads as part of the last one
		expect(() => parseSizes('big')).toThrow('390x844@3:mobile. Not valid:\n- "big"');
	});

	it('fails the whole input when one entry is invalid, instead of skipping it', () => {
		expect(() => parseSizes('1440x900,oops')).toThrow('"oops"');
	});
});

describe('sizeFileBase', () => {
	it('is size<W>x<H>, with the scale and mobile only when they are not the defaults', () => {
		expect(sizeFileBase({
			width: 1440, height: 900, scale: 1, mobile: false,
		})).toBe('size1440x900');
		expect(sizeFileBase({
			width: 1440, height: 900, scale: 2, mobile: false,
		})).toBe('size1440x900-2x');
		expect(sizeFileBase({
			width: 390, height: 844, scale: 3, mobile: true,
		})).toBe('size390x844-3x-mobile');
		expect(sizeFileBase({
			width: 390, height: 844, scale: 1, mobile: true,
		})).toBe('size390x844-mobile');
		expect(sizeFileBase({
			width: 800, height: 600, scale: 1.5, mobile: false,
		})).toBe('size800x600-1.5x');
	});

	it('is safe in file names and URLs for every parsed size', () => {
		for (const entry of parseSizes('1x1,1440x900@2.75:mobile,10000x10000@5,390x844@0.5')) {
			expect(sizeFileBase(entry)).toMatch(/^size\d+x\d+(?:-[\d.]+x)?(?:-mobile)?$/v);
		}
	});

	it('gives different sizes different names', () => {
		const names = parseSizes('1440x900,1440x900@2,1440x900:mobile,1440x900@2:mobile,900x1440').map(entry => sizeFileBase(entry));
		expect(new Set(names).size).toBe(names.length);
	});
});

describe('sizeContextOptions', () => {
	it('is the viewport and the scale factor', () => {
		expect(sizeContextOptions({
			width: 1440, height: 900, scale: 2, mobile: false,
		})).toEqual({viewport: {width: 1440, height: 900}, deviceScaleFactor: 2});
	});

	it('adds isMobile and hasTouch only for mobile', () => {
		expect(sizeContextOptions({
			width: 390, height: 844, scale: 3, mobile: true,
		})).toEqual({
			viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
		});
		expect('isMobile' in sizeContextOptions({
			width: 1, height: 1, scale: 1, mobile: false,
		})).toBe(false);
	});

	it('wins over the context-options of the call when merged on top of them', () => {
		const merged = buildContextOptions({}, undefined, {
			colorScheme: 'dark',
			viewport: {width: 1, height: 1},
			deviceScaleFactor: 9,
			...sizeContextOptions({
				width: 390, height: 844, scale: 3, mobile: false,
			}),
		});
		expect(merged).toEqual({colorScheme: 'dark', viewport: {width: 390, height: 844}, deviceScaleFactor: 3});
	});

	it('leaves isMobile of the context-options alone for a size that is not mobile', () => {
		const merged = buildContextOptions({}, undefined, {
			isMobile: true,
			...sizeContextOptions({
				width: 390, height: 844, scale: 1, mobile: false,
			}),
		});
		expect(merged.isMobile).toBe(true);
	});
});
