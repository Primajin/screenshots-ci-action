import {describe, expect, it} from 'vitest';
import {
	assertStatus,
	resolveStatusOptions,
	StatusValidationError,
	validateStatusCode,
} from './status.js';

describe('resolveStatusOptions', () => {
	it('validates and accepts only 200 by default', () => {
		expect(resolveStatusOptions({validate: '', positive: '', negative: ''})).toEqual({isEnabled: true, positives: [200], negatives: []});
		expect(resolveStatusOptions()).toEqual({isEnabled: true, positives: [200], negatives: []});
	});

	it('switches off only for exactly "false"', () => {
		expect(resolveStatusOptions({validate: 'false'}).isEnabled).toBe(false);
		for (const value of ['true', 'False', '0', 'no', 'off']) {
			expect(resolveStatusOptions({validate: value}).isEnabled, value).toBe(true);
		}
	});

	it('parses comma-separated lists with spaces', () => {
		expect(resolveStatusOptions({positive: '200, 201 ,301', negative: '404,500'})).toMatchObject({positives: [200, 201, 301], negatives: [404, 500]});
	});

	it('ignores codes outside 100-599 and values that are no integers', () => {
		expect(resolveStatusOptions({positive: '99,600,abc,2.5,,200e0, 204', negative: '-404,1e2,0,x'}))
			.toMatchObject({positives: [200, 204], negatives: [100]});
	});

	it('falls back to 200 when no valid positive code is left', () => {
		expect(resolveStatusOptions({positive: 'abc,42'}).positives).toEqual([200]);
	});
});

describe('validateStatusCode', () => {
	const options = overrides => resolveStatusOptions(overrides);

	it('accepts a positive code', () => {
		expect(validateStatusCode(200, options({}))).toEqual({ok: true, reason: ''});
		expect(validateStatusCode(404, options({positive: '200,404'}))).toEqual({ok: true, reason: ''});
	});

	it('accepts everything when validation is off', () => {
		expect(validateStatusCode(500, options({validate: 'false'}))).toEqual({ok: true, reason: ''});
	});

	it('fails an unlisted code with the positive set in the reason', () => {
		expect(validateStatusCode(404, options({}))).toEqual({
			ok: false,
			reason: 'HTTP status 404 is not in the configured positive status codes (200).',
		});
		expect(validateStatusCode(304, options({positive: '200,201'})).reason).toBe('HTTP status 304 is not in the configured positive status codes (200, 201).');
	});

	it('fails a negative code with the negative set in the reason', () => {
		expect(validateStatusCode(404, options({negative: '404,500'}))).toEqual({
			ok: false,
			reason: 'HTTP status 404 is in the configured negative status codes (404, 500).',
		});
	});

	it('lets a positive code win over the same negative code', () => {
		expect(validateStatusCode(404, options({positive: '404', negative: '404'})).ok).toBe(true);
	});
});

describe('assertStatus', () => {
	const respond = status => ({status: () => status});

	it('passes an accepted status', () => {
		expect(() => {
			assertStatus(respond(200), 'Desktop', resolveStatusOptions({}));
		}).not.toThrow();
	});

	it('throws a StatusValidationError that names the capture and the reason', () => {
		let caught;
		try {
			assertStatus(respond(404), 'iPhone_13', resolveStatusOptions({}));
		} catch (error) {
			caught = error;
		}

		expect(caught).toBeInstanceOf(StatusValidationError);
		expect(caught.label).toBe('iPhone_13');
		expect(caught.reason).toBe('HTTP status 404 is not in the configured positive status codes (200).');
		expect(caught.message).toBe('HTTP status validation failed for iPhone_13: HTTP status 404 is not in the configured positive status codes (200).');
	});

	it('does not validate a navigation without a response (about:blank, data:)', () => {
		expect(() => {
			assertStatus(null, 'Desktop', resolveStatusOptions({}));
		}).not.toThrow();
	});

	it('does not throw when validation is off', () => {
		expect(() => {
			assertStatus(respond(500), 'Desktop', resolveStatusOptions({validate: 'false'}));
		}).not.toThrow();
	});
});
