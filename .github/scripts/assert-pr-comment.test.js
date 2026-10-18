import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {describe, expect, it} from 'vitest';
import {mergeSection, renderComment} from '../../comment.js';
import {
	checkComments,
	findSections,
	findTagged,
	normalizeArgs,
	parseComments,
} from './assert-pr-comment.mjs';

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

	it('accepts a Windows line break after the marker', () => {
		const windows = comment(1, body.replace('-->\n', '-->\r\n'));
		expect(findTagged([windows], 'screenshots')).toHaveLength(1);
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

describe('normalizeArgs', () => {
	it('joins the value of a string option, also when it starts with a dash', () => {
		expect(normalizeArgs(['--contains', '-abc1234.', '--tag', 'x', '--sized-images', '--images=3', '--not-contains=-y'])).toEqual([
			'--contains=-abc1234.',
			'--tag=x',
			'--sized-images',
			'--images=3',
			'--not-contains=-y',
		]);
	});

	it('leaves a trailing option and unknown arguments alone', () => {
		expect(normalizeArgs(['--tag'])).toEqual(['--tag']);
		expect(normalizeArgs(['--nope', 'x'])).toEqual(['--nope', 'x']);
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

	it('takes values that start with a dash, in both forms (the workflow passes the file sha like that)', () => {
		const spaced = run([comment(14)], ['--tag', 'screenshots', '--contains', '-abc1234.', '--not-contains', '-zzz9999.']);
		expect(spaced.status).toBe(0);
		const joined = run([comment(14)], ['--tag', 'screenshots', '--contains=-abc1234.', '--not-contains=-zzz9999.']);
		expect(joined.status).toBe(0);
		const missing = run([comment(14)], ['--tag', 'screenshots', '--contains', '-zzz9999.']);
		expect(missing.status).toBe(1);
		expect(missing.stderr).toContain('The comment does not contain: -zzz9999.');
	});

	it('reports bad arguments as an annotation instead of crashing', () => {
		const unknown = run([comment(15)], ['--tag', 'screenshots', '--nope']);
		expect(unknown.status).toBe(2);
		expect(unknown.stderr).toContain('::error::');
		const noValue = run([comment(15)], ['--tag']);
		expect(noValue.status).toBe(2);
		expect(noValue.stderr).toContain('::error::');
		expect(noValue.stderr).not.toContain('at ');
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

describe('sections', () => {
	const entryFor = (fileName, url) => ({
		fileName, name: 'n', url, bytes: 2048, width: 1440, height: 900,
	});
	const sectionComment = (previousBody, name, slug, url) => renderComment(
		[entryFor('desktopPage1440x900-abc1234.jpeg', url)],
		['desktopPage1440x900-abc1234.jpeg'],
		{section: {name, slug}, previousBody, footer: {sha: 'def5678aaaa'}},
	);
	const first = sectionComment(undefined, 'Desktop · light', 'desktop-light', 'https://x/light');
	const second = sectionComment(first, 'Desktop · dark', 'desktop-dark', 'https://x/dark');
	const third = sectionComment(second, 'Mobile · light', 'mobile-light', 'https://x/mobile');

	it('finds the sections in the order they are in', () => {
		const {sections, problems} = findSections(third, 'screenshots');
		expect(problems).toEqual([]);
		expect(sections.map(section => section.slug)).toEqual(['desktop-light', 'desktop-dark', 'mobile-light']);
		expect(sections[1].content).toContain('https://x/dark');
		expect(sections[1].content).not.toContain('https://x/light');
		expect(sections[0].content.startsWith('<details>')).toBe(true);
	});

	it('finds none in a comment without sections, and none of another tag', () => {
		expect(findSections(body, 'screenshots').sections).toEqual([]);
		expect(findSections(third, 'other').sections).toEqual([]);
	});

	it('reports markers that are not balanced', () => {
		const open = '<!-- screenshots-ci-action:screenshots:section:a -->';
		const close = '<!-- /screenshots-ci-action:screenshots:section:a -->';
		expect(findSections(`${open}\nx\n`, 'screenshots').problems).toEqual(['The section "a" is not closed']);
		expect(findSections(`x\n${close}\n`, 'screenshots').problems[0]).toContain('has no matching start marker');
		expect(findSections(`${open}\nx\n${open.replace(':a', ':b')}\ny\n`, 'screenshots').problems[0]).toContain('"a" is not closed before');
	});

	it('checks the ordered slugs', () => {
		const ok = {tag: 'screenshots', sections: ['desktop-light', 'desktop-dark', 'mobile-light']};
		expect(checkComments([comment(1, third)], ok).failures).toEqual([]);
		expect(checkComments([comment(1, third)], {tag: 'screenshots', sections: ['desktop-dark', 'desktop-light', 'mobile-light']}).failures)
			.toEqual(['Expected the sections [desktop-dark, desktop-light, mobile-light] in this order, found [desktop-light, desktop-dark, mobile-light]']);
		expect(checkComments([comment(1, second)], ok).failures[0]).toContain('found [desktop-light, desktop-dark]');
		expect(checkComments([comment(1, body)], {tag: 'screenshots', sections: []}).failures).toEqual([]);
	});

	it('checks the content and the images of one section', () => {
		const spec = {
			tag: 'screenshots',
			sectionContains: ['desktop-dark=https://x/dark', 'desktop-dark=<summary><b>Desktop · dark</b>'],
			sectionNotContains: ['desktop-dark=https://x/light'],
			sectionImages: ['desktop-dark=1', 'mobile-light=1'],
		};
		expect(checkComments([comment(1, third)], spec).failures).toEqual([]);
		const {failures} = checkComments([comment(1, third)], {
			tag: 'screenshots',
			sectionContains: ['desktop-dark=https://x/light', 'nope=x'],
			sectionNotContains: ['desktop-dark=https://x/dark'],
			sectionImages: ['desktop-dark=2'],
		});
		expect(failures).toEqual([
			'The section "desktop-dark" does not contain: https://x/light',
			'There is no section "nope" to check for the text: x',
			'The section "desktop-dark" must not contain: https://x/dark',
			'Expected 2 <img> in the section "desktop-dark", found 1',
		]);
	});

	it('checks that a section is left untouched', () => {
		const before = findSections(second, 'screenshots').sections.find(section => section.slug === 'desktop-dark').content;
		const same = findSections(third, 'screenshots').sections.find(section => section.slug === 'desktop-dark').content;
		expect(same).toBe(before);
		expect(checkComments([comment(1, third)], {tag: 'screenshots', sectionEquals: [{slug: 'desktop-dark', content: before}]}).failures).toEqual([]);
		const changed = sectionComment(third, 'Desktop · dark', 'desktop-dark', 'https://x/dark-new');
		expect(checkComments([comment(1, changed)], {tag: 'screenshots', sectionEquals: [{slug: 'desktop-dark', content: before}]}).failures)
			.toEqual(['The section "desktop-dark" is not the same as before (it must be left untouched)']);
		const light = findSections(third, 'screenshots').sections[0].content;
		expect(checkComments([comment(1, changed)], {tag: 'screenshots', sectionEquals: [{slug: 'desktop-light', content: light}]}).failures).toEqual([]);
	});

	it('fails unbalanced markers', () => {
		const broken = mergeSection(undefined, 'screenshots', 'a', 'A', {headline: 'x'}).replace('<!-- /screenshots-ci-action:screenshots:section:a -->', '');
		expect(checkComments([comment(1, broken)], {tag: 'screenshots', sections: ['a']}).failures[0]).toBe('The section "a" is not closed');
	});

	it('does not look at sections without a section option', () => {
		expect(checkComments([comment(1, third)], {tag: 'screenshots'}).failures).toEqual([]);
	});

	it('is wired to the command line, with files to compare a section before and after', () => {
		const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-sections-'));
		const input = (text, id) => {
			const file = path.join(directory, `c${id}.jsonl`);
			fs.writeFileSync(file, JSON.stringify(comment(id, text)));
			return file;
		};

		const run = (text, id, args) => spawnSync(process.execPath, [SCRIPT, '--comments', input(text, id), '--tag', 'screenshots', ...args], {
			encoding: 'utf8',
			env: {...process.env, GITHUB_STEP_SUMMARY: ''},
		});
		const written = path.join(directory, 'dark.md');
		expect(run(second, 1, ['--sections', 'desktop-light,desktop-dark', '--write-section', `desktop-dark=${written}`]).status).toBe(0);
		expect(fs.readFileSync(written, 'utf8')).toContain('https://x/dark');
		const same = run(third, 2, ['--sections', 'desktop-light, desktop-dark, mobile-light', '--section-equals', `desktop-dark=${written}`, '--section-images', 'mobile-light=1', '--section-contains', 'mobile-light=https://x/mobile']);
		expect(same.status, same.stderr).toBe(0);
		const changed = run(sectionComment(third, 'Desktop · dark', 'desktop-dark', 'https://x/other'), 3, ['--section-equals', `desktop-dark=${written}`]);
		expect(changed.status).toBe(1);
		expect(changed.stderr).toContain('is not the same as before');
		const wrongOrder = run(third, 4, ['--sections', 'mobile-light']);
		expect(wrongOrder.status).toBe(1);
		expect(wrongOrder.stderr).toContain('Expected the sections [mobile-light] in this order');
	});
});
