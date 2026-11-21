// HTTP status validation of the navigation, the same rules, parsing and wording as
// Primajin/webapp-console-log-action (utils.js there), so both actions behave alike.
// The functions are pure: the inputs are passed in, nothing is read from the environment.

/**
 Parses a comma-separated list of HTTP status codes from an input.
 @param {string} [input] The input value.
 @returns {number[]} Array of parsed status codes (whole numbers from 100 to 599, anything else is ignored).
 */
const parseStatusCodes = input => input ? input.split(',').map(s => Number(s.trim())).filter(n => Number.isSafeInteger(n) && n >= 100 && n <= 599) : [];

/**
 Resolves the validate-status, positive-statuses and negative-statuses inputs.
 @param {{validate?: string, positive?: string, negative?: string}} inputs The raw inputs.
 @returns {{isEnabled: boolean, positives: number[], negatives: number[]}} Validation is on unless validate-status is exactly "false"; the positive codes default to [200] when none is configured.
 */
export function resolveStatusOptions({validate, positive, negative} = {}) {
	const positives = parseStatusCodes(positive);
	return {
		isEnabled: validate !== 'false',
		positives: positives.length > 0 ? positives : [200],
		negatives: parseStatusCodes(negative),
	};
}

/**
 Determines whether the given HTTP status code is acceptable.
 Positive codes take precedence: if the code is in the positive set, it passes.
 If validation is disabled, all codes pass.
 If the code is in the negative set, it fails.
 If the code is not in either set, it fails (unlisted codes are treated as failures).
 @param {number} statusCode The HTTP response status code.
 @param {{isEnabled: boolean, positives: number[], negatives: number[]}} options What resolveStatusOptions returned.
 @returns {{ok: boolean, reason: string}} Result object with ok flag and reason string.
 */
export function validateStatusCode(statusCode, {isEnabled, positives, negatives}) {
	if (!isEnabled || positives.includes(statusCode)) {
		return {ok: true, reason: ''};
	}

	if (negatives.includes(statusCode)) {
		return {
			ok: false,
			reason: `HTTP status ${statusCode} is in the configured negative status codes (${negatives.join(', ')}).`,
		};
	}

	return {
		ok: false,
		reason: `HTTP status ${statusCode} is not in the configured positive status codes (${positives.join(', ')}).`,
	};
}

/**
 The error of a navigation whose HTTP status failed the validation.
 */
export class StatusValidationError extends Error {
	/**
	 Creates the error of a failed navigation.
	 @param {string} label The capture whose navigation failed (the label it has in the comment).
	 @param {string} reason Why the status failed, from validateStatusCode.
	 */
	constructor(label, reason) {
		super(`HTTP status validation failed for ${label}: ${reason}`);
		this.name = 'StatusValidationError';
		this.label = label;
		this.reason = reason;
	}
}

/**
 Checks the response of a navigation. A navigation without an HTTP response (about:blank, a data: URL) has no status and is not validated.
 @param {{status: () => number} | null} response What page.goto resolved to (the final response, after redirects).
 @param {string} label The capture the navigation belongs to.
 @param {{isEnabled: boolean, positives: number[], negatives: number[]}} options What resolveStatusOptions returned.
 @throws {StatusValidationError} When the status is not acceptable.
 */
export function assertStatus(response, label, options) {
	if (!response) {
		return;
	}

	const {ok, reason} = validateStatusCode(response.status(), options);
	if (!ok) {
		throw new StatusValidationError(label, reason);
	}
}
