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
import {ensureScreenshotsDir, listScreenshots} from './screenshots-dir.js';

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
		expect(await listScreenshots(directory)).toEqual([]);
	});

	it('keeps what is in an existing directory', async () => {
		await fs.writeFile(path.join(root, 'a.png'), 'x');
		await ensureScreenshotsDir(root);
		expect(await listScreenshots(root)).toEqual(['a.png']);
	});
});

describe('listScreenshots', () => {
	it('lists the files', async () => {
		await fs.writeFile(path.join(root, 'b.png'), 'x');
		await fs.writeFile(path.join(root, 'a.png'), 'x');
		const names = await listScreenshots(root);
		expect(names.toSorted((x, y) => x.localeCompare(y))).toEqual(['a.png', 'b.png']);
	});

	it('answers an empty list for an empty directory', async () => {
		expect(await listScreenshots(root)).toEqual([]);
	});

	it('answers an empty list for a missing directory instead of throwing', async () => {
		expect(await listScreenshots(path.join(root, 'missing'))).toEqual([]);
	});

	it('still throws for other errors, like a file where the directory should be', async () => {
		const file = path.join(root, 'file');
		await fs.writeFile(file, 'x');
		await expect(listScreenshots(file)).rejects.toThrow();
	});
});
