import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from 'vitest';
import {createRunFiles, ensureScreenshotsDir} from './screenshots-dir.js';

let root;

beforeEach(async () => {
	root = await fs.mkdtemp(path.join(os.tmpdir(), 'screenshots-dir-'));
});

afterEach(async () => {
	await fs.rm(root, {recursive: true, force: true});
});

describe('ensureScreenshotsDir', () => {
	it('creates the directory with its parents, so a part can be written into it', async () => {
		const directory = path.join(root, 'nested', 'screenshots');
		await ensureScreenshotsDir(directory);
		await fs.writeFile(path.join(directory, 'iPhone_13-part1-abc1234.jpeg'), 'x');
		expect(await fs.readdir(directory)).toEqual(['iPhone_13-part1-abc1234.jpeg']);
	});

	it('works for a path with a trailing slash, like the action uses', async () => {
		const directory = `${path.join(root, 'screenshots')}/`;
		await ensureScreenshotsDir(directory);
		expect(await fs.readdir(directory)).toEqual([]);
	});

	it('keeps what is in an existing directory', async () => {
		await fs.writeFile(path.join(root, 'a.png'), 'x');
		await ensureScreenshotsDir(root);
		expect(await fs.readdir(root)).toEqual(['a.png']);
	});
});

describe('createRunFiles', () => {
	it('starts empty', () => {
		expect(createRunFiles(root).names()).toEqual([]);
	});

	it('answers the written files as names relative to the directory, in the order written', () => {
		const files = createRunFiles(root);
		files.add([path.join(root, 'b.jpeg'), path.join(root, 'a-part1.jpeg')]);
		files.add([path.join(root, 'a-part2.jpeg')]);
		expect(files.names()).toEqual(['b.jpeg', 'a-part1.jpeg', 'a-part2.jpeg']);
	});

	it('lists a file once, even when it is written again', () => {
		const files = createRunFiles(root);
		files.add([path.join(root, 'a.png')]);
		files.add([path.join(root, 'a.png')]);
		expect(files.names()).toEqual(['a.png']);
	});

	it('works for a directory with a trailing slash and for relative paths, like the action uses', () => {
		const files = createRunFiles('screenshots/');
		files.add(['screenshots/desktopPage540x405-abc1234.jpeg']);
		expect(files.names()).toEqual(['desktopPage540x405-abc1234.jpeg']);
	});

	it('ignores files of the directory that this call did not write', async () => {
		await fs.writeFile(path.join(root, 'earlier-call.jpeg'), 'x');
		const files = createRunFiles(root);
		files.add([path.join(root, 'mine.jpeg')]);
		expect(files.names()).toEqual(['mine.jpeg']);
	});

	it('ignores paths outside of the directory and the directory itself', () => {
		const files = createRunFiles(root);
		files.add([path.join(root, '..', 'other.jpeg'), root, '/elsewhere/x.png']);
		expect(files.names()).toEqual([]);
	});
});
