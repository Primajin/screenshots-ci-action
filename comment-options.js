// Resolves the comment-* inputs (pure, unit tested). Enum inputs that hold an
// unknown value log a warning and fall back to the default; empty means default.

const LAYOUTS = ['details', 'inline', 'links'];
const OPEN_MODES = ['none', 'first', 'all'];
const GROUP_BYS = ['capture', 'all', 'none'];
const MODES = ['update', 'new'];

const DEFAULT_COMMENT_OPTIONS = {
	comment: true,
	layout: 'details',
	open: 'none',
	groupBy: 'capture',
	imageWidth: 600,
	mode: 'update',
	tag: 'screenshots',
	headline: 'Screenshots',
	footer: true,
};

const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);

// Switches that are on by default: only these values turn them off.
const isSwitchedOn = input =>
	!FALSE_VALUES.has(String(input ?? '').trim().toLowerCase());

function resolveEnum({name, allowed, fallback}, input, warnings) {
	const raw = String(input ?? '').trim().toLowerCase();
	if (raw === '') {
		return fallback;
	}

	if (allowed.includes(raw)) {
		return raw;
	}

	warnings.push(
		`Unknown ${name} "${String(input).trim()}"; use ${allowed.join(', ')}. Using "${fallback}".`,
	);
	return fallback;
}

function resolveImageWidth(input, fallback, warnings) {
	const raw = String(input ?? '').trim();
	if (raw === '') {
		return fallback;
	}

	const value = Number(raw);
	if (Number.isSafeInteger(value) && value >= 0) {
		return value;
	}

	warnings.push(
		`Invalid comment-image-width "${raw}"; use a whole number of CSS pixels, 0 for no width attribute. Using ${fallback}.`,
	);
	return fallback;
}

// The tag ends up inside an HTML comment, so keep it to harmless characters.
function sanitizeTag(input) {
	return String(input ?? '').trim().replaceAll(/[^\w \-.]/gv, '-');
}

/**
 Resolve the comment-* inputs.
 @param {(name: string) => string} getInput Reads one raw input value.
 @returns {{options: object, warnings: string[]}} The options and what to warn about.
 */
function resolveCommentOptions(getInput) {
	const defaults = DEFAULT_COMMENT_OPTIONS;
	const warnings = [];
	const options = {
		comment: isSwitchedOn(getInput('comment') || String(defaults.comment)),
		layout: resolveEnum({name: 'comment-layout', allowed: LAYOUTS, fallback: defaults.layout}, getInput('comment-layout'), warnings),
		open: resolveEnum({name: 'comment-open', allowed: OPEN_MODES, fallback: defaults.open}, getInput('comment-open'), warnings),
		groupBy: resolveEnum({name: 'comment-group-by', allowed: GROUP_BYS, fallback: defaults.groupBy}, getInput('comment-group-by'), warnings),
		imageWidth: resolveImageWidth(getInput('comment-image-width'), defaults.imageWidth, warnings),
		mode: resolveEnum({name: 'comment-mode', allowed: MODES, fallback: defaults.mode}, getInput('comment-mode'), warnings),
		tag: sanitizeTag(getInput('comment-tag')) || defaults.tag,
		headline: String(getInput('comment-headline') ?? '').trim() || defaults.headline,
		footer: isSwitchedOn(getInput('comment-footer') || String(defaults.footer)),
	};
	return {options, warnings};
}

export {
	DEFAULT_COMMENT_OPTIONS,
	GROUP_BYS,
	LAYOUTS,
	MODES,
	OPEN_MODES,
	resolveCommentOptions,
	sanitizeTag,
};
