/* global document, window -- used inside page.evaluate callbacks */
// Full page capture helpers.
//
// - Scroll through the document first so lazily rendered / scroll-reveal
//   content is on screen (the action never scrolled before).
// - Taller pages are captured as consecutive `clip` slices that each stay
//   below `maxImageHeight` output pixels and are written as separate files
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
// Everything that does not need a browser is a pure function so it can be unit
// tested.

// Chromium's texture limit is 16384 device px; stay below it. This is also the
// ceiling for maxImageHeight and its default.
const HARD_MAX_IMAGE_HEIGHT = 16000;
const DEFAULT_MAX_IMAGE_HEIGHT = HARD_MAX_IMAGE_HEIGHT;
// Smaller values would only produce hundreds of files.
const MIN_MAX_IMAGE_HEIGHT = 100;
const WARN_PART_COUNT = 200;
// GitHub's camo proxy refuses comment images over 5 MB.
const MAX_IMAGE_BYTES = 4.8 * 1024 * 1024;
const PNG_WARN_BYTES = 5 * 1024 * 1024;
const JPEG_QUALITY_STEPS = [80, 70, 60, 50, 40]; // starts at Playwright's default

const DEFAULT_MAX_SCROLL_MS = 15000;
const DEFAULT_MAX_SCROLL_STEPS = 150;
const DEFAULT_STEP_WAIT_MS = 150;
const SETTLE_POLL_MS = 100;
const SETTLE_MAX_MS = 2000;
const NETWORK_IDLE_TIMEOUT_MS = 5000;

// Name of the input as users write it, for messages.
const MAX_IMAGE_HEIGHT_INPUT = 'maxImageHeight';

const FALSE_VALUES = ['false', '0', 'no', 'off'];

