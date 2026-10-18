import {Buffer} from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import {
	DEFAULT_FULL_PAGE_STRATEGY,
	FULL_PAGE_STRATEGIES,
	MAX_GROW_HEIGHT,
	capGrowHeight,
	captureJpegWithinLimit,
	cssGranule,
	growViewport,
	isScrollEnabled,
	nextScrollOffset,
	partSuffix,
	planSlices,
	resolveFullPageStrategy,
	resolveMaxImageHeight,
	takeScreenshot,
} from './capture.js';

describe('resolveMaxImageHeight', () => {
	it('defaults silently when empty', () => {
		expect(resolveMaxImageHeight('')).toEqual({value: 16_000});
		expect(resolveMaxImageHeight(undefined)).toEqual({value: 16_000});
	});

	it('accepts values up to the hard maximum', () => {
		expect(resolveMaxImageHeight('4000')).toEqual({value: 4000});
		expect(resolveMaxImageHeight(' 16000 ')).toEqual({value: 16_000});
	});

	it('falls back to the default with a warning for invalid values', () => {
		for (const input of ['abc', '0', '-5', '1.5', '4e3x']) {
			const result = resolveMaxImageHeight(input);
			expect(result.value).toBe(16_000);
			expect(result.warning).toContain(`Invalid max-image-height "${input}"`);
		}
	});

	it('clamps values above the ceiling with a warning', () => {
		const result = resolveMaxImageHeight('99999');
		expect(result.value).toBe(16_000);
		expect(result.warning).toContain('max-image-height 99999 is above');
	});

	it('clamps values below the minimum of 100 up with a warning', () => {
		for (const input of ['1', '99']) {
			const result = resolveMaxImageHeight(input);
			expect(result.value).toBe(100);
			expect(result.warning).toContain(`max-image-height ${input} is below`);
		}

		expect(resolveMaxImageHeight('100')).toEqual({value: 100});
	});
});

describe('isScrollEnabled', () => {
	it('is on by default and for anything but the off values', () => {
		for (const input of [
			undefined,
			null,
			'',
			'true',
			'TRUE',
			'yes',
			'1',
			'x',
		]) {
			expect(isScrollEnabled(input)).toBe(true);
		}
	});

	it('is switched off by false, 0, no and off in any case', () => {
		for (const input of ['false', 'False', ' 0 ', 'no', 'NO', 'off', false]) {
			expect(isScrollEnabled(input)).toBe(false);
		}
	});
});

describe('nextScrollOffset', () => {
	it('walks down in steps slightly smaller than the viewport', () => {
		const offsets = [0];
		for (
			let next = nextScrollOffset(0, 700, 2000);
			next !== null;
			next = nextScrollOffset(offsets.at(-1), 700, 2000)
		) {
			offsets.push(next);
		}

		expect(offsets).toEqual([0, 630, 1260, 1300]);
	});

	it('needs no scrolling when the page fits the viewport', () => {
		expect(nextScrollOffset(0, 700, 700)).toBeNull();
		expect(nextScrollOffset(0, 700, 300)).toBeNull();
	});

	it('keeps stepping at least one pixel for tiny viewports', () => {
		expect(nextScrollOffset(0, 1, 10)).toBe(1);
	});
});

describe('cssGranule', () => {
	it('is the smallest CSS size that is a whole number of device pixels', () => {
		expect(cssGranule(1)).toBe(1);
		expect(cssGranule(2)).toBe(1);
		expect(cssGranule(3)).toBe(1);
		expect(cssGranule(1.5)).toBe(2);
		expect(cssGranule(2.75)).toBe(4);
		expect(cssGranule(2.625)).toBe(8);
	});

	it('falls back to 1 when no small size exists', () => {
		expect(cssGranule(1.3333333)).toBe(1);
	});
});

