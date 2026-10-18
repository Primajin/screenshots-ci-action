/* global document, window -- used inside page.evaluate callbacks */
import {promises as fs} from 'node:fs';

// Full page capture helpers.
//
// - Scroll through the document first so lazily rendered / scroll-reveal
//   content is on screen (the action never scrolled before).
// - Taller pages are captured as consecutive `clip` slices that each stay
//   below `max-image-height` output pixels and are written as separate files
//   (-part1, -part2, ...); nothing is stitched, cropped or downscaled. Why:
//   Chromium documents a 16384 device pixel texture limit that can bite on some
//   platforms and GPUs (asfand-dev/aktion measured a wrap on its runner; it is
//   not reproducible everywhere), GitHub's image proxy refuses comment images
//   over 5 MB, JPEG cannot exceed 65535 pixels per side, and one huge bitmap
//   costs a lot of memory.
// - JPEG slices are kept under the 5 MB limit by stepping the quality down.
// - The blank regions seen in long full page captures come from lazy and
//   scroll-reveal content that was never scrolled into view; scrolling first
//   fixes that.
//
// - full-page-strategy grow-viewport: instead of Chrome's own "full page" mode
//   (which paints what lies beyond the viewport without ever bringing it on
//   screen), the viewport is grown to the height of the page and the slices are
//   captured with clip and fullPage false. Everything is then on screen at
//   once, so a cross-origin iframe (a map embed) renders instead of coming out
//   blank, and lazy / scroll-reveal content is triggered without scrolling.
//   Approach of asfand-dev/aktion's capture-showcase.mjs (fitViewportToPage).
//
// Everything that does not need a browser is a pure function so it can be unit
// tested.

// Chromium's texture limit is 16384 device px; stay below it. This is also the
// ceiling for the max image height and its default.
const HARD_MAX_IMAGE_HEIGHT = 16_000;
const DEFAULT_MAX_IMAGE_HEIGHT = HARD_MAX_IMAGE_HEIGHT;
// Smaller values would only produce hundreds of files.
const MIN_MAX_IMAGE_HEIGHT = 100;
const WARN_PART_COUNT = 200;
// GitHub's camo proxy refuses comment images over 5 MB.
const MAX_IMAGE_BYTES = 4.8 * 1024 * 1024;
const PNG_WARN_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY_STEPS = [80, 70, 60, 50, 40]; // Starts at Playwright's default

// Full page strategies: how the page is brought entirely on screen
const FULL_PAGE_STRATEGIES = ['scroll', 'grow-viewport'];
const DEFAULT_FULL_PAGE_STRATEGY = 'scroll';
// For grow-viewport: the passes until the page height is stable, the wait after
// each resize, and the best-effort waits before the capture
const GROW_MAX_PASSES = 5;
const GROW_PASS_WAIT_MS = 500;
const GROW_IDLE_TIMEOUT_MS = 5000;
const GROW_SETTLE_MS = 1000;
// A viewport this tall (CSS px) is the most that grow-viewport asks of Chromium
const MAX_GROW_HEIGHT = 100_000;

const DEFAULT_MAX_SCROLL_MS = 15_000;
const DEFAULT_MAX_SCROLL_STEPS = 150;
const DEFAULT_STEP_WAIT_MS = 150;
const SETTLE_POLL_MS = 100;
const SETTLE_MAX_MS = 2000;
const NETWORK_IDLE_TIMEOUT_MS = 5000;

// Name of the input as users write it, for messages.
const MAX_IMAGE_HEIGHT_INPUT = 'max-image-height';

const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

// The scroll input is on by default: only these values switch it off.
function isScrollEnabled(input) {
	return !FALSE_VALUES.has(String(input ?? '').trim().toLowerCase());
}

/**
 Resolve the full-page-strategy input. Empty means the default.
 @param {string} [input] The full-page-strategy input as written.
 @returns {'scroll' | 'grow-viewport'} The strategy to use, scroll when the input is empty.
 @throws {Error} For any other value: a typo would silently give the capture the other strategy gets wrong, so the run fails instead.
 */
function resolveFullPageStrategy(input) {
	const raw = String(input ?? '').trim().toLowerCase();
	if (raw === '') {
		return DEFAULT_FULL_PAGE_STRATEGY;
	}

	if (!FULL_PAGE_STRATEGIES.includes(raw)) {
		throw new Error(`Unknown full-page-strategy "${String(input).trim()}"; use ${FULL_PAGE_STRATEGIES.join(' or ')}.`);
	}

	return raw;
}

