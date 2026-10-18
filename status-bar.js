/* global document, Image -- used inside page.evaluate callbacks */
import {Buffer} from 'node:buffer';

// A mock phone status bar for captures of a mobile emulation, for screenshots
// that are meant to look like an app store listing. It is drawn, never read: a
// clock on the left and a signal, wifi and battery indicator on the right, in
// system fonts, one geometry per platform. It does not draw a notch or a dynamic
// island, and the glyph shapes depend on the fonts of the machine (the CI
// runners have no San Francisco, so the clock is a plain sans-serif there).
//
// How it works, with no new dependency: the bar is HTML and inline SVG rendered
// in a throwaway page (no network, no script) to a transparent PNG at the width
// and scale factor of the capture; the capture is taken as a lossless PNG; both
// are drawn on a canvas in a second throwaway page and exported with the type
// and quality of the capture. Everything that does not need a browser is a pure
// function so it can be unit tested.

const PLATFORMS = ['none', 'ios', 'android'];
const THEMES = ['auto', 'light', 'dark'];
const MODES = ['strip', 'overlay'];

// Height of the bar in CSS pixels: iOS 47 (the notch-era status bar; a phone with
// a dynamic island has 54), Android 24
const BAR_HEIGHTS = {ios: 47, android: 24};

const DEFAULT_TIME = '9:41';
const DEFAULT_BATTERY = 100;
const LOW_BATTERY = 20;

const TIME = /^(?<hours>\d{1,2}):(?<minutes>\d{2})$/v;

const IOS_FONTS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "DejaVu Sans", Arial, sans-serif';
const ANDROID_FONTS = 'Roboto, "Noto Sans", "DejaVu Sans", Arial, sans-serif';

const BATTERY_COLORS = {charging: '#30d158', low: '#ff3b30'};

const escapeHtml = value =>
	String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');

function failOnEnum(name, allowed, input) {
	return new Error(`Unknown ${name} "${String(input).trim()}"; use ${allowed.join(', ')}.`);
}

// The value of an enum input, lower case; empty means the default
function resolveChoice(name, allowed, input, fallback) {
	const raw = String(input ?? '').trim().toLowerCase();
	if (raw === '') {
		return fallback;
	}

	if (!allowed.includes(raw)) {
		throw failOnEnum(name, allowed, input);
	}

	return raw;
}

function resolveTime(input) {
	const raw = String(input ?? '').trim();
	if (raw === '') {
		return DEFAULT_TIME;
	}

	const match = TIME.exec(raw);
	const hours = Number(match?.groups.hours);
	const minutes = Number(match?.groups.minutes);
	if (!match || hours > 23 || minutes > 59) {
		throw new Error(`Invalid status-bar-time "${raw}"; use H:MM or HH:MM from 0:00 to 23:59, for example 9:41 or 18:05.`);
	}

	// 09:41 and 9:41 are the same time
	return `${hours}:${match.groups.minutes}`;
}

function resolveBattery(input) {
	const raw = String(input ?? '').trim();
	if (raw === '') {
		return DEFAULT_BATTERY;
	}

	const value = Number(raw);
	if (!/^\d+$/v.test(raw) || value > 100) {
		throw new Error(`Invalid status-bar-battery "${raw}"; use a whole number from 0 to 100.`);
	}

	return value;
}

function resolveCharging(input) {
	const raw = String(input ?? '').trim().toLowerCase();
	if (raw === '' || raw === 'false') {
		return false;
	}

	if (raw === 'true') {
		return true;
	}

	throw new Error(`Invalid status-bar-charging "${String(input).trim()}"; use true or false.`);
}

/**
 Resolve and validate the status-bar-* inputs. A wrong value fails the run
 instead of falling back to a default: a wrong screenshot is worse than none.
 @param {{statusBar?: string, time?: string, battery?: string, charging?: string, theme?: string, mode?: string}} raw The raw inputs (empty means the default).
 @returns {{platform: 'none' | 'ios' | 'android', time: string, battery: number, charging: boolean, theme: 'auto' | 'light' | 'dark', mode: 'strip' | 'overlay'}} The options; the platform is none by default.
 @throws {Error} For an unknown platform, theme or mode, a time that is not H:MM or HH:MM from 0:00 to 23:59, a battery that is not a whole number from 0 to 100 or a charging that is not true or false.
 */