// scrollBeforeCapture is on by default: only these values switch it off.
function isScrollEnabled(input) {
  return !FALSE_VALUES.includes(
    `${input === undefined || input === null ? '' : input}`.trim().toLowerCase()
  );
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Resolve the `maxImageHeight` input (output pixels per image).
 * @returns {{ value: number, warning?: string }}
 */
function resolveMaxImageHeight(input) {
  const raw = `${input === undefined || input === null ? '' : input}`.trim();
  if (raw === '') {
    return { value: DEFAULT_MAX_IMAGE_HEIGHT };
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
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
  return { value: parsed };
}

/**
 * The next scroll offset of a top to bottom pass, or null when the bottom has
 * been reached. Steps are slightly smaller than the viewport so nothing is
 * skipped by IntersectionObserver thresholds.
 */
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

/**
 * Split a document into consecutive slices whose output stays within
 * `maxImageHeight` device pixels. A document that fits yields one slice.
 * @returns {{ y: number, height: number }[]} CSS pixels, covering the whole
 *   document without gaps or overlap; only the last slice may be shorter
 */
function planSlices(documentHeight, deviceScaleFactor, requestedMaxHeight) {
  // A slice is at least one CSS pixel, that is ceil(dpr) output pixels.
  const maxImageHeight = Math.max(
    requestedMaxHeight,
    Math.ceil(deviceScaleFactor)
  );
  if (Math.ceil(documentHeight * deviceScaleFactor) <= maxImageHeight) {
    return [{ y: 0, height: documentHeight }];
  }
  const granule = cssGranule(deviceScaleFactor);
  let sliceHeight =
    Math.floor(maxImageHeight / deviceScaleFactor / granule) * granule;
  if (sliceHeight < 1) {
    sliceHeight = Math.max(1, Math.floor(maxImageHeight / deviceScaleFactor));
  }
  const slices = [];
  for (let y = 0; y < documentHeight; y += sliceHeight) {
    slices.push({ y, height: Math.min(sliceHeight, documentHeight - y) });
  }
  return slices;
}

/** "" for a single image, "-part2" for the second of several. */
const partSuffix = (index, total) => (total > 1 ? `-part${index + 1}` : '');

/**
 * Capture a JPEG slice, stepping the quality down until it fits the size
 * limit. `capture(quality)` must resolve to a Buffer.
 * @returns {Promise<{ buffer: Buffer, quality: number }>}
 */
async function captureJpegWithinLimit(capture, maxBytes) {
  const limit = maxBytes || MAX_IMAGE_BYTES;
  let result;
  for (const quality of JPEG_QUALITY_STEPS) {
    // Sequential on purpose: only retry while the file is too large.
    // eslint-disable-next-line no-await-in-loop
    const buffer = await capture(quality);
    result = { buffer, quality };
    if (buffer.length <= limit) {
      break;
    }
  }
  return result;
}

const measureDocument = (page) =>
  page.evaluate(() => ({
    height: Math.max(
      document.documentElement.scrollHeight,
      document.body ? document.body.scrollHeight : 0
    ),
    width: Math.max(
      document.documentElement.scrollWidth,
      document.body ? document.body.scrollWidth : 0,
      document.documentElement.clientWidth
    ),
    viewportHeight: window.innerHeight,
    deviceScaleFactor: window.devicePixelRatio || 1,
  }));

/**
 * Scroll through the whole document so lazy / scroll-reveal content renders,
 * go back to the top and wait until the layout stopped changing.
 */
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
    // behavior 'instant' beats smooth-scroll CSS
    await page.evaluate(
      (top) => window.scrollTo({ top, behavior: 'instant' }),
      offset
    );
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
      } ms): the page keeps growing or is very long.`
    );
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));

  if (waitUntil === 'networkidle') {
    await page
      .waitForLoadState('networkidle', { timeout: NETWORK_IDLE_TIMEOUT_MS })
      .catch(() => {});
  }

  // Wait until the document height stopped changing (two equal readings).
  let previous = -1;
  const settleStart = Date.now();
  for (;;) {
    const { height } = await measureDocument(page);
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
 * Take a screenshot. Fixed viewport captures and full page captures that fit
 * keep the single `page.screenshot` call; a taller full page is captured in
 * slices (see the header comment).
 * @param {{ path?: string, pathFor: (suffix: string) => string }} options
 *   `pathFor(partSuffix)` returns the file path for an image.
 * @returns {Promise<string[]>} the files written
 */
async function takeScreenshot(page, options) {
  const { pathFor, fullPage, type, scrollBeforeCapture, waitUntil } = options;
  const fs = require('fs').promises;
  const log = options.log || (() => {});
  const maxImageHeight = options.maxImageHeight || DEFAULT_MAX_IMAGE_HEIGHT;

  if (!fullPage) {
    await page.screenshot({ path: pathFor(''), fullPage, type });
    return [pathFor('')];
  }
  if (scrollBeforeCapture) {
    await prepareFullPage(page, { waitUntil, log });
  }
  const metrics = await measureDocument(page);
  const dpr = metrics.deviceScaleFactor;
  const slices = planSlices(metrics.height, dpr, maxImageHeight);
  if (slices.length === 1) {
    await page.screenshot({ path: pathFor(''), fullPage, type });
    return [pathFor('')];
  }

  log(
    `Document is ${metrics.height} CSS px tall (${Math.ceil(
      metrics.height * dpr
    )} px at ${dpr}x), above ${MAX_IMAGE_HEIGHT_INPUT} ${maxImageHeight}: capturing ${
      slices.length
    } consecutive parts.`
  );
  if (slices.length > WARN_PART_COUNT) {
    log(
      `Warning: ${slices.length} parts will be written, consider a larger ${MAX_IMAGE_HEIGHT_INPUT}.`
    );
  }
  const files = [];
  /* eslint-disable no-await-in-loop -- slices are captured one after another */
  for (let index = 0; index < slices.length; index++) {
    const slice = slices[index];
    const file = pathFor(partSuffix(index, slices.length));
    const capture = (quality) =>
      page.screenshot({
        type,
        quality,
        fullPage: true,
        clip: { x: 0, y: slice.y, width: metrics.width, height: slice.height },
      });
    let buffer;
    let quality;
    if (type === 'jpeg') {
      ({ buffer, quality } = await captureJpegWithinLimit(capture));
      if (buffer.length > MAX_IMAGE_BYTES) {
        log(
          `Part ${index + 1} is still ${
            buffer.length
          } bytes at quality ${quality}.`
        );
      }
    } else {
      buffer = await capture(undefined);
      if (buffer.length > PNG_WARN_BYTES) {
        log(
          `Warning: part ${index + 1} is ${
            buffer.length
          } bytes, GitHub's image proxy refuses PNGs over 5 MB in comments.`
        );
      }
    }
    await fs.writeFile(file, buffer);
    log(
      `Part ${index + 1} of ${slices.length}: ${file} (${buffer.length} bytes${
        quality ? `, quality ${quality}` : ''
      })`
    );
    files.push(file);
  }
  /* eslint-enable no-await-in-loop */
  return files;
}

module.exports = {
  DEFAULT_MAX_IMAGE_HEIGHT,
  HARD_MAX_IMAGE_HEIGHT,
  MIN_MAX_IMAGE_HEIGHT,
  WARN_PART_COUNT,
  JPEG_QUALITY_STEPS,
  MAX_IMAGE_BYTES,
  captureJpegWithinLimit,
  cssGranule,
  isScrollEnabled,
  nextScrollOffset,
  partSuffix,
  planSlices,
  prepareFullPage,
  resolveMaxImageHeight,
  takeScreenshot,
};