/**
 Limit the height grow-viewport asks for.
 @param {number} height The measured height of the document in CSS px.
 @param {number} [maxHeight] The most the viewport is grown to.
 @returns {{height: number, capped: boolean}} The height to use and whether the page is taller than that.
 */
function capGrowHeight(height, maxHeight = MAX_GROW_HEIGHT) {
	return height > maxHeight ? {height: maxHeight, capped: true} : {height, capped: false};
}

const sleep = ms => new Promise(resolve => {
	setTimeout(resolve, ms);
});

// Resolve the max-image-height input (output pixels per image) to
// {value, warning?}.
function resolveMaxImageHeight(input) {
	const raw = String(input ?? '').trim();
	if (raw === '') {
		return {value: DEFAULT_MAX_IMAGE_HEIGHT};
	}

	const parsed = Number(raw);
	if (!Number.isSafeInteger(parsed) || parsed <= 0) {
		return {
			value: DEFAULT_MAX_IMAGE_HEIGHT,
			warning: `Invalid ${MAX_IMAGE_HEIGHT_INPUT} "${raw}", using ${DEFAULT_MAX_IMAGE_HEIGHT}.`,
		};
	}

	if (parsed > HARD_MAX_IMAGE_HEIGHT) {
		return {
			value: HARD_MAX_IMAGE_HEIGHT,
			warning: `${MAX_IMAGE_HEIGHT_INPUT} ${parsed} is above the ceiling of ${HARD_MAX_IMAGE_HEIGHT} output pixels, using ${HARD_MAX_IMAGE_HEIGHT}.`,
		};
	}

	if (parsed < MIN_MAX_IMAGE_HEIGHT) {
		return {
			value: MIN_MAX_IMAGE_HEIGHT,
			warning: `${MAX_IMAGE_HEIGHT_INPUT} ${parsed} is below the minimum of ${MIN_MAX_IMAGE_HEIGHT} output pixels, using ${MIN_MAX_IMAGE_HEIGHT}.`,
		};
	}

	return {value: parsed};
}

// The next scroll offset of a top to bottom pass, or null when the bottom has
// been reached. Steps are slightly smaller than the viewport so nothing is
// skipped by IntersectionObserver thresholds.
function nextScrollOffset(current, viewportHeight, documentHeight) {
	const lastOffset = Math.max(0, documentHeight - viewportHeight);
	if (current >= lastOffset) {
		return null;
	}

	const step = Math.max(1, Math.floor(viewportHeight * 0.9));
	return Math.min(current + step, lastOffset);
}

// Smallest whole number of CSS pixels that is a whole number of device pixels
// (2.75 -> 4, 1.5 -> 2, 3 -> 1). Slices that are multiples of it start on a
// whole device pixel, so consecutive slices neither overlap nor leave a gap.
function cssGranule(deviceScaleFactor) {
	for (let granule = 1; granule <= 100; granule++) {
		const device = granule * deviceScaleFactor;
		if (Math.abs(device - Math.round(device)) < 1e-9) {
			return granule;
		}
	}

	return 1;
}

// Split a document into consecutive slices whose output stays within
// maxImageHeight device pixels. A document that fits yields one slice. Returns
// {y, height}[] in CSS pixels, covering the whole document without gaps or
// overlap; only the last slice may be shorter.
function planSlices(documentHeight, deviceScaleFactor, requestedMaxHeight) {
	// A slice is at least one CSS pixel, that is ceil(dpr) output pixels.
	const maxImageHeight = Math.max(requestedMaxHeight, Math.ceil(deviceScaleFactor));
	if (Math.ceil(documentHeight * deviceScaleFactor) <= maxImageHeight) {
		return [{y: 0, height: documentHeight}];
	}

	const granule = cssGranule(deviceScaleFactor);
	let sliceHeight
		= Math.floor(maxImageHeight / deviceScaleFactor / granule) * granule;
	if (sliceHeight < 1) {
		sliceHeight = Math.max(1, Math.floor(maxImageHeight / deviceScaleFactor));
	}

	const slices = [];
	for (let y = 0; y < documentHeight; y += sliceHeight) {
		slices.push({y, height: Math.min(sliceHeight, documentHeight - y)});
	}

	return slices;
}