describe('planSlices', () => {
	it('returns one slice when the page fits, also exactly at the limit', () => {
		expect(planSlices(1000, 1, 16_000)).toEqual([{y: 0, height: 1000}]);
		expect(planSlices(16_000, 1, 16_000)).toEqual([{y: 0, height: 16_000}]);
		expect(planSlices(8000, 2, 16_000)).toEqual([{y: 0, height: 8000}]);
	});

	it('splits one pixel above the limit', () => {
		expect(planSlices(16_001, 1, 16_000)).toEqual([
			{y: 0, height: 16_000},
			{y: 16_000, height: 1},
		]);
		expect(planSlices(8001, 2, 16_000)).toEqual([
			{y: 0, height: 8000},
			{y: 8000, height: 1},
		]);
	});

	it('uses whole CSS pixels for a device scale factor of 3', () => {
		expect(planSlices(5334, 3, 16_000)).toEqual([
			{y: 0, height: 5333},
			{y: 5333, height: 1},
		]);
	});

	it('covers the document without gaps or overlap and stays within the limit', () => {
		for (const dpr of [1, 1.5, 2, 2.625, 2.75, 3]) {
			for (const max of [16_000, 4000, 1234]) {
				for (const height of [1, 999, 4000, 16_001, 20_276, 60_000]) {
					const slices = planSlices(height, dpr, max);
					let expectedY = 0;
					for (const slice of slices) {
						expect(slice.y).toBe(expectedY);
						expect(slice.height).toBeGreaterThan(0);
						expect(slice.height * dpr).toBeLessThanOrEqual(max + 1e-9);
						expectedY += slice.height;
					}

					expect(expectedY).toBe(height);
					// Only the last slice may be shorter
					const first = slices[0].height;
					for (const slice of slices.slice(0, -1)) {
						expect(slice.height).toBe(first);
					}
				}
			}
		}
	});

	it('raises a maximum below the device scale factor to one CSS pixel', () => {
		// 1 CSS px is 3 output px at 3x, so a maximum of 1 or 2 cannot be honoured
		for (const max of [1, 2]) {
			const slices = planSlices(4, 3, max);
			expect(slices).toEqual([
				{y: 0, height: 1},
				{y: 1, height: 1},
				{y: 2, height: 1},
				{y: 3, height: 1},
			]);
		}
	});

	it('never produces slices shorter than one CSS pixel for a tiny maximum', () => {
		expect(planSlices(3, 3, 1)).toEqual([
			{y: 0, height: 1},
			{y: 1, height: 1},
			{y: 2, height: 1},
		]);
	});
});

describe('partSuffix', () => {
	it('is empty for a single image and numbered otherwise', () => {
		expect(partSuffix(0, 1)).toBe('');
		expect(partSuffix(0, 3)).toBe('-part1');
		expect(partSuffix(2, 3)).toBe('-part3');
	});
});

describe('captureJpegWithinLimit', () => {
	const sized = bytesByQuality => {
		const calls = [];
		const capture = async quality => {
			calls.push(quality);
			return Buffer.alloc(bytesByQuality[quality]);
		};

		return {calls, capture};
	};

	it('keeps the first quality when the image fits', async () => {
		const {calls, capture} = sized({80: 100});
		const result = await captureJpegWithinLimit(capture, 1000);
		expect(calls).toEqual([80]);
		expect(result.quality).toBe(80);
	});

	it('steps the quality down until the image fits', async () => {
		const {calls, capture} = sized({
			80: 5000, 70: 3000, 60: 900, 50: 10,
		});
		const result = await captureJpegWithinLimit(capture, 1000);
		expect(calls).toEqual([80, 70, 60]);
		expect(result.quality).toBe(60);
		expect(result.buffer.length).toBe(900);
	});

	it('returns the lowest quality when nothing fits', async () => {
		const {calls, capture} = sized({
			80: 9, 70: 9, 60: 9, 50: 9, 40: 9,
		});
		const result = await captureJpegWithinLimit(capture, 1);
		expect(calls).toEqual([80, 70, 60, 50, 40]);
		expect(result.quality).toBe(40);
	});
});