function resolveStatusBarOptions(raw = {}) {
	return {
		platform: resolveChoice('status-bar', PLATFORMS, raw.statusBar, 'none'),
		time: resolveTime(raw.time),
		battery: resolveBattery(raw.battery),
		charging: resolveCharging(raw.charging),
		theme: resolveChoice('status-bar-theme', THEMES, raw.theme, 'auto'),
		mode: resolveChoice('status-bar-mode', MODES, raw.mode, 'strip'),
	};
}

/**
 The height of the bar of a platform in CSS pixels.
 @param {string} platform none, ios or android.
 @returns {number} 47 for ios, 24 for android, 0 for none.
 */
function statusBarHeight(platform) {
	return BAR_HEIGHTS[platform] ?? 0;
}

/**
 The colour of the glyphs of the bar: dark glyphs on a light page, light glyphs
 on a dark one. `auto` follows the colour scheme the capture emulates
 (context-options colorScheme), `light` and `dark` are the colour of the glyphs.
 @param {'auto' | 'light' | 'dark'} theme The status-bar-theme.
 @param {string} [colorScheme] The emulated colour scheme, if any.
 @returns {'light' | 'dark'} The colour of the glyphs.
 */
function resolveGlyphColor(theme, colorScheme) {
	if (theme === 'light' || theme === 'dark') {
		return theme;
	}

	return colorScheme === 'dark' ? 'light' : 'dark';
}

// 4 of 4 bars, the bars rising
function signalSvg(color) {
	const heights = [4, 6.5, 9, 11.5];
	const bars = heights.map((height, index) =>
		`<rect x="${index * 4.5}" y="${12 - height}" width="3" height="${height}" rx="0.8"/>`,
	).join('');
	return `<svg width="17" height="12" viewBox="0 0 17 12" fill="${color}">${bars}</svg>`;
}

// A full wifi indicator: three arcs around the dot
function wifiSvg(color) {
	return `<svg width="17" height="12" viewBox="0 0 17 12" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round">`
		+ '<path d="M1.2 4.2A10 10 0 0 1 15.8 4.2"/>'
		+ '<path d="M3.6 6.6A6.6 6.6 0 0 1 13.4 6.6"/>'
		+ '<path d="M5.9 8.9A3.3 3.3 0 0 1 11.1 8.9"/>'
		+ `<circle cx="8.5" cy="11" r="1" fill="${color}" stroke="none"/>`
		+ '</svg>';
}

// A battery with the level as its fill: green and with a bolt while charging,
// red up to 20 percent
function batterySvg({battery, charging}, color, hairline) {
	const inner = 20;
	const fill = battery === 0 ? 0 : Math.max(1, Math.round(inner * battery / 100 * 10) / 10);
	let fillColor = color;
	if (charging) {
		fillColor = BATTERY_COLORS.charging;
	} else if (battery <= LOW_BATTERY) {
		fillColor = BATTERY_COLORS.low;
	}

	const bolt = charging
		? `<path d="M12.9 1.8 8.5 6.5h2.8L10.3 10.2 14.7 5.4h-2.8z" fill="#ffffff" stroke="${color}" stroke-width="0.7" stroke-linejoin="round"/>`
		: '';
	return '<svg width="27" height="12" viewBox="0 0 27 12" fill="none">'
		+ `<rect x="0.5" y="0.5" width="23" height="11" rx="3.2" stroke="${color}" stroke-opacity="0.45" stroke-width="${hairline}"/>`
		+ `<rect x="2" y="2" width="${fill}" height="8" rx="1.8" fill="${fillColor}"/>`
		+ `<rect x="24.8" y="4" width="1.4" height="4" rx="0.7" fill="${color}" fill-opacity="0.5"/>`
		+ `${bolt}</svg>`;
}

/**
 The HTML of the bar: transparent, exactly `width` CSS pixels wide and as high as
 the platform's bar, nothing else on the page. Only the time (escaped) and numbers
 vary.
 @param {{platform: string, time: string, battery: number, charging: boolean, glyphs?: 'light' | 'dark'}} options The resolved options and the colour of the glyphs (dark when not given).
 @param {number} width The width in CSS pixels, that of the capture.
 @param {number} dpr The device scale factor of the capture, which makes the outline of the battery one device pixel or more.
 @returns {string} A complete HTML document.
 */