// "" for a single image, "-part2" for the second of several.
const partSuffix = (index, total) => (total > 1 ? `-part${index + 1}` : '');

// Capture a JPEG slice, stepping the quality down until it fits the size
// limit. capture(quality) must resolve to a Buffer; returns {buffer, quality}.
async function captureJpegWithinLimit(capture, maxBytes) {
	const limit = maxBytes || MAX_IMAGE_BYTES;
	let result;
	for (const quality of JPEG_QUALITY_STEPS) {
		// Sequential on purpose: only retry while the file is too large.
		// eslint-disable-next-line no-await-in-loop
		const buffer = await capture(quality);
		result = {buffer, quality};
		if (buffer.length <= limit) {
			break;
		}
	}

	return result;
}

const measureDocument = page =>
	page.evaluate(() => ({
		height: Math.max(
			document.documentElement.scrollHeight,
			document.body ? document.body.scrollHeight : 0,
		),
		width: Math.max(
			document.documentElement.scrollWidth,
			document.body ? document.body.scrollWidth : 0,
			document.documentElement.clientWidth,
		),
		viewportHeight: window.innerHeight,
		deviceScaleFactor: window.devicePixelRatio || 1,
	}));

// Scroll through the whole document so lazy / scroll-reveal content renders,
// go back to the top and wait until the layout stopped changing.
async function prepareFullPage(page, options) {
	const {
		waitUntil,
		maxMs = DEFAULT_MAX_SCROLL_MS,
		maxSteps = DEFAULT_MAX_SCROLL_STEPS,
		stepWaitMs = DEFAULT_STEP_WAIT_MS,
		log = () => {},
	} = options || {};
	const started = Date.now();
	let metrics = await measureDocument(page);
	let offset = 0;
	let steps = 0;
	/* eslint-disable no-await-in-loop -- scrolling is inherently sequential */
	while (offset !== null && steps < maxSteps && Date.now() - started < maxMs) {
		// Behavior 'instant' beats smooth-scroll CSS
		await page.evaluate(top => window.scrollTo({top, behavior: 'instant'}), offset);
		await sleep(stepWaitMs);
		steps++;
		// The document may grow while scrolling (infinite scroll): re-measure.
		metrics = await measureDocument(page);
		offset = nextScrollOffset(offset, metrics.viewportHeight, metrics.height);
	}

	if (offset !== null) {
		log(
			`Scrolling stopped after ${steps} steps (${
				Date.now() - started
			} ms): the page keeps growing or is very long.`,
		);
	}

	await page.evaluate(() => window.scrollTo({top: 0, behavior: 'instant'}));

	if (waitUntil === 'networkidle') {
		await page
			.waitForLoadState('networkidle', {timeout: NETWORK_IDLE_TIMEOUT_MS})
			.catch(() => {});
	}

	// Wait until the document height stopped changing (two equal readings).
	let previous = -1;
	const settleStart = Date.now();
	for (;;) {
		const {height} = await measureDocument(page);
		if (height === previous || Date.now() - settleStart > SETTLE_MAX_MS) {
			break;
		}

		previous = height;
		await sleep(SETTLE_POLL_MS);
	}

	/* eslint-enable no-await-in-loop */
	log(`Scrolled through the page in ${steps} step(s) before the capture.`);
}

/**
 Grow the viewport until it is as tall as the page: resize to the height of the
 document, wait, measure again, and repeat (at most `passes` times) until the
 height is stable, because a taller viewport can change the height itself
 (anything sized in vh, content an IntersectionObserver reveals once it is on
 screen). The width stays as it is. A page taller than `maxHeight` is not grown
 beyond it. Then waits, as far as it can, for the network to be idle and for
 media that only now started loading to arrive. The caller restores the
 viewport (the original size is in the result).
 @param {object} page A Playwright page.
 @param {{maxHeight?: number, passes?: number, passWaitMs?: number, idleTimeoutMs?: number, settleMs?: number, sleep?: (ms: number) => Promise<void>, log?: (message: string) => void}} [options] Limits and waits (tests shorten them).
 @returns {Promise<{original: {width: number, height: number} | null, width: number, height: number, capped: boolean, passes: number}>} The viewport before, and the size it was grown to.
 */