describe('takeScreenshot', () => {
	let directory;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-'));
	});

	afterEach(() => {
		fs.rmSync(directory, {recursive: true, force: true});
	});

	// A page double: evaluate() answers measurements and records scrolls.
	const fakePage = ({height, dpr = 1, viewportHeight = 700, bytes}) => {
		const shots = [];
		const scrolls = [];
		return {
			shots,
			scrolls,
			async evaluate(fn, argument) {
				if (String(fn).includes('scrollTo')) {
					scrolls.push(argument === undefined ? 0 : argument);
					return undefined;
				}

				return {
					height,
					width: 1000,
					viewportHeight,
					deviceScaleFactor: dpr,
				};
			},
			async screenshot(options) {
				shots.push(options);
				const size = typeof bytes === 'function' ? bytes(options) : 10;
				return Buffer.alloc(size);
			},
			waitForLoadState: async () => undefined,
		};
	};

	const pathFor = part => path.join(directory, `shot${part}-abc1234.jpeg`);
	const base = {
		pathFor,
		type: 'jpeg',
		scrollBeforeCapture: false,
		maxImageHeight: 16_000,
	};

	it('writes one image for a fixed viewport', async () => {
		const page = fakePage({height: 99_999});
		const files = await takeScreenshot(page, {...base, fullPage: false});
		expect(files).toEqual([pathFor('')]);
		expect(page.shots).toEqual([{type: 'jpeg', quality: 80, fullPage: false}]);
		expect(fs.readFileSync(pathFor('')).length).toBe(10);
	});

	it('writes one image for a full page that fits the limit', async () => {
		const page = fakePage({height: 16_000});
		const files = await takeScreenshot(page, {...base, fullPage: true});
		expect(files).toEqual([pathFor('')]);
		expect(page.shots).toEqual([{type: 'jpeg', quality: 80, fullPage: true}]);
		expect(fs.existsSync(pathFor(''))).toBe(true);
	});

	it('steps the JPEG quality down for a viewport capture that is too large', async () => {
		const page = fakePage({
			height: 700,
			bytes: options => (options.quality > 60 ? 5 * 1024 * 1024 : 1234),
		});
		const files = await takeScreenshot(page, {...base, fullPage: false});
		expect(page.shots.map(shot => shot.quality)).toEqual([80, 70, 60]);
		expect(fs.readFileSync(files[0]).length).toBe(1234);
	});

	it('steps the JPEG quality down for a full page that fits one image (the gap the single capture had)', async () => {
		const page = fakePage({
			height: 3000,
			bytes: options => (options.quality > 50 ? 6 * 1024 * 1024 : 4321),
		});
		const files = await takeScreenshot(page, {...base, fullPage: true});
		expect(files).toEqual([pathFor('')]);
		expect(page.shots.map(shot => shot.quality)).toEqual([80, 70, 60, 50]);
		expect(page.shots.every(shot => shot.fullPage === true && shot.clip === undefined)).toBe(true);
		expect(fs.readFileSync(files[0]).length).toBe(4321);
	});

	it('logs when a single JPEG is still too large at the lowest quality', async () => {
		const page = fakePage({height: 700, bytes: () => 6 * 1024 * 1024});
		const logs = [];
		await takeScreenshot(page, {
			...base,
			fullPage: true,
			log(message) {
				logs.push(message);
			},
		});
		expect(page.shots.map(shot => shot.quality)).toEqual([80, 70, 60, 50, 40]);
		expect(logs).toEqual([`The image is still ${6 * 1024 * 1024} bytes at quality 40.`]);
	});

	it('does not step a PNG down but warns about a huge single image', async () => {
		const page = fakePage({height: 700, bytes: () => (5 * 1024 * 1024) + 1});
		const logs = [];
		const files = await takeScreenshot(page, {
			...base,
			pathFor: part => path.join(directory, `shot${part}.png`),
			type: 'png',
			fullPage: false,
			log(message) {
				logs.push(message);
			},
		});
		expect(page.shots).toEqual([{type: 'png', quality: undefined, fullPage: false}]);
		expect(files).toHaveLength(1);
		expect(logs).toHaveLength(1);
		expect(logs[0]).toContain('Warning: the image is');
	});

	it('scrolls through the page before a full page capture', async () => {
		const page = fakePage({height: 1500, viewportHeight: 700});
		await takeScreenshot(page, {
			...base,
			fullPage: true,
			scrollBeforeCapture: true,
			waitUntil: 'networkidle',
		});
		// 0 -> 630 -> 800 (last offset), then back to the top
		expect(page.scrolls).toEqual([0, 630, 800, 0]);
	});

	it('captures consecutive clip slices above the limit', async () => {
		const page = fakePage({height: 20_276, dpr: 1, bytes: () => 100});
		const logs = [];
		const files = await takeScreenshot(page, {
			...base,
			fullPage: true,
			log(message) {
				logs.push(message);
			},
		});
		expect(files).toEqual([pathFor('-part1'), pathFor('-part2')]);
		expect(page.shots.map(shot => shot.clip)).toEqual([
			{
				x: 0, y: 0, width: 1000, height: 16_000,
			},
			{
				x: 0, y: 16_000, width: 1000, height: 4276,
			},
		]);
		expect(page.shots.every(shot => shot.fullPage === true)).toBe(true);
		expect(page.shots[0]).toMatchObject({type: 'jpeg', quality: 80});
		expect(files.every(file => fs.existsSync(file))).toBe(true);
		expect(logs.join('\n')).toContain('capturing 2 consecutive parts');
	});

	it('warns when a very small maxImageHeight produces many parts', async () => {
		const page = fakePage({height: 20_276});
		const logs = [];
		const files = await takeScreenshot(page, {
			...base,
			fullPage: true,
			maxImageHeight: 100,
			log(message) {
				logs.push(message);
			},
		});
		expect(files).toHaveLength(203);
		expect(
			logs.some(message => message.startsWith('Warning: 203 parts')),
		).toBe(true);
	});

	it('honours a smaller maxImageHeight and the device scale factor', async () => {
		const page = fakePage({height: 5000, dpr: 3});
		const files = await takeScreenshot(page, {
			...base,
			fullPage: true,
			maxImageHeight: 4000,
		});
		// 4000 / 3 = 1333 CSS px per slice
		expect(files).toHaveLength(4);
		expect(page.shots.map(shot => shot.clip.height)).toEqual([
			1333, 1333, 1333, 1001,
		]);
	});

	it('steps the JPEG quality down per slice until it fits', async () => {
		const page = fakePage({
			height: 20_000,
			bytes: options => (options.quality > 60 ? 5 * 1024 * 1024 : 1000),
		});
		await takeScreenshot(page, {...base, fullPage: true});
		expect(page.shots.map(shot => shot.quality)).toEqual([
			80, 70, 60, 80, 70, 60,
		]);
	});

	it('captures PNG slices without a quality and warns about huge files', async () => {
		const page = fakePage({
			height: 20_000,
			bytes: () => (5 * 1024 * 1024) + 1,
		});
		const logs = [];
		await takeScreenshot(page, {
			...base,
			pathFor: part => path.join(directory, `shot${part}.png`),
			type: 'png',
			fullPage: true,
			log(message) {
				logs.push(message);
			},
		});
		expect(page.shots).toHaveLength(2);
		expect(page.shots.every(shot => shot.quality === undefined)).toBe(true);
		expect(
			logs.filter(message => message.startsWith('Warning')),
		).toHaveLength(2);
	});
});

