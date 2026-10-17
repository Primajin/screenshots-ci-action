import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {describe, expect, it} from 'vitest';
import {renderComment} from '../../comment.js';
import {checkComments, findTagged, parseComments} from './assert-pr-comment.mjs';

const BOT = 'github-actions[bot]';
const SCRIPT = path.join(import.meta.dirname, 'assert-pr-comment.mjs');

const files = ['iPhone_13-abc1234.jpeg', 'iPad_Pro_11-abc1234.jpeg'];
const uploaded = [
	{
		fileName: files[0], name: 'n1', url: 'https://x/releases/download/ci/a-abc1234.jpeg', bytes: 2048, width: 1170, height: 1992,
	},
	{
		fileName: files[1], name: 'n2', url: 'https://x/releases/download/ci/b-abc1234.jpeg', bytes: 2048, width: 1668, height: 2388,
	},
];
const body = renderComment(uploaded, files, {footer: {sha: 'def5678aaaa'}});

const comment = (id, text = body, login = BOT) => ({id, login, body: text});

describe('parseComments', () => {
	it('reads one JSON object per line and skips blank lines', () => {
		const text = `${JSON.stringify(comment(1, 'a\nb'))}\n\n${JSON.stringify(comment(2, 'c'))}\n`;
		expect(parseComments(text)).toEqual([comment(1, 'a\nb'), comment(2, 'c')]);
		expect(parseComments('')).toEqual([]);
	});
});

describe('findTagged', () => {
	it('matches the marker on the first line by the bot only', () => {
		const comments = [
			comment(1),
			comment(2, body, 'mallory'),
			comment(3, `text\n${body}`),
			comment(4, renderComment(uploaded, files, {tag: 'screenshots-2'})),
		];
		expect(findTagged(comments, 'screenshots').map(item => item.id)).toEqual([1]);
		expect(findTagged(comments, 'screenshots-2').map(item => item.id)).toEqual([4]);
	});
});

describe('checkComments', () => {
	const ok = {
		tag: 'screenshots', images: 2, detailsClosed: true, sizedImages: true,
	};

	it('accepts the default comment', () => {
		const result = checkComments([comment(7, 'unrelated'), comment(9)], {
			...ok,
			expectId: 9,
			contains: ['-abc1234.', 'Commit def5678'],
			notContains: ['<details open'],
		});
		expect(result.failures).toEqual([]);
		expect(result.comment.id).toBe(9);
		expect(result.images).toBe(2);
	});

	it('fails when there is no comment, or more than one', () => {
		expect(checkComments([], ok).failures[0]).toContain('found 0');
		const two = checkComments([comment(1), comment(2)], ok);
		expect(two.failures[0]).toBe('Expected 1 comment(s) with the marker for tag "screenshots" by github-actions[bot], found 2 (ids: 1, 2)');
		expect(checkComments([comment(1), comment(2)], {tag: 'screenshots', expectComments: 2}).failures).toEqual([]);
	});

	it('does not count comments of other tags or authors', () => {
		const result = checkComments([comment(1, body, 'mallory'), comment(2, renderComment(uploaded, files, {tag: 'links'}))], ok);
		expect(result.failures[0]).toContain('found 0');
	});

	it('checks the id of an updated or separate comment', () => {
		expect(checkComments([comment(5)], {tag: 'screenshots', expectId: 4}).failures[0]).toContain('keep id 4');
		expect(checkComments([comment(5)], {tag: 'screenshots', notId: 5}).failures[0]).toContain('separate comment');
		expect(checkComments([comment(5)], {tag: 'screenshots', notId: 4}).failures).toEqual([]);
	});

	it('counts the images', () => {
		expect(checkComments([comment(1)], {tag: 'screenshots', images: 3}).failures[0]).toContain('Expected 3 <img> in the comment, found 2');
		const links = renderComment(uploaded, files, {layout: 'links'});
		expect(checkComments([comment(1, links)], {tag: 'screenshots', noImages: true}).failures).toEqual([]);
		expect(checkComments([comment(1)], {tag: 'screenshots', noImages: true}).failures[0]).toContain('Expected no <img>');
	});

	it('fails open accordions and comments without accordions', () => {
		const open = renderComment(uploaded, files, {open: 'first'});
		expect(checkComments([comment(1, open)], {tag: 'screenshots', detailsClosed: true}).failures[0]).toContain('closed');
		const inline = renderComment(uploaded, files, {layout: 'inline'});
		expect(checkComments([comment(1, inline)], {tag: 'screenshots', detailsClosed: true}).failures[0]).toContain('use <details>');
	});

	it('fails images without width and height', () => {
		const plain = renderComment(uploaded, files, {imageWidth: 0});
		const result = checkComments([comment(1, plain)], {tag: 'screenshots', sizedImages: true});
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toContain('2 <img> without width and height');
		const links = renderComment(uploaded, files, {layout: 'links'});
		expect(checkComments([comment(1, links)], {tag: 'screenshots', sizedImages: true}).failures[0]).toContain('found no <img>');
	});

	it('checks contains and not-contains', () => {
		const result = checkComments([comment(1)], {
			tag: 'screenshots',
			contains: ['Commit def5678', 'nope'],
			notContains: ['<details>'],
		});
		expect(result.failures).toEqual([
			'The comment does not contain: nope',
			'The comment must not contain: <details>',
		]);
	});
});

describe('the command line', () => {
	const run = (comments, args) => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-pr-comment-'));
		const input = path.join(directory, 'comments.jsonl');
		fs.writeFileSync(input, comments.map(item => JSON.stringify(item)).join('\n'));
		const result = spawnSync(process.execPath, [SCRIPT, '--comments', input, ...args], {
			encoding: 'utf8',
			env: {...process.env, GITHUB_STEP_SUMMARY: ''},
		});
		return {directory, ...result};
	};

	it('exits 0 for a matching comment and 2 without a tag', () => {
		const result = run([comment(11)], ['--tag', 'screenshots', '--images', '2', '--details-closed', '--sized-images', '--contains', 'Commit def5678']);
		expect(result.status).toBe(0);
		expect(result.stdout).toContain('comment 11, 2 image(s)');

		const untagged = run([comment(11)], []);
		expect(untagged.status).toBe(2);
		expect(untagged.stderr).toContain('--tag is required');
	});

	it('writes body and id files', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-pr-comment-out-'));
		const result = run([comment(12)], ['--tag', 'screenshots', '--write-body', path.join(directory, 'body.md'), '--write-id', path.join(directory, 'id')]);
		expect(result.status).toBe(0);
		expect(fs.readFileSync(path.join(directory, 'body.md'), 'utf8')).toBe(body);
		expect(fs.readFileSync(path.join(directory, 'id'), 'utf8')).toBe('12');
	});

	it('exits 1 and annotates every failure', () => {
		const result = run([comment(13)], ['--tag', 'screenshots', '--images', '5', '--contains', 'nope', '--title', 'My check']);
		expect(result.status).toBe(1);
		expect(result.stderr).toContain('::error title=My check::Expected 5 <img>');
		expect(result.stderr).toContain('::error title=My check::The comment does not contain: nope');
	});
});