async function growViewport(page, options) {
	const {
		maxHeight = MAX_GROW_HEIGHT,
		passes = GROW_MAX_PASSES,
		passWaitMs = GROW_PASS_WAIT_MS,
		idleTimeoutMs = GROW_IDLE_TIMEOUT_MS,
		settleMs = GROW_SETTLE_MS,
		sleep: wait = sleep,
		log = () => {},
	} = options || {};
	const original = page.viewportSize();
	let metrics = await measureDocument(page);
	const width = original?.width ?? await page.evaluate(() => window.innerWidth);
	let {height, capped} = capGrowHeight(metrics.height, maxHeight);
	// The height of the viewport as it is, which is not the last measured one
	let applied = height;
	let used = 0;
	/* eslint-disable no-await-in-loop -- every pass depends on the one before */
	while (used < passes) {
		used++;
		await page.setViewportSize({width, height});
		applied = height;
		await wait(passWaitMs);
		metrics = await measureDocument(page);
		if (capped || metrics.height === height) {
			break;
		}

		({height, capped} = capGrowHeight(metrics.height, maxHeight));
	}

	/* eslint-enable no-await-in-loop */
	if (capped) {
		log(`The page is taller than ${maxHeight} CSS px: the viewport was not grown beyond that, the rest of the page is not captured.`);
	}

	await page.waitForLoadState('networkidle', {timeout: idleTimeoutMs}).catch(() => {});
	await wait(settleMs);
	log(`Grew the viewport to ${width} x ${applied} CSS px in ${used} pass${used === 1 ? '' : 'es'} before the capture.`);
	return {
		original, width, height: applied, capped, passes: used,
	};
}

// Capture one image with the size guards and write it to `file`. A JPEG above
// the 4.8 MB limit is captured again at a lower quality, a PNG above 5 MB only
// logs a warning. `capture(quality)` must resolve to a Buffer; `label` names the
// image in the log ("part 1", "the image"). Resolves to {buffer, quality}.
async function writeImage(capture, {file, type, label, log}) {
	let buffer;
	let quality;
	if (type === 'jpeg') {
		({buffer, quality} = await captureJpegWithinLimit(capture));
		if (buffer.length > MAX_IMAGE_BYTES) {
			log(`${label[0].toUpperCase()}${label.slice(1)} is still ${buffer.length} bytes at quality ${quality}.`);
		}
	} else {
		buffer = await capture(undefined);
		if (buffer.length > PNG_WARN_BYTES) {
			log(`Warning: ${label} is ${buffer.length} bytes, GitHub's image proxy refuses PNGs over 5 MB in comments.`);
		}
	}

	await fs.writeFile(file, buffer);
	return {buffer, quality};
}

// A capture that is one image: the viewport, a full page that fits, or the
// whole grown viewport (clip)
async function writeSingleImage(page, options, screenshot) {
	const {pathFor, type, log} = options;
	const file = pathFor('');
	const capture = quality => page.screenshot({type, quality, ...screenshot});
	await writeImage(capture, {
		file, type, label: 'the image', log,
	});
	return [file];
}

// The slices of a document that is too tall for one image, one image each.
// `screenshot(slice)` gives the options of page.screenshot besides type and
// quality.
async function writeSlices(page, options, {slices, screenshot}) {
	const files = [];
	/* eslint-disable no-await-in-loop -- slices are captured one after another */
	for (const [index, slice] of slices.entries()) {
		const file = options.pathFor(partSuffix(index, slices.length));
		const capture = quality =>
			page.screenshot({type: options.type, quality, ...screenshot(slice)});
		const {buffer, quality} = await writeImage(capture, {
			file, type: options.type, label: `part ${index + 1}`, log: options.log,
		});
		options.log(
			`Part ${index + 1} of ${slices.length}: ${file} (${buffer.length} bytes${
				quality ? `, quality ${quality}` : ''
			})`,
		);
		files.push(file);
	}

	/* eslint-enable no-await-in-loop */
	return files;
}

function logSlicePlan({height, dpr}, slices, {maxImageHeight, log}) {
	log(
		`Document is ${height} CSS px tall (${Math.ceil(
			height * dpr,
		)} px at ${dpr}x), above ${MAX_IMAGE_HEIGHT_INPUT} ${maxImageHeight}: capturing ${
			slices.length
		} consecutive parts.`,
	);
	if (slices.length > WARN_PART_COUNT) {
		log(
			`Warning: ${slices.length} parts will be written, consider a larger ${MAX_IMAGE_HEIGHT_INPUT}.`,
		);
	}
}