describe('resolveFullPageStrategy', () => {
	it('is scroll by default', () => {
		expect(DEFAULT_FULL_PAGE_STRATEGY).toBe('scroll');
		for (const input of ['', '  ', undefined, null]) {
			expect(resolveFullPageStrategy(input)).toBe('scroll');
		}
	});

	it('accepts both strategies, in any case and with whitespace', () => {
		expect(FULL_PAGE_STRATEGIES).toEqual(['scroll', 'grow-viewport']);
		expect(resolveFullPageStrategy('scroll')).toBe('scroll');
		expect(resolveFullPageStrategy(' Grow-Viewport ')).toBe('grow-viewport');
	});

	it('fails for anything else, naming the value and the choices', () => {
		for (const input of ['grow', 'viewport', 'grow_viewport', 'true', 'scrol']) {
			expect(() => resolveFullPageStrategy(input), input).toThrow(`Unknown full-page-strategy "${input}"; use scroll or grow-viewport.`);
		}
	});
});

describe('capGrowHeight', () => {
	it('keeps a height up to the cap, also exactly at it', () => {
		expect(capGrowHeight(1)).toEqual({height: 1, capped: false});
		expect(capGrowHeight(MAX_GROW_HEIGHT)).toEqual({height: MAX_GROW_HEIGHT, capped: false});
		expect(MAX_GROW_HEIGHT).toBe(100_000);
	});

	it('cuts a taller page at the cap', () => {
		expect(capGrowHeight(100_001)).toEqual({height: 100_000, capped: true});
		expect(capGrowHeight(5000, 4000)).toEqual({height: 4000, capped: true});
		expect(capGrowHeight(4000, 4000)).toEqual({height: 4000, capped: false});
	});
});

// A page double whose document is `content(viewport)` CSS px tall, at least as tall as the viewport
// (like scrollHeight); setViewportSize resizes it.
function growablePage({
	content, width = 1000, height = 700, dpr = 1, bytes = () => 10, failScreenshot = false, rejectIdle = false, failMeasureAfterResize = false, noViewport = false,
}) {
	const state = {
		viewport: {width, height},
		resizes: [],
		scrolls: [],
		shots: [],
		idle: [],
	};
	return {
		state,
		viewportSize: () => (noViewport ? null : {...state.viewport}),
		async setViewportSize(size) {
			state.viewport = {...size};
			state.resizes.push({...size});
		},
		async evaluate(fn, argument) {
			if (String(fn).includes('scrollTo')) {
				state.scrolls.push(argument);
				return undefined;
			}

			if (failMeasureAfterResize && state.resizes.length > 0) {
				throw new Error('the page crashed');
			}

			return {
				height: Math.max(content(state.viewport), state.viewport.height),
				width: state.viewport.width,
				viewportHeight: state.viewport.height,
				deviceScaleFactor: dpr,
			};
		},
		async screenshot(options) {
			if (failScreenshot) {
				throw new Error('screenshot failed');
			}

			state.shots.push({...options, viewport: {...state.viewport}});
			return Buffer.alloc(bytes(options));
		},
		async waitForLoadState(name, options) {
			state.idle.push([name, options]);
			if (rejectIdle) {
				throw new Error('Timeout');
			}
		},
	};
}

const noWait = {sleep: async () => undefined};

