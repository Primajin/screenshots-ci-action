// Pure helpers (no browser, no GitHub context) so they can be unit tested.

const DEFAULT_WAITUNTIL_OPTION = 'networkidle';
const DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT = 30_000; // 30 seconds

// Values accepted by Playwright's page.goto({ waitUntil }).
const PLAYWRIGHT_WAITUNTIL_OPTIONS = [
	'load',
	'domcontentloaded',
	'networkidle',
	'commit',
];

// Legacy Puppeteer values mapped onto their closest Playwright equivalent.
// Playwright has a single network-idle mode (no network connections for 500ms),
// which is closest to Puppeteer's networkidle0; networkidle2 is approximated.
const LEGACY_WAITUNTIL_MAP = {
	networkidle0: 'networkidle',
	networkidle2: 'networkidle',
};

const DEVICES_DOCS_URL
	= 'https://github.com/microsoft/playwright/blob/main/packages/isomorphic/deviceDescriptorsSource.json';

/**
 Resolve the `wait-until` input to a Playwright value.
 Unknown / empty values fall back to the default.
 @param {string} [input] Raw wait-until input.
 @returns {{ value: string, fallback: boolean, mappedFrom?: string }} The Playwright value and how it was derived.
 */
function mapWaitUntil(input) {
	const raw = String(input || '').trim().toLowerCase();
	if (!raw) {
		return {value: DEFAULT_WAITUNTIL_OPTION, fallback: false};
	}

	if (PLAYWRIGHT_WAITUNTIL_OPTIONS.includes(raw)) {
		return {value: raw, fallback: false};
	}

	if (Object.hasOwn(LEGACY_WAITUNTIL_MAP, raw)) {
		return {
			value: LEGACY_WAITUNTIL_MAP[raw],
			fallback: false,
			mappedFrom: raw,
		};
	}

	return {value: DEFAULT_WAITUNTIL_OPTION, fallback: true};
}

function levenshtein(a, b) {
	const row = Array.from({length: b.length + 1}, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		let previous = row[0];
		row[0] = i;
		for (let j = 1; j <= b.length; j++) {
			const temporary = row[j];
			row[j]
				= a[i - 1] === b[j - 1] ? previous : 1 + Math.min(previous, row[j], row[j - 1]);
			previous = temporary;
		}
	}

	return row[b.length];
}

const normalize = name => name.toLowerCase().replaceAll(/[^0-9a-z]/gv, '');

/**
 Case-insensitive "did you mean" suggestions for an unknown device name.
 @param {string} name Requested device name.
 @param {string[]} deviceNames Known Playwright device names.
 @param {number} [limit] Maximum number of suggestions.
 @returns {string[]} Closest device names.
 */
