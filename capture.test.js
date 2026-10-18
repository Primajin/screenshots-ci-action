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
	captureJpegWithinLimit,
	cssGranule,
	isScrollEnabled,
	nextScrollOffset,
	partSuffix,
	planSlices,
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