describe('growViewport', () => {
	it('grows the viewport to the height of the page and keeps the width', async () => {
		const page = growablePage({content: () => 5000});
		const result = await growViewport(page, noWait);
		expect(page.state.resizes).toEqual([{width: 1000, height: 5000}]);
		expect(result).toEqual({
			original: {width: 1000, height: 700}, width: 1000, height: 5000, capped: false, passes: 1,
		});
	});

	it('waits after the resize, then for the network and a last settle time', async () => {
		const waits = [];
		const page = growablePage({content: () => 3000});
		await growViewport(page, {
			passWaitMs: 11,
			settleMs: 22,
			idleTimeoutMs: 33,
			async sleep(ms) {
				waits.push(ms);
			},
		});
		expect(waits).toEqual([11, 22]);
		expect(page.state.idle).toEqual([['networkidle', {timeout: 33}]]);
	});

	it('uses the documented waits by default', async () => {
		const waits = [];
		const page = growablePage({content: () => 3000});
		await growViewport(page, {
			async sleep(ms) {
				waits.push(ms);
			},
		});
		expect(waits).toEqual([500, 1000]);
		expect(page.state.idle).toEqual([['networkidle', {timeout: 5000}]]);
	});

	it('repeats until the height is stable, because a taller viewport can change the page', async () => {
		// Anything sized in vh: the page is half a viewport taller than the viewport, up to 4000
		const page = growablePage({content: viewport => Math.min(4000, viewport.height + 500)});
		const result = await growViewport(page, noWait);
		expect(page.state.resizes.map(size => size.height)).toEqual([1200, 1700, 2200, 2700, 3200]);
		expect(result.passes).toBe(5);
		expect(result.height).toBe(3200);
	});

	it('stops after five passes however much the page keeps growing', async () => {
		const page = growablePage({content: viewport => viewport.height + 1000});
		const result = await growViewport(page, noWait);
		expect(page.state.resizes).toHaveLength(5);
		expect(result.passes).toBe(5);
	});

	it('stops growing beyond the cap, logs it and does not repeat', async () => {
		const logs = [];
		const page = growablePage({content: () => 250_000});
		const result = await growViewport(page, {
			...noWait,
			maxHeight: 10_000,
			log(message) {
				logs.push(message);
			},
		});
		expect(page.state.resizes).toEqual([{width: 1000, height: 10_000}]);
		expect(result).toMatchObject({height: 10_000, capped: true, passes: 1});
		expect(logs[0]).toBe('The page is taller than 10000 CSS px: the viewport was not grown beyond that, the rest of the page is not captured.');
		expect(logs[1]).toContain('Grew the viewport to 1000 x 10000 CSS px in 1 pass');
	});

	it('caps at 100000 CSS px by default', async () => {
		const page = growablePage({content: () => 500_000});
		await growViewport(page, noWait);
		expect(page.state.resizes).toEqual([{width: 1000, height: 100_000}]);
	});

	it('still works when the page is already as tall as the viewport', async () => {
		const page = growablePage({content: () => 100, height: 700});
		const result = await growViewport(page, noWait);
		expect(result).toMatchObject({height: 700, capped: false, passes: 1});
	});

	it('ignores a network that never gets idle', async () => {
		const page = growablePage({content: () => 3000, rejectIdle: true});
		await expect(growViewport(page, noWait)).resolves.toMatchObject({height: 3000});
	});

	it('logs what it did', async () => {
		const logs = [];
		const page = growablePage({content: () => 3000});
		await growViewport(page, {
			...noWait,
			log(message) {
				logs.push(message);
			},
		});
		expect(logs).toEqual(['Grew the viewport to 1000 x 3000 CSS px in 1 pass before the capture.']);
	});
});

