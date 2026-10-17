import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {describe, expect, it} from 'vitest';
import {checkRenderedHtml} from './assert-rendered-html.mjs';

const SCRIPT = path.join(import.meta.dirname, 'assert-rendered-html.mjs');

// What GitHub's renderer made of <img ... width="600" height="5755">: cut to 2000, width scaled
const strip = '<a href="x"><img src="c" alt="part 1 of 3" width="209" height="2000" style="max-width: 100%; height: auto; max-height: 2000px;"></a>';
// What it leaves alone: only a width
const kept = '<a href="x"><img src="c" alt="part 1 of 3" width="600" style="max-width: 100%;"></a>';
// A normal image with both attributes
const sized = '<a href="x"><img src="c" width="540" height="405" style="max-width: 100%; height: auto; max-height: 405px;"></a>';

describe('checkRenderedHtml', () => {
	it('accepts width-only tall parts', () => {
		const result = checkRenderedHtml(`${kept}<br>${kept}<br>${kept}`, {images: 3, minImageWidth: 500, noHeightAttribute: true});
		expect(result.failures).toEqual([]);
		expect(result.images).toEqual([{width: 600, height: undefined}, {width: 600, height: undefined}, {width: 600, height: undefined}]);
	});

	it('fails the narrow strips GitHub makes of tall parts', () => {
		const result = checkRenderedHtml(`${strip}<br>${strip}`, {images: 2, minImageWidth: 500});
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toContain('2 rendered <img> narrower than 500 px');
		expect(result.failures[0]).toContain('#1 width=209 height=2000');
		const noHeight = checkRenderedHtml(strip, {noHeightAttribute: true});
		expect(noHeight.failures[0]).toContain('heights: 2000');
	});

	it('fails an image without a width', () => {
		expect(checkRenderedHtml('<img src="c">', {minImageWidth: 500}).failures).toHaveLength(1);
	});

	it('counts the images and accepts sized ones', () => {
		expect(checkRenderedHtml(`${sized}${sized}`, {images: 2, minImageWidth: 500}).failures).toEqual([]);
		expect(checkRenderedHtml(sized, {images: 2}).failures).toEqual(['Expected 2 rendered <img>, found 1']);
		expect(checkRenderedHtml('<p>none</p>', {images: 0}).failures).toEqual([]);
	});
});

describe('the command line', () => {
	const run = (html, args) => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-rendered-html-'));
		const file = path.join(directory, 'rendered.html');
		fs.writeFileSync(file, html);
		return spawnSync(process.execPath, [SCRIPT, '--html', file, ...args], {encoding: 'utf8', env: {...process.env, GITHUB_STEP_SUMMARY: ''}});
	};

	it('exits 0 for tall parts GitHub kept', () => {
		const result = run(`${kept}${kept}`, ['--images', '2', '--min-image-width', '500', '--no-height-attr']);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('2 image(s), widths 600');
	});

	it('exits 1 with an annotation for strips', () => {
		const result = run(`${strip}${strip}`, ['--min-image-width', '500', '--title', 'Tall']);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('::error title=Tall::2 rendered <img> narrower than 500 px');
	});

	it('exits 2 for bad arguments', () => {
		expect(run(kept, ['--nope']).status).toBe(2);
		const missing = spawnSync(process.execPath, [SCRIPT], {encoding: 'utf8'});
		expect(missing.status).toBe(2);
		expect(missing.stderr).toContain('--html is required');
	});
});
