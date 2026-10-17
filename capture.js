/* global document, window -- used inside page.evaluate callbacks */
import {promises as fs} from 'node:fs';

// Full page capture helpers.
//
// - Scroll through the document first so lazily rendered / scroll-reveal
//   content is on screen (the action never scrolled before).
// - Chromium cannot capture more than 16384 device pixels in one screenshot;
//   beyond that a capture wraps and repeats the top of the page. Taller pages
//   are therefore captured as consecutive `clip` slices that each stay below
//   `maxImageHeight` and are written as separate files (-part1, -part2, ...).
// - JPEG slices are kept under the 5 MB limit of GitHub's image proxy by
//   stepping the quality down.
//
// Everything that does not need a browser is a pure function so it can be unit
// tested.

// Chromium's single capture limit is 16384 device px; stay below it.
const HARD_MAX_IMAGE_HEIGHT = 16_000;
const DEFAULT_MAX_IMAGE_HEIGHT = HARD_MAX_IMAGE_HEIGHT;
// GitHub's camo proxy refuses comment images over 5 MB.
const MAX_IMAGE_BYTES = 4.8 * 1024 * 1024;
const PNG_WARN_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY_STEPS = [80, 70, 60, 50, 40]; // Starts at Playwright's default

const DEFAULT_MAX_SCROLL_MS = 15_000;
const DEFAULT_MAX_SCROLL_STEPS = 150;
const DEFAULT_STEP_WAIT_MS = 150;
const SETTLE_POLL_MS = 100;
const SETTLE_MAX_MS = 2000;
const NETWORK_IDLE_TIMEOUT_MS = 5000;

// Name of the input as users write it, for messages.
const MAX_IMAGE_HEIGHT_INPUT = 'maxImageHeight';

const sleep = ms => new Promise(resolve => {
	setTimeout(resolve, ms);
});

// Resolve the maxImageHeight input (output pixels per image) to
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
			warning: `${MAX_IMAGE_HEIGHT_INPUT} ${parsed} is above Chromium's capture limit, using ${HARD_MAX_IMAGE_HEIGHT}.`,
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
function planSlices(documentHeight, deviceScaleFactor, maxImageHeight) {
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
		height: document.documentElement.scrollHeight,
		width: document.documentElement.scrollWidth,
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
		await page.evaluate(top => window.scrollTo(0, top), offset);
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

	await page.evaluate(() => window.scrollTo(0, 0));

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

// Take a screenshot. Fixed viewport captures and full page captures that fit
// keep the single page.screenshot call; a taller full page is captured in
// slices (see the header comment). options.pathFor(partSuffix) returns the file
// path of an image; resolves to the files written.
async function takeScreenshot(page, options) {
	const {pathFor, fullPage, type, scrollBeforeCapture, waitUntil} = options;

	if (!fullPage) {
		await page.screenshot({path: pathFor(''), fullPage, type});
		return [pathFor('')];
	}

	const log = options.log || (() => {});
	const maxImageHeight = options.maxImageHeight || DEFAULT_MAX_IMAGE_HEIGHT;

	if (scrollBeforeCapture) {
		await prepareFullPage(page, {waitUntil, log});
	}

	const metrics = await measureDocument(page);
	const dpr = metrics.deviceScaleFactor;
	const slices = planSlices(metrics.height, dpr, maxImageHeight);
	if (slices.length === 1) {
		await page.screenshot({path: pathFor(''), fullPage, type});
		return [pathFor('')];
	}

	log(
		`Document is ${metrics.height} CSS px tall (${Math.ceil(
			metrics.height * dpr,
		)} px at ${dpr}x), above ${MAX_IMAGE_HEIGHT_INPUT} ${maxImageHeight}: capturing ${
			slices.length
		} consecutive parts.`,
	);
	const files = [];
	/* eslint-disable no-await-in-loop -- slices are captured one after another */
	for (let index = 0; index < slices.length; index++) {
		const slice = slices[index];
		const file = pathFor(partSuffix(index, slices.length));
		const capture = quality =>
			page.screenshot({
				type,
				quality,
				fullPage: true,
				clip: {
					x: 0, y: slice.y, width: metrics.width, height: slice.height,
				},
			});
		let buffer;
		let quality;
		if (type === 'jpeg') {
			({buffer, quality} = await captureJpegWithinLimit(capture));
			if (buffer.length > MAX_IMAGE_BYTES) {
				log(
					`Part ${index + 1} is still ${
						buffer.length
					} bytes at quality ${quality}.`,
				);
			}
		} else {
			buffer = await capture(undefined);
			if (buffer.length > PNG_WARN_BYTES) {
				log(
					`Warning: part ${index + 1} is ${
						buffer.length
					} bytes, GitHub's image proxy refuses PNGs over 5 MB in comments.`,
				);
			}
		}

		await fs.writeFile(file, buffer);
		log(
			`Part ${index + 1} of ${slices.length}: ${file} (${buffer.length} bytes${
				quality ? `, quality ${quality}` : ''
			})`,
		);
		files.push(file);
	}

	/* eslint-enable no-await-in-loop */
	return files;
}

export {
	DEFAULT_MAX_IMAGE_HEIGHT,
	HARD_MAX_IMAGE_HEIGHT,
	JPEG_QUALITY_STEPS,
	MAX_IMAGE_BYTES,
	captureJpegWithinLimit,
	cssGranule,
	nextScrollOffset,
	partSuffix,
	planSlices,
	prepareFullPage,
	resolveMaxImageHeight,
	takeScreenshot,
};