describe('takeScreenshot with the grow-viewport strategy', () => {
	let directory;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-grow-'));
	});

	afterEach(() => {
		fs.rmSync(directory, {recursive: true, force: true});
	});

	const pathFor = part => path.join(directory, `shot${part}-abc1234.jpeg`);
	const base = {
		pathFor,
		type: 'jpeg',
		fullPage: true,
		strategy: 'grow-viewport',
		scrollBeforeCapture: true,
		waitUntil: 'networkidle',
		maxImageHeight: 16_000,
		grow: noWait,
	};

	it('captures one clip of the grown viewport, with fullPage false, and restores the viewport', async () => {
		const page = growablePage({content: () => 5000});
		const files = await takeScreenshot(page, base);
		expect(files).toEqual([pathFor('')]);
		expect(page.state.shots).toEqual([{
			type: 'jpeg',
			quality: 80,
			fullPage: false,
			clip: {
				x: 0, y: 0, width: 1000, height: 5000,
			},
			viewport: {width: 1000, height: 5000},
		}]);
		expect(page.state.viewport).toEqual({width: 1000, height: 700});
		expect(fs.existsSync(pathFor(''))).toBe(true);
	});

	it('does not scroll, scroll-before-capture is ignored', async () => {
		const page = growablePage({content: () => 5000});
		await takeScreenshot(page, {...base, scrollBeforeCapture: true});
		expect(page.state.scrolls).toEqual([]);
	});

	it('slices a page taller than max-image-height into clips of the grown viewport', async () => {
		const page = growablePage({content: () => 20_276});
		const logs = [];
		const files = await takeScreenshot(page, {
			...base,
			log(message) {
				logs.push(message);
			},
		});
		expect(files).toEqual([pathFor('-part1'), pathFor('-part2')]);
		expect(page.state.shots.map(shot => shot.clip)).toEqual([
			{
				x: 0, y: 0, width: 1000, height: 16_000,
			},
			{
				x: 0, y: 16_000, width: 1000, height: 4276,
			},
		]);
		expect(page.state.shots.every(shot => shot.fullPage === false)).toBe(true);
		// Both slices were taken while the viewport was grown
		expect(page.state.shots.every(shot => shot.viewport.height === 20_276)).toBe(true);
		expect(page.state.viewport).toEqual({width: 1000, height: 700});
		expect(logs.some(message => message.includes('capturing 2 consecutive parts'))).toBe(true);
	});

	it('honours the device scale factor in the slices', async () => {
		const page = growablePage({content: () => 5000, dpr: 3});
		await takeScreenshot(page, {...base, maxImageHeight: 4000});
		// 4000 / 3 = 1333 CSS px per slice
		expect(page.state.shots.map(shot => shot.clip.height)).toEqual([1333, 1333, 1333, 1001]);
	});

	it('captures only what the capped viewport shows, and says so', async () => {
		const page = growablePage({content: () => 40_000});
		const logs = [];
		const files = await takeScreenshot(page, {
			...base,
			grow: {...noWait, maxHeight: 20_000},
			log(message) {
				logs.push(message);
			},
		});
		expect(files).toHaveLength(2);
		const heights = page.state.shots.map(shot => shot.clip.height);
		expect(heights.reduce((sum, height) => sum + height, 0)).toBe(20_000);
		expect(logs.some(message => message.includes('taller than 20000 CSS px'))).toBe(true);
	});

	it('steps the JPEG quality down per slice', async () => {
		const page = growablePage({
			content: () => 20_000,
			bytes: options => (options.quality > 60 ? 5 * 1024 * 1024 : 1000),
		});
		await takeScreenshot(page, base);
		expect(page.state.shots.map(shot => shot.quality)).toEqual([80, 70, 60, 80, 70, 60]);
	});

	it('captures PNG without a quality', async () => {
		const page = growablePage({content: () => 3000});
		const files = await takeScreenshot(page, {
			...base,
			type: 'png',
			pathFor: part => path.join(directory, `shot${part}.png`),
		});
		expect(files).toHaveLength(1);
		expect(page.state.shots[0].quality).toBeUndefined();
	});

	it('restores the viewport even when the capture fails', async () => {
		const page = growablePage({content: () => 5000, failScreenshot: true});
		await expect(takeScreenshot(page, base)).rejects.toThrow('screenshot failed');
		expect(page.state.viewport).toEqual({width: 1000, height: 700});
	});

	it('sets the viewport back when growing it fails half way', async () => {
		const page = growablePage({content: () => 5000, failMeasureAfterResize: true});
		await expect(takeScreenshot(page, base)).rejects.toThrow('the page crashed');
		// It was grown (one resize) and is back at its own size
		expect(page.state.resizes[0]).toEqual({width: 1000, height: 5000});
		expect(page.state.viewport).toEqual({width: 1000, height: 700});
		expect(page.state.shots).toEqual([]);
	});

	it('uses the scroll strategy for a page without a fixed viewport instead of leaving it grown', async () => {
		const page = growablePage({content: () => 5000, noViewport: true});
		const logs = [];
		const files = await takeScreenshot(page, {
			...base,
			log(message) {
				logs.push(message);
			},
		});
		expect(files).toHaveLength(1);
		expect(page.state.resizes).toEqual([]);
		expect(page.state.shots[0]).toMatchObject({fullPage: true});
		expect(page.state.shots[0].clip).toBeUndefined();
		expect(logs[0]).toContain('needs a page with a fixed viewport');
	});

	it('is not used for a viewport capture', async () => {
		const page = growablePage({content: () => 5000});
		await takeScreenshot(page, {...base, fullPage: false});
		expect(page.state.resizes).toEqual([]);
		expect(page.state.shots).toEqual([{
			type: 'jpeg', quality: 80, fullPage: false, viewport: {width: 1000, height: 700},
		}]);
	});

	it('is not used by the scroll strategy, which keeps Chromium full page capture', async () => {
		const page = growablePage({content: () => 5000});
		await takeScreenshot(page, {...base, strategy: 'scroll', scrollBeforeCapture: false});
		expect(page.state.resizes).toEqual([]);
		expect(page.state.shots[0]).toMatchObject({fullPage: true});
		expect(page.state.shots[0].clip).toBeUndefined();
	});
});