function buildStatusBarHtml(options, width, dpr) {
	const {platform} = options;
	const height = statusBarHeight(platform);
	const color = options.glyphs === 'light' ? '#ffffff' : '#000000';
	const hairline = Math.round(Math.max(1, dpr)) / dpr;
	const icons = platform === 'android'
		? [wifiSvg(color), signalSvg(color), batterySvg(options, color, hairline)]
		: [signalSvg(color), wifiSvg(color), batterySvg(options, color, hairline)];
	// On iOS the content sits in the lower part of the bar, the clock in the left
	// ear; on Android everything is centred, with a smaller clock
	const layout = platform === 'android'
		? `font: 500 12px/${height}px ${ANDROID_FONTS}; padding: 0 12px 0 16px; align-items: center; gap: 5px;`
		: `font: 600 17px/20px ${IOS_FONTS}; padding: 18px 30px 0 34px; align-items: center; gap: 6px;`;
	return [
		'<!doctype html>',
		'<html><head><meta charset="utf-8"><style>',
		'html, body { margin: 0; background: transparent; }',
		`#bar { box-sizing: border-box; width: ${width}px; height: ${height}px; display: flex; color: ${color}; ${layout} }`,
		'#time { flex: 1; letter-spacing: 0.1px; white-space: nowrap; }',
		'#icons { display: flex; align-items: center; gap: 6px; }',
		'svg { display: block; }',
		'</style></head><body>',
		`<div id="bar" data-platform="${escapeHtml(platform)}"><span id="time">${escapeHtml(options.time)}</span>`,
		`<span id="icons">${icons.join('')}</span></div>`,
		'</body></html>',
	].join('');
}

/**
 Width and height in pixels of a PNG, from its header.
 @param {Buffer} buffer A PNG file.
 @returns {{width: number, height: number}} The width and height of the image in pixels.
 @throws {Error} When the buffer is not a PNG.
 */
function pngSize(buffer) {
	if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
		throw new Error('Not a PNG image');
	}

	return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

// Runs in the page: draw the capture and the bar on a canvas and encode it; resolves to
// {data (base64, empty when the canvas is too large to encode), width, height}
async function compositeInPage({captureData, barData, mode, type, quality}) {
	const load = source => new Promise((resolve, reject) => {
		const image = new Image();
		image.addEventListener('load', () => {
			resolve(image);
		});
		image.addEventListener('error', () => {
			reject(new Error('The image could not be decoded'));
		});
		image.src = source;
	});
	const [capture, bar] = await Promise.all([load(captureData), load(barData)]);
	const canvas = document.createElement('canvas');
	canvas.width = capture.naturalWidth;
	canvas.height = capture.naturalHeight + (mode === 'strip' ? bar.naturalHeight : 0);
	// Opaque: every pixel is painted, so the PNG needs no alpha channel
	const context = canvas.getContext('2d', {alpha: false});
	if (!context) {
		// No context for a canvas that is too large
		return {data: '', width: canvas.width, height: canvas.height};
	}

	if (mode === 'strip') {
		// The bar gets the colour of the top edge of the page, as a bar over the app would
		const probe = document.createElement('canvas');
		probe.width = capture.naturalWidth;
		probe.height = 1;
		const probeContext = probe.getContext('2d');
		probeContext.drawImage(capture, 0, 0);
		const {data} = probeContext.getImageData(0, 0, probe.width, 1);
		const sum = [0, 0, 0];
		for (let index = 0; index < data.length; index += 4) {
			sum[0] += data[index];
			sum[1] += data[index + 1];
			sum[2] += data[index + 2];
		}

		const pixels = data.length / 4;
		context.fillStyle = `rgb(${sum.map(value => Math.round(value / pixels)).join(',')})`;
		context.fillRect(0, 0, canvas.width, bar.naturalHeight);
		context.drawImage(capture, 0, bar.naturalHeight);
	} else {
		context.drawImage(capture, 0, 0);
	}

	context.drawImage(bar, 0, 0, canvas.width, bar.naturalHeight);
	const mime = type === 'jpeg' ? 'image/jpeg' : 'image/png';
	const url = canvas.toDataURL(mime, quality === undefined ? undefined : quality / 100);
	// A canvas above the limit of the browser gives "data:," instead of an image
	return {
		data: url.startsWith('data:image/') ? url.slice(url.indexOf(',') + 1) : '',
		width: canvas.width,
		height: canvas.height,
	};
}

