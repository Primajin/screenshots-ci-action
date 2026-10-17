import {describe, expect, it} from 'vitest';
import {DEFAULT_COMMENT_OPTIONS, resolveCommentOptions, sanitizeTag} from './comment-options.js';

const resolve = (inputs = {}) => resolveCommentOptions(name => inputs[name] ?? '');

describe('resolveCommentOptions', () => {
	it('uses the defaults for empty inputs', () => {
		const {options, warnings} = resolve();
		expect(options).toEqual(DEFAULT_COMMENT_OPTIONS);
		expect(warnings).toEqual([]);
		expect(options).toMatchObject({
			comment: true,
			layout: 'details',
			open: 'none',
			groupBy: 'capture',
			imageWidth: 600,
			mode: 'update',
			tag: 'screenshots',
			headline: 'Screenshots',
			footer: true,
		});
	});

	it('accepts every valid enum value, in any case', () => {
		for (const layout of ['details', 'INLINE', ' Links ']) {
			expect(resolve({'comment-layout': layout}).options.layout).toBe(layout.trim().toLowerCase());
		}

		for (const open of ['none', 'first', 'ALL']) {
			expect(resolve({'comment-open': open}).options.open).toBe(open.toLowerCase());
		}

		for (const groupBy of ['capture', 'all', 'none']) {
			expect(resolve({'comment-group-by': groupBy}).options.groupBy).toBe(groupBy);
		}

		for (const mode of ['update', 'New']) {
			expect(resolve({'comment-mode': mode}).options.mode).toBe(mode.toLowerCase());
		}
	});

	it('warns and falls back to the default for an unknown enum value', () => {
		const {options, warnings} = resolve({
			'comment-layout': 'accordion',
			'comment-open': 'some',
			'comment-group-by': 'device',
			'comment-mode': 'append',
		});
		expect(options).toMatchObject({
			layout: 'details',
			open: 'none',
			groupBy: 'capture',
			mode: 'update',
		});
		expect(warnings).toHaveLength(4);
		expect(warnings[0]).toBe('Unknown comment-layout "accordion"; use details, inline, links. Using "details".');
		expect(warnings.join('\n')).toContain('comment-mode "append"');
	});

	it('parses the switches like the other boolean inputs', () => {
		for (const off of ['false', 'FALSE', '0', 'no', 'off', ' Off ']) {
			expect(resolve({comment: off}).options.comment).toBe(false);
			expect(resolve({'comment-footer': off}).options.footer).toBe(false);
		}

		for (const on of ['true', 'yes', '1', 'whatever']) {
			expect(resolve({comment: on}).options.comment).toBe(true);
			expect(resolve({'comment-footer': on}).options.footer).toBe(true);
		}
	});

	it('parses the image width', () => {
		expect(resolve({'comment-image-width': '0'}).options.imageWidth).toBe(0);
		expect(resolve({'comment-image-width': ' 320 '}).options.imageWidth).toBe(320);
		expect(resolve({'comment-image-width': ''}).options.imageWidth).toBe(600);
	});

	it('warns about an invalid image width and uses the default', () => {
		for (const bad of ['-5', '1.5', 'wide', '600px']) {
			const {options, warnings} = resolve({'comment-image-width': bad});
			expect(options.imageWidth).toBe(600);
			expect(warnings).toEqual([
				`Invalid comment-image-width "${bad}"; use a whole number of CSS pixels, 0 for no width attribute. Using 600.`,
			]);
		}
	});

	it('trims the headline and falls back for a blank one', () => {
		expect(resolve({'comment-headline': '  Preview  '}).options.headline).toBe('Preview');
		expect(resolve({'comment-headline': ' '.repeat(3)}).options.headline).toBe('Screenshots');
	});

	it('uses the tag and falls back to the default for an empty one', () => {
		expect(resolve({'comment-tag': 'tall'}).options.tag).toBe('tall');
		expect(resolve({'comment-tag': ' '}).options.tag).toBe('screenshots');
	});
});

describe('sanitizeTag', () => {
	it('keeps words, dots, dashes and spaces', () => {
		expect(sanitizeTag('my tag.v2-a_b')).toBe('my tag.v2-a_b');
	});

	it('cannot close the hidden HTML comment', () => {
		expect(sanitizeTag('x --> <script>')).not.toMatch(/[<>]/v);
		expect(sanitizeTag('a-->b')).toBe('a---b');
		expect(sanitizeTag('--!>')).toBe('----');
	});
});