describe('planSlices with room reserved for the first image', () => {
	it('is the same without a reserve', () => {
		expect(planSlices(20_276, 1, 16_000, 0)).toEqual(planSlices(20_276, 1, 16_000));
	});

	it('still fits one image when the reserve fits too', () => {
		// 15,900 + 47 = 15,947 output pixels
		expect(planSlices(15_900, 1, 16_000, 47)).toEqual([{y: 0, height: 15_900}]);
	});

	it('needs a second slice when only the reserve does not fit any more', () => {
		expect(planSlices(15_980, 1, 16_000, 47)).toEqual([
			{y: 0, height: 15_953},
			{y: 15_953, height: 27},
		]);
	});

	it('makes the first slice shorter by the reserve and keeps the others at the maximum', () => {
		const slices = planSlices(60_000, 1, 16_000, 47);
		expect(slices[0]).toEqual({y: 0, height: 15_953});
		expect(slices[1]).toEqual({y: 15_953, height: 16_000});
	});

	it('counts the reserve in output pixels at a scale factor of 3', () => {
		// 47 css px = 141 px: (4000 - 141) / 3 = 1286 css px, 3858 + 141 = 3999 px
		const slices = planSlices(20_276, 3, 4000, 47);
		expect(slices[0].height).toBe(1286);
		expect((slices[0].height * 3) + (47 * 3)).toBeLessThanOrEqual(4000);
		expect(slices[1].height).toBe(1333);
	});

	it('covers the document without gaps or overlap and keeps the first image within the limit', () => {
		const cases = [];
		for (const dpr of [1, 1.5, 2, 2.625, 3]) {
			for (const max of [16_000, 4000, 1234]) {
				for (const reserved of [24, 47]) {
					cases.push(...[1, 999, 4000, 16_001, 20_276, 60_000].map(height => ({
						dpr, max, reserved, height,
					})));
				}
			}
		}

		for (const {dpr, max, reserved, height} of cases) {
			const slices = planSlices(height, dpr, max, reserved);
			const starts = slices.map(slice => slice.y);
			const expectedStarts = slices.map((_, index) => slices.slice(0, index).reduce((sum, slice) => sum + slice.height, 0));
			expect(starts).toEqual(expectedStarts);
			expect(slices.every(slice => slice.height > 0)).toBe(true);
			expect(slices.reduce((sum, slice) => sum + slice.height, 0)).toBe(height);
			if (slices.length > 1) {
				expect((slices[0].height * dpr) + Math.ceil(reserved * dpr)).toBeLessThanOrEqual(max + 1e-9);
			}
		}
	});

	it('keeps a CSS pixel for the first slice however small the maximum is', () => {
		const slices = planSlices(10, 3, 100, 47);
		expect(slices[0].height).toBeGreaterThanOrEqual(1);
		expect(slices.reduce((sum, slice) => sum + slice.height, 0)).toBe(10);
	});
});