const toDataUrl = buffer => `data:image/png;base64,${buffer.toString('base64')}`;

/**
 Render the bar to a transparent PNG in a throwaway page: no network, no script.
 @param {object} browser A Playwright browser.
 @param {object} options The resolved options with `glyphs`.
 @param {{width: number, dpr: number}} size The width in CSS pixels and the device scale factor.
 @returns {Promise<Buffer>} The PNG.
 */
async function renderStatusBar(browser, options, {width, dpr}) {
	// A viewport is a whole number of CSS pixels (a scale factor of 2.625 makes 412 px 1082 px of image)
	const cssWidth = Math.round(width);
	const context = await browser.newContext({
		viewport: {width: cssWidth, height: statusBarHeight(options.platform)},
		deviceScaleFactor: dpr,
		javaScriptEnabled: false,
		offline: true,
	});
	try {
		const page = await context.newPage();
		await page.setContent(buildStatusBarHtml(options, cssWidth, dpr));
		return await page.screenshot({type: 'png', omitBackground: true});
	} finally {
		await context.close();
	}
}

/**
 Put the bar into an image: above it (`strip`, the image grows by the height of
 the bar) or over its top (`overlay`, the size stays). The image is encoded again
 with the given type and quality, so a JPEG is compressed once.
 @param {object} browser A Playwright browser.
 @param {Buffer} imageBuffer The capture as a PNG.
 @param {object} options The resolved options with `glyphs`.
 @param {{type: string, quality?: number, barBuffer?: Buffer, dpr?: number}} settings type png or jpeg and the JPEG quality; the bar PNG when it was rendered already, else it is rendered at the scale factor `dpr` of the capture.
 @returns {Promise<Buffer>} The image with the bar.
 */
async function applyStatusBar(browser, imageBuffer, options, settings) {
	const {type, quality, dpr = 1} = settings;
	const {width} = pngSize(imageBuffer);
	const barBuffer = settings.barBuffer ?? await renderStatusBar(browser, options, {width: width / dpr, dpr});
	const context = await browser.newContext({javaScriptEnabled: true, offline: true});
	try {
		const page = await context.newPage();
		const {data, width: canvasWidth, height: canvasHeight} = await page.evaluate(compositeInPage, {
			captureData: toDataUrl(imageBuffer),
			barData: toDataUrl(barBuffer),
			mode: options.mode,
			type,
			quality,
		});
		if (data === '') {
			throw new Error(`The image is too large to add a status bar (canvas limit): ${canvasWidth}x${canvasHeight}`);
		}

		return Buffer.from(data, 'base64');
	} finally {
		await context.close();
	}
}

/**
 The status bar of the captures of one page, for takeScreenshot: it knows how
 much room the bar takes and puts it into an image. The bar is rendered once per
 width, however many qualities the JPEG step-down tries.
 @param {object} browser A Playwright browser.
 @param {object} options The resolved options with `glyphs`.
 @param {number} dpr The device scale factor of the page.
 @returns {{reserveCss: number, compose: (png: Buffer, settings: {type: string, quality?: number}) => Promise<Buffer>}} reserveCss is the height the first image grows by (0 for overlay).
 */
function createStatusBar(browser, options, dpr) {
	const bars = new Map();
	return {
		reserveCss: options.mode === 'strip' ? statusBarHeight(options.platform) : 0,
		async compose(png, {type, quality}) {
			const {width} = pngSize(png);
			if (!bars.has(width)) {
				bars.set(width, renderStatusBar(browser, options, {width: width / dpr, dpr}));
			}

			const barBuffer = await bars.get(width);
			return applyStatusBar(browser, png, options, {
				type, quality, barBuffer, dpr,
			});
		},
	};
}

export {
	BAR_HEIGHTS,
	DEFAULT_BATTERY,
	DEFAULT_TIME,
	MODES,
	PLATFORMS,
	THEMES,
	applyStatusBar,
	buildStatusBarHtml,
	createStatusBar,
	pngSize,
	renderStatusBar,
	resolveGlyphColor,
	resolveStatusBarOptions,
	statusBarHeight,
};