// The scroll strategy: Chromium's own full page capture, after scrolling
// through the page (see the header comment)
async function takeScrolledScreenshot(page, options) {
	const {scrollBeforeCapture, waitUntil, log, maxImageHeight} = options;
	if (scrollBeforeCapture) {
		await prepareFullPage(page, {waitUntil, log});
	}

	const metrics = await measureDocument(page);
	const dpr = metrics.deviceScaleFactor;
	const slices = planSlices(metrics.height, dpr, maxImageHeight);
	if (slices.length === 1) {
		return writeSingleImage(page, options, {fullPage: true});
	}

	logSlicePlan({height: metrics.height, dpr}, slices, options);
	return writeSlices(page, options, {
		slices,
		screenshot: slice => ({
			fullPage: true,
			clip: {
				x: 0, y: slice.y, width: metrics.width, height: slice.height,
			},
		}),
	});
}

// The grow-viewport strategy: the viewport is grown to the page, the
// slices are clips of the viewport (fullPage false, so nothing is painted
// beyond the screen), then the viewport is restored. The scrolling before the
// capture is not needed: everything is on screen.
async function takeGrownScreenshot(page, options) {
	const {log, maxImageHeight} = options;
	// Read before anything is changed: whatever happens, this is what is set back
	const original = page.viewportSize();
	if (!original) {
		// A page without a fixed viewport cannot be set back to "no viewport"
		log('full-page-strategy grow-viewport needs a page with a fixed viewport, which this one has not: using the scroll strategy.');
		return takeScrolledScreenshot(page, options);
	}

	try {
		const grown = await growViewport(page, {log, ...options.grow});
		const metrics = await measureDocument(page);
		const dpr = metrics.deviceScaleFactor;
		// What the viewport shows: a page taller than the cap is cut there
		const height = Math.min(metrics.height, grown.height);
		const clip = slice => ({
			x: 0, y: slice.y, width: grown.width, height: slice.height,
		});
		const slices = planSlices(height, dpr, maxImageHeight);
		if (slices.length === 1) {
			return await writeSingleImage(page, options, {fullPage: false, clip: clip(slices[0])});
		}

		logSlicePlan({height, dpr}, slices, options);
		return await writeSlices(page, options, {
			slices,
			screenshot: slice => ({fullPage: false, clip: clip(slice)}),
		});
	} finally {
		// Also when growing failed half way
		await page.setViewportSize(original).catch(() => {});
	}
}

/**
 Take a screenshot. A capture of the viewport and a full page that fits are one
 image (JPEGs step down in quality to stay below GitHub's limit); a taller full
 page is captured in slices, see the header comment.
 @param {object} page A Playwright page.
 @param {{pathFor: (partSuffix: string) => string, type: string, fullPage?: boolean, strategy?: string, scrollBeforeCapture?: boolean, waitUntil?: string, maxImageHeight?: number, log?: (message: string) => void, grow?: object}} options What to capture; pathFor returns the file path of an image (or of a part, given its suffix).
 @returns {Promise<string[]>} The files written.
 */
async function takeScreenshot(page, options) {
	const settings = {
		...options,
		log: options.log || (() => {}),
		maxImageHeight: options.maxImageHeight || DEFAULT_MAX_IMAGE_HEIGHT,
	};
	if (!options.fullPage) {
		return writeSingleImage(page, settings, {fullPage: false});
	}

	return options.strategy === 'grow-viewport'
		? takeGrownScreenshot(page, settings)
		: takeScrolledScreenshot(page, settings);
}

export {
	DEFAULT_FULL_PAGE_STRATEGY,
	DEFAULT_MAX_IMAGE_HEIGHT,
	FULL_PAGE_STRATEGIES,
	HARD_MAX_IMAGE_HEIGHT,
	MAX_GROW_HEIGHT,
	JPEG_QUALITY_STEPS,
	MAX_IMAGE_BYTES,
	MIN_MAX_IMAGE_HEIGHT,
	WARN_PART_COUNT,
	capGrowHeight,
	captureJpegWithinLimit,
	cssGranule,
	growViewport,
	isScrollEnabled,
	nextScrollOffset,
	partSuffix,
	planSlices,
	prepareFullPage,
	resolveFullPageStrategy,
	resolveMaxImageHeight,
	takeScreenshot,
};