function findCloseDevices(name, deviceNames, limit = 5) {
	const needle = normalize(name);
	if (!needle) {
		return [];
	}

	const scored = [];
	for (const candidate of deviceNames) {
		const hay = normalize(candidate);
		let score;
		if (hay === needle) {
			score = 0;
		} else if (hay.includes(needle) || needle.includes(hay)) {
			score = 1 + (Math.abs(hay.length - needle.length) / 100);
		} else {
			const distance = levenshtein(needle, hay);
			if (distance <= 3) {
				score = 2 + distance;
			}
		}

		if (score !== undefined) {
			scored.push({candidate, score});
		}
	}

	return scored
		.toSorted((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
		.slice(0, limit)
		.map(({candidate}) => candidate);
}

/**
 Split the comma separated `devices` input and resolve each entry against the
 known device names. An entry matching exactly one device case-insensitively
 is accepted and normalised to that device's name.
 @param {string} input Comma separated device names.
 @param {string[]} deviceNames Known Playwright device names.
 @returns {{ valid: string[], invalid: { name: string, suggestions: string[] }[] }} Resolved and unknown devices.
 */
function resolveDevices(input, deviceNames) {
	const requested = String(input || '')
		.split(',')
		.map(name => name.trim())
		.filter(Boolean);
	const valid = [];
	const invalid = [];
	for (const name of requested) {
		if (deviceNames.includes(name)) {
			valid.push(name);
			continue;
		}

		const ci = deviceNames.filter(
			d => d.toLowerCase() === name.toLowerCase(),
		);
		if (ci.length === 1) {
			valid.push(ci[0]);
			continue;
		}

		invalid.push({name, suggestions: findCloseDevices(name, deviceNames)});
	}

	return {valid: [...new Set(valid)], invalid};
}

/**
 Human readable error for unknown devices.
 @param {{ name: string, suggestions: string[] }[]} invalid Unknown devices with suggestions.
 @returns {string} Error message.
 */
function formatInvalidDevicesError(invalid) {
	const lines = ['Following device names are invalid:'];
	for (const {name, suggestions} of invalid) {
		lines.push(
			suggestions.length > 0
				? `- "${name}" (did you mean: ${suggestions
					.map(s => `"${s}"`)
					.join(', ')}?)`
				: `- "${name}"`,
		);
	}

	lines.push(
		`See Playwright's device list for valid names: ${DEVICES_DOCS_URL}`,
	);
	return lines.join('\n');
}

/**
 Build the arguments for Playwright's page.waitForSelector.
 - visible -> state "visible", hidden -> state "hidden", else "attached".
 If both are set, "visible" wins.
 - timeout: empty/invalid/negative -> 30000, 0 -> 0 (timeout disabled).
 @param {{ visible?: boolean, hidden?: boolean, timeout?: string|number }} opts Selector wait settings.
 @returns {{ state: 'attached'|'visible'|'hidden', timeout: number }} Options for page.waitForSelector.
 */
function buildSelectorWaitOptions({visible, hidden, timeout} = {}) {
	let state = 'attached';
	if (visible) {
		state = 'visible';
	} else if (hidden) {
		state = 'hidden';
	}

	const raw = String(timeout ?? '').trim();
	let parsed = raw === '' ? NaN : Number(raw);
	if (!Number.isFinite(parsed) || parsed < 0) {
		parsed = DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT;
	}

	return {state, timeout: parsed};
}

// The Playwright context options the `context-options` input may set. Anything
// else (proxy, permissions, extraHTTPHeaders, storageState, ...) is refused, so
// the input cannot change what the action itself relies on.
const CONTEXT_OPTION_ENUMS = {
	colorScheme: ['light', 'dark', 'no-preference'],
	reducedMotion: ['reduce', 'no-preference'],
	forcedColors: ['active', 'none'],
};
const CONTEXT_OPTION_BOOLEANS = new Set(['isMobile', 'hasTouch']);
const CONTEXT_OPTION_STRINGS = new Set(['locale', 'timezoneId', 'userAgent']);
const CONTEXT_OPTION_KEYS = [
	...Object.keys(CONTEXT_OPTION_ENUMS),
	'deviceScaleFactor',
	...CONTEXT_OPTION_BOOLEANS,
	'viewport',
	...CONTEXT_OPTION_STRINGS,
];

// The limits the browser can take (the same as for the sizes input)
const CONTEXT_MAX_SIZE = 10_000;
const CONTEXT_MAX_SCALE = 5;

const isPlainObject = value =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const describeValue = value => JSON.stringify(value) ?? String(value);

// A BCP 47 language tag such as de-DE
function validateLocale(value) {
	try {
		if (Intl.getCanonicalLocales(value).length === 1) {
			return value;
		}
	} catch {}

	throw new Error(`context-options: "locale" must be a language tag such as "de-DE", got ${describeValue(value)}.`);
}

// An IANA time zone such as Europe/Berlin (not a UTC offset: the browser does not take those)
function validateTimeZone(value) {
	try {
		if (!/^[+\-]/v.test(value.trim())) {
			// A RangeError for a zone it does not know
			new Intl.DateTimeFormat('en', {timeZone: value}).format();
			return value;
		}
	} catch {}

	throw new Error(`context-options: "timezoneId" must be an IANA time zone such as "Europe/Berlin", got ${describeValue(value)}.`);
}

function validateString(key, value) {
	if (key === 'locale') {
		return validateLocale(value);
	}

	return key === 'timezoneId' ? validateTimeZone(value) : value;
}

// Throws for a bad value of one key
function validateContextOption(key, value) {
	if (Object.hasOwn(CONTEXT_OPTION_ENUMS, key)) {
		if (!CONTEXT_OPTION_ENUMS[key].includes(value)) {
			throw new Error(`context-options: "${key}" must be one of ${CONTEXT_OPTION_ENUMS[key].map(allowed => `"${allowed}"`).join(', ')}, got ${describeValue(value)}.`);
		}

		return value;
	}

	if (CONTEXT_OPTION_BOOLEANS.has(key)) {
		if (typeof value !== 'boolean') {
			throw new TypeError(`context-options: "${key}" must be true or false, got ${describeValue(value)}.`);
		}

		return value;
	}

	if (CONTEXT_OPTION_STRINGS.has(key)) {
		if (typeof value !== 'string' || value.trim() === '') {
			throw new TypeError(`context-options: "${key}" must be a non-empty string, got ${describeValue(value)}.`);
		}

		// The browser refuses a locale or a time zone it does not know only after it
		// was launched, so they are checked here with the same ICU data
		return validateString(key, value);
	}

	if (key === 'deviceScaleFactor') {
		if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > CONTEXT_MAX_SCALE) {
			throw new TypeError(`context-options: "deviceScaleFactor" must be a number above 0 and at most ${CONTEXT_MAX_SCALE}, got ${describeValue(value)}.`);
		}

		return value;
	}

	// The viewport
	const isSize = size => Number.isSafeInteger(size) && size > 0 && size <= CONTEXT_MAX_SIZE;
	if (!isPlainObject(value) || !isSize(value.width) || !isSize(value.height) || Object.keys(value).length !== 2) {
		throw new TypeError(`context-options: "viewport" must be an object like {"width": 1440, "height": 900} with whole numbers from 1 to ${CONTEXT_MAX_SIZE}, got ${describeValue(value)}.`);
	}

	return {width: value.width, height: value.height};
}

/**
 Resolve the `context-options` input: a JSON object with Playwright browser
 context options that are applied to every capture context (desktop and
 devices). Only the options in CONTEXT_OPTION_KEYS are accepted.
 @param {string} [raw] The raw input; empty means no options.
 @returns {object} The validated options ({} for an empty input).
 @throws {Error} With a message that names the problem, for invalid JSON, a value that is not an object, an unknown key or a value of the wrong type.
 */
function resolveContextOptions(raw) {
	const text = String(raw ?? '').trim();
	if (text === '') {
		return {};
	}

	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch (error) {
		throw new Error(`context-options is not valid JSON: ${error.message}`, {cause: error});
	}

	if (!isPlainObject(parsed)) {
		throw new TypeError(`context-options must be a JSON object like {"colorScheme": "dark"}, got ${Array.isArray(parsed) ? 'an array' : describeValue(parsed)}.`);
	}

	const options = {};
	for (const [key, value] of Object.entries(parsed)) {
		if (!CONTEXT_OPTION_KEYS.includes(key)) {
			throw new Error(`context-options: unknown option "${key}". Allowed: ${CONTEXT_OPTION_KEYS.join(', ')}.`);
		}

		options[key] = validateContextOption(key, value);
	}

	return options;
}

/**
 The viewports of the desktop captures: the fixed list, or - when the
 context-options set a `viewport` - only that one.
 @param {{width: number, height: number}[]} defaults The fixed desktop sizes.
 @param {object} [overrides] The resolved context-options.
 @returns {{width: number, height: number}[]} The sizes to capture.
 */
function resolveDesktopViewports(defaults, overrides = {}) {
	return overrides.viewport ? [overrides.viewport] : defaults;
}

/**
 Build Playwright browser.newContext options: the (optional) device
 descriptor / viewport options, the resolved `context-options` overrides and
 the storageState produced by the pre-script, merged in this order so that
 the overrides win over the descriptor and the pre-script session is never
 overridden. storageState is omitted when undefined so Playwright starts a
 clean context.
 @param {object} [descriptor] Playwright device descriptor.
 @param {object} [storageState] Session state from the pre-script.
 @param {object} [overrides] The resolved context-options.
 @returns {object} Options for browser.newContext.
 */
function buildContextOptions(descriptor = {}, storageState, overrides = {}) {
	return {
		...descriptor,
		...overrides,
		...((storageState !== undefined) && {storageState}),
	};
}

// The custom capture sizes of the `sizes` input.
const MIN_SIZE = 1;
const MAX_SIZE = 10_000;
const MIN_SCALE = 0.1;
const MAX_SCALE = 5;
const SIZE_GRAMMAR = 'WIDTHxHEIGHT[@SCALE][:mobile]';
const SIZE_EXAMPLES = '1440x900, 1440x900@2, 390x844@3:mobile';
// Digits only: no sign, no exponent, no spaces inside an entry
const SIZE_ENTRY = /^(?<width>\d+)x(?<height>\d+)(?:@(?<scale>\d+(?:\.\d+)?))?(?<mobile>:mobile)?$/iv;

// Why one entry is not valid, or undefined when it is: {width, height, scale, mobile}
function parseSizeEntry(entry) {
	const match = SIZE_ENTRY.exec(entry);
	if (!match) {
		return {problem: `does not match ${SIZE_GRAMMAR}`};
	}

	const width = Number(match.groups.width);
	const height = Number(match.groups.height);
	if (width < MIN_SIZE || width > MAX_SIZE || height < MIN_SIZE || height > MAX_SIZE) {
		return {problem: `width and height must be whole numbers from ${MIN_SIZE} to ${MAX_SIZE}`};
	}

	const scale = match.groups.scale === undefined ? 1 : Number(match.groups.scale);
	if (!(scale >= MIN_SCALE && scale <= MAX_SCALE)) {
		return {problem: `the scale must be a number from ${MIN_SCALE} to ${MAX_SCALE}`};
	}

	const size = {
		width,
		height,
		scale,
		mobile: match.groups.mobile !== undefined,
	};
	return {size};
}

/**
 Parse the `sizes` input: a comma separated list of custom capture sizes
 `WIDTHxHEIGHT[@SCALE][:mobile]`, for example `1440x900`, `1440x900@2` or
 `390x844@3:mobile`. Whitespace around an entry is ignored, so are empty
 entries (a trailing comma) and the case of `x` and `:mobile`; entries that are the same after
 normalising (`1440x900` and `1440X900@1`) are captured once. WIDTH and HEIGHT are whole
 numbers from 1 to 10000, SCALE (the device scale factor) a number from 0.1 to
 5 (default 1), `:mobile` switches isMobile and hasTouch on.
 @param {string} [raw] The raw input; empty means no sizes.
 @returns {{width: number, height: number, scale: number, mobile: boolean}[]} The sizes, in the order of their first appearance.
 @throws {Error} Naming every invalid entry and the expected form: a wrong size would give wrong screenshots, so nothing is skipped silently.
 */
function parseSizes(raw) {
	const entries = String(raw ?? '')
		.split(',')
		.map(entry => entry.trim())
		.filter(Boolean);
	const sizes = new Map();
	const problems = [];
	for (const entry of entries) {
		const {size, problem} = parseSizeEntry(entry);
		if (problem) {
			problems.push(`- "${entry}": ${problem}`);
		} else {
			sizes.set(`${size.width}x${size.height}@${size.scale}${size.mobile ? ':mobile' : ''}`, size);
		}
	}

	if (problems.length > 0) {
		throw new Error([
			`sizes has ${problems.length === 1 ? 'an invalid entry' : 'invalid entries'}; each entry must look like ${SIZE_GRAMMAR}, for example ${SIZE_EXAMPLES}. Not valid:`,
			...problems,
		].join('\n'));
	}

	return sizes.values().toArray();
}

/**
 The file name (without part, commit hash and extension) of a custom size:
 `size1440x900`, `size1440x900-2x`, `size390x844-3x-mobile`.
 @param {{width: number, height: number, scale: number, mobile: boolean}} size A parsed size.
 @returns {string} The name, safe in file names and URLs.
 */
function sizeFileBase({width, height, scale, mobile}) {
	return `size${width}x${height}${scale === 1 ? '' : `-${scale}x`}${mobile ? '-mobile' : ''}`;
}

/**
 The Playwright context options of a custom size, over the context-options of
 the call: the viewport and the scale factor of the size always win (it is the
 point of the entry), isMobile and hasTouch only when it is `:mobile`.
 @param {{width: number, height: number, scale: number, mobile: boolean}} size A parsed size.
 @returns {object} Options for buildContextOptions.
 */
function sizeContextOptions({width, height, scale, mobile}) {
	return {
		viewport: {width, height},
		deviceScaleFactor: scale,
		...(mobile && {isMobile: true, hasTouch: true}),
	};
}

/**
 Normalize the screenshot type input.
 @param {string} [input] Raw type input.
 @param {string} fallback Type used when the input is empty or unsupported.
 @returns {string} 'png' or 'jpeg' (or the fallback).
 */
function normalizeScreenshotType(input, fallback) {
	const type = String(input || fallback).toLowerCase();
	return ['png', 'jpeg'].includes(type) ? type : fallback;
}

/**
 Build the log messages for a mapped waitUntil input.
 @param {string} input Raw waitUntil input.
 @param {{ value: string, fallback: boolean, mappedFrom?: string }} result Result of mapWaitUntil.
 @returns {{ warning?: string, notice?: string }} Messages to log, if any.
 */
function describeWaitUntil(input, result) {
	const {value, fallback, mappedFrom} = result;
	const legacy = `wait-until "${mappedFrom}" is a legacy Puppeteer value, using Playwright's "${value}".`;
	return {
		warning: fallback ? `Unknown wait-until "${input}", using "${value}".` : undefined,
		notice: mappedFrom ? legacy : undefined,
	};
}

export {
	CONTEXT_OPTION_KEYS,
	describeWaitUntil,
	normalizeScreenshotType,
	DEFAULT_WAITUNTIL_OPTION,
	MAX_SCALE,
	MAX_SIZE,
	MIN_SCALE,
	MIN_SIZE,
	DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT,
	DEVICES_DOCS_URL,
	PLAYWRIGHT_WAITUNTIL_OPTIONS,
	buildContextOptions,
	buildSelectorWaitOptions,
	findCloseDevices,
	formatInvalidDevicesError,
	mapWaitUntil,
	parseSizes,
	resolveContextOptions,
	resolveDesktopViewports,
	resolveDevices,
	sizeContextOptions,
	sizeFileBase,
};