describe('takeScreenshot with a status bar', () => {
	let directory;

	beforeEach(() => {
		directory = fs.mkdtempSync(path.join(os.tmpdir(), 'capture-bar-'));
	});

	afterEach(() => {
		fs.rmSync(directory, {recursive: true, force: true});
	});

	const pathFor = part => path.join(directory, `shot${part}-abc1234.jpeg`);
	const base = {
		pathFor,
		type: 'jpeg',
		fullPage: true,
		scrollBeforeCapture: false,
		maxImageHeight: 16_000,
	};
	// A status bar double: compose puts a marker in front of the png and sizes the result by quality
	const fakeBar = ({reserveCss = 47, bytes = () => 20} = {}) => {
		const calls = [];
		return {
			calls,
			reserveCss,
			async compose(png, settings) {
				calls.push({png, ...settings});
				return Buffer.concat([Buffer.from('BAR'), Buffer.alloc(bytes(settings))]);
			},
		};
	};

	const scrollPage = ({height, dpr = 1, bytes}) => {
		const shots = [];
		return {
			shots,
			async evaluate(fn) {
				if (String(fn).includes('scrollTo')) {
					return undefined;
				}

				return {
					height, width: 1000, viewportHeight: 700, deviceScaleFactor: dpr,
				};
			},
			async screenshot(options) {
				shots.push(options);
				return Buffer.from(typeof bytes === 'function' ? Array.from({length: bytes(options)}, () => 7) : 'PNGDATA');
			},
			waitForLoadState: async () => undefined,
		};
	};

	it('composites the bar into a viewport capture, taken as a lossless png, and writes the result', async () => {
		const page = scrollPage({height: 700});
		const bar = fakeBar();
		const files = await takeScreenshot(page, {...base, fullPage: false, statusBar: bar});
		expect(page.shots).toEqual([{type: 'png', fullPage: false}]);
		expect(bar.calls).toHaveLength(1);
		expect(bar.calls[0]).toMatchObject({type: 'jpeg', quality: 80});
		expect(bar.calls[0].png.toString()).toBe('PNGDATA');
		expect(fs.readFileSync(files[0]).subarray(0, 3).toString()).toBe('BAR');
	});

	it('composites into a full page that fits one image', async () => {
		const page = scrollPage({height: 3000});
		const bar = fakeBar();
		const files = await takeScreenshot(page, {...base, statusBar: bar});
		expect(files).toEqual([pathFor('')]);
		expect(page.shots).toEqual([{type: 'png', fullPage: true}]);
		expect(bar.calls).toHaveLength(1);
	});

	it('steps the JPEG quality down after the compositing, from the one capture', async () => {
		const page = scrollPage({height: 3000});
		const bar = fakeBar({bytes: ({quality}) => (quality > 60 ? 5 * 1024 * 1024 : 100)});
		const files = await takeScreenshot(page, {...base, statusBar: bar});
		expect(bar.calls.map(call => call.quality)).toEqual([80, 70, 60]);
		// The capture itself was taken once, not once per quality
		expect(page.shots).toHaveLength(1);
		expect(fs.readFileSync(files[0]).length).toBe(103);
	});

	it('encodes a png with the same type and no quality', async () => {
		const page = scrollPage({height: 3000});
		const bar = fakeBar();
		await takeScreenshot(page, {
			...base,
			type: 'png',
			pathFor: part => path.join(directory, `shot${part}.png`),
			statusBar: bar,
		});
		expect(bar.calls).toHaveLength(1);
		expect(bar.calls[0]).toMatchObject({type: 'png', quality: undefined});
	});

	it('puts the bar on the first part only and makes the first part leave room for it', async () => {
		const page = scrollPage({height: 20_276, dpr: 1, bytes: () => 10});
		const bar = fakeBar();
		const files = await takeScreenshot(page, {...base, statusBar: bar});
		expect(files).toEqual([pathFor('-part1'), pathFor('-part2')]);
		expect(bar.calls).toHaveLength(1);
		expect(page.shots.map(shot => shot.clip.height)).toEqual([15_953, 4323]);
		// The first slice was a png for the bar, the second a jpeg as usual
		expect(page.shots[0]).toMatchObject({type: 'png', fullPage: true});
		expect(page.shots[1]).toMatchObject({type: 'jpeg', quality: 80});
		expect(fs.readFileSync(files[0]).subarray(0, 3).toString()).toBe('BAR');
		expect(fs.readFileSync(files[1]).subarray(0, 3).toString()).not.toBe('BAR');
	});

	it('does not shorten anything for a bar that takes no room (overlay)', async () => {
		const page = scrollPage({height: 20_276, bytes: () => 10});
		const bar = fakeBar({reserveCss: 0});
		await takeScreenshot(page, {...base, statusBar: bar});
		expect(page.shots.map(shot => shot.clip.height)).toEqual([16_000, 4276]);
		expect(bar.calls).toHaveLength(1);
	});

	it('works with the grow-viewport strategy: the bar is on the first clip only', async () => {
		const page = growablePage({content: () => 20_276});
		const bar = fakeBar();
		const files = await takeScreenshot(page, {
			...base,
			strategy: 'grow-viewport',
			grow: noWait,
			statusBar: bar,
		});
		expect(files).toHaveLength(2);
		expect(page.state.shots.map(shot => shot.clip.height)).toEqual([15_953, 4323]);
		expect(page.state.shots[0]).toMatchObject({type: 'png', fullPage: false});
		expect(bar.calls).toHaveLength(1);
		expect(page.state.viewport).toEqual({width: 1000, height: 700});
	});

	it('is not needed: without a status bar nothing is composited and a jpeg is captured directly', async () => {
		const page = scrollPage({height: 3000});
		await takeScreenshot(page, base);
		expect(page.shots).toEqual([{type: 'jpeg', quality: 80, fullPage: true}]);
	});
});
