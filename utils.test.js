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
	resolveContextOptions,
	resolveDesktopViewports,
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
