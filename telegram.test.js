import {mkdtemp, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import telegram from './telegram.js';

const okResponse = result => ({
	ok: true,
	status: 200,
	statusText: 'OK',
	json: async () => ({ok: true, result}),
});

const makeFiles = async names => {
	const directory = `${await mkdtemp(path.join(os.tmpdir(), 'modern-telegram-'))}/`;
	for (const name of names) {
		// eslint-disable-next-line no-await-in-loop
		await writeFile(`${directory}${name}`, `data-${name}`);
	}

	return directory;
};

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn(async () => okResponse({messageId: 1})));
	vi.spyOn(console, 'log').mockImplementation(() => {});
	vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('telegram', () => {
	test('sends a single file with sendPhoto only', async () => {
		const directory = await makeFiles(['a.png']);
		await telegram({
			teleChatId: '42', teltBotToken: 'TOKEN', files: ['a.png'], path: directory,
		});

		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, options] = fetch.mock.calls[0];
		expect(url).toBe('https://api.telegram.org/botTOKEN/sendPhoto');
		expect(options.method).toBe('POST');
		expect(options.body.get('chat_id')).toBe('42');
		expect(options.body.get('disable_notification')).toBe('true');
		expect(options.body.get('photo').name).toBe('a.png');
		expect(await options.body.get('photo').text()).toBe('data-a.png');
	});

	test('sends 2-10 files as one media group with captions', async () => {
		const directory = await makeFiles(['a.png', 'b.png']);
		await telegram({
			teleChatId: '42', teltBotToken: 'TOKEN', files: ['a.png', 'b.png'], path: directory,
		});

		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, options] = fetch.mock.calls[0];
		expect(url).toBe('https://api.telegram.org/botTOKEN/sendMediaGroup');
		expect(JSON.parse(options.body.get('media'))).toEqual([
			{type: 'photo', caption: 'a.png', media: 'attach://file0'},
			{type: 'photo', caption: 'b.png', media: 'attach://file1'},
		]);
		expect(await options.body.get('file1').text()).toBe('data-b.png');
	});

	test('splits more than 10 files into groups of 10 with a pause between', async () => {
		vi.useFakeTimers();
		const names = Array.from({length: 12}, (_, index) => `f${index}.png`);
		const directory = await makeFiles(names);
		const promise = telegram({
			teleChatId: '42', teltBotToken: 'TOKEN', files: names, path: directory,
		});
		await vi.runAllTimersAsync();
		await promise;

		expect(fetch).toHaveBeenCalledTimes(2);
		expect(JSON.parse(fetch.mock.calls[0][1].body.get('media'))).toHaveLength(10);
		expect(JSON.parse(fetch.mock.calls[1][1].body.get('media'))).toHaveLength(2);
		expect(names).toHaveLength(12);
	});

	test('never sends a one-item media group (11 and 21 files)', async () => {
		vi.useFakeTimers();
		for (const count of [11, 21]) {
			fetch.mockClear();
			const names = Array.from({length: count}, (_, index) => `f${index}.png`);
			// eslint-disable-next-line no-await-in-loop
			const directory = await makeFiles(names);
			const promise = telegram({
				teleChatId: '42', teltBotToken: 'TOKEN', files: names, path: directory,
			});
			// eslint-disable-next-line no-await-in-loop
			await vi.runAllTimersAsync();
			// eslint-disable-next-line no-await-in-loop
			await promise;

			const sizes = fetch.mock.calls.map(([, options]) => JSON.parse(options.body.get('media')).length);
			expect(sizes.every(size => size >= 2 && size <= 10)).toBe(true);
			expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(count);
		}
	});

	test('does not sleep after the final chunk', async () => {
		vi.useFakeTimers();
		const names = Array.from({length: 12}, (_, index) => `f${index}.png`);
		const directory = await makeFiles(names);
		const promise = telegram({
			teleChatId: '42', teltBotToken: 'TOKEN', files: names, path: directory,
		});
		await vi.advanceTimersByTimeAsync(0);
		await vi.advanceTimersByTimeAsync(1999);
		expect(fetch).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		await promise;
		expect(fetch).toHaveBeenCalledTimes(2);
		expect(vi.getTimerCount()).toBe(0);
	});

	test('sets the MIME type from the file extension', async () => {
		const directory = await makeFiles(['a.png', 'b.jpg', 'c.JPEG']);
		await telegram({
			teleChatId: '42', teltBotToken: 'TOKEN', files: ['a.png', 'b.jpg', 'c.JPEG'], path: directory,
		});
		const {body} = fetch.mock.calls[0][1];
		expect(body.get('file0').type).toBe('image/png');
		expect(body.get('file1').type).toBe('image/jpeg');
		expect(body.get('file2').type).toBe('image/jpeg');
	});

	test('logs API failures without the token and does not throw', async () => {
		fetch.mockResolvedValueOnce({
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			json: async () => ({ok: false, description: 'Unauthorized'}),
		});
		const directory = await makeFiles(['a.png']);
		await expect(telegram({
			teleChatId: '42', teltBotToken: 'SECRET', files: ['a.png'], path: directory,
		})).resolves.toBeUndefined();

		expect(console.error).toHaveBeenCalledTimes(1);
		const [error] = console.error.mock.calls[0];
		expect(error.message).toBe('Telegram sendPhoto failed: 401 Unauthorized');
		expect(error.message).not.toContain('SECRET');
	});

	test('does nothing for an empty file list', async () => {
		await telegram({
			teleChatId: '42', teltBotToken: 'TOKEN', files: [], path: '/nowhere/',
		});
		expect(fetch).not.toHaveBeenCalled();
	});
});
