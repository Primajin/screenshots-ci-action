// Resolves the comment-* inputs (pure, unit tested). Enum inputs that hold an
// unknown value log a warning and fall back to the default; empty means default.

const LAYOUTS = ['details', 'inline', 'links'];
const OPEN_MODES = ['none', 'first', 'all'];
const GROUP_BYS = ['capture', 'all', 'none'];
const MODES = ['update', 'new'];
const IMAGE_HEIGHTS = ['auto-ratio', 'none'];

const DEFAULT_COMMENT_OPTIONS = {
	comment: true,
	layout: 'details',
	open: 'none',
	groupBy: 'capture',
	imageWidth: 600,
	imageHeight: 'auto-ratio',
	mode: 'update',
	tag: 'screenshots',
	headline: 'Screenshots',
	footer: true,
	section: null,
};

const FALSE_VALUES = new Set(['false', '0', 'no', 'off']);
const TRUE_VALUES = new Set(['true', '1', 'yes', 'on']);

// Switches that are on by default: only the false values turn them off. Other
// values keep the switch on, but a typo like "fasle" gets a warning.
function resolveSwitch(name, input, fallback, warnings) {
	const raw = String(input ?? '').trim().toLowerCase();
	if (raw === '') {
		return fallback;
	}

	if (FALSE_VALUES.has(raw)) {
		return false;
	}

	if (!TRUE_VALUES.has(raw)) {
		warnings.push(`Unknown ${name} "${String(input).trim()}"; use true or false. Using "${fallback}".`);
		return fallback;
	}

	return true;
}

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

// The tag ends up inside an HTML comment, so keep it to harmless characters:
// letters and digits of any language, underscore, dot, dash and space.
function sanitizeTag(input) {
	return String(input ?? '').trim().replaceAll(/[^\p{Letter}\p{Number} \-._]/gv, '-');
}

function resolveTag(input, fallback, warnings) {
	const raw = String(input ?? '').trim();
	const tag = sanitizeTag(raw);
	if (tag !== raw) {
		warnings.push(`The comment-tag "${raw}" contains characters other than letters, digits, space, dot, dash and underscore; they were replaced with "-": "${tag}".`);
	}

	return tag || fallback;
}

const MAX_SECTION_NAME_LENGTH = 80;
const MAX_SECTION_SLUG_LENGTH = 60;

// The title of a section: one line without control characters, so it is safe
// as the title of a <details>.
function sanitizeSectionName(input) {
	return String(input ?? '')
		.replaceAll(/\p{Control}/gv, ' ')
		.replaceAll(/\s+/gv, ' ')
		.trim();
}

// The part of a section marker that identifies it: lower case letters and digits
// (of any language) with single dashes in between. Names that differ only in
// case, spacing or punctuation are the same section.
function slugifySectionName(name) {
	return name
		.toLowerCase()
		.replaceAll(/[^\p{Letter}\p{Number}]+/gv, '-')
		// Runs of other characters are one dash, so there is at most one at each end
		.replace(/^-/v, '')
		.replace(/-$/v, '')
		.slice(0, MAX_SECTION_SLUG_LENGTH)
		.replace(/-$/v, '');
}

// The comment-section input: null (the call owns the whole comment) or {name, slug}
function resolveSection(input, {mode, groupBy}, warnings) {
	const raw = String(input ?? '').trim();
	if (raw === '') {
		return null;
	}

	if (mode === 'new') {
		warnings.push(`comment-section "${raw}" is ignored with comment-mode new: a section is merged into the comment this action posted earlier (comment-mode update). Posting a whole new comment.`);
		return null;
	}

	let name = sanitizeSectionName(raw);
	if (name.length > MAX_SECTION_NAME_LENGTH) {
		name = name.slice(0, MAX_SECTION_NAME_LENGTH).trim();
		warnings.push(`The comment-section "${raw}" is longer than ${MAX_SECTION_NAME_LENGTH} characters and was cut to "${name}".`);
	}

	const slug = slugifySectionName(name);
	if (slug === '') {
		// Ignoring it would make this call own the whole comment and wipe the other sections
		throw new Error(`The comment-section "${raw}" has no letters or digits to identify the section by; give it a name with at least one, or leave comment-section empty for a comment of its own.`);
	}

	if (groupBy !== 'capture') {
		warnings.push(`comment-group-by "${groupBy}" is ignored with comment-section: the captures of a call are always one section.`);
	}

	return {name, slug};
}

/**
 Resolve the comment-* inputs.
 @param {(name: string) => string} getInput Reads one raw input value.
 @returns {{options: object, warnings: string[]}} The options and what to warn about.
 @throws {Error} For a comment-section that has no letter or digit to identify it by.
 */
function resolveCommentOptions(getInput) {
	const defaults = DEFAULT_COMMENT_OPTIONS;
	const warnings = [];
	const options = {
		comment: resolveSwitch('comment', getInput('comment'), defaults.comment, warnings),
		layout: resolveEnum({name: 'comment-layout', allowed: LAYOUTS, fallback: defaults.layout}, getInput('comment-layout'), warnings),
		open: resolveEnum({name: 'comment-open', allowed: OPEN_MODES, fallback: defaults.open}, getInput('comment-open'), warnings),
		groupBy: resolveEnum({name: 'comment-group-by', allowed: GROUP_BYS, fallback: defaults.groupBy}, getInput('comment-group-by'), warnings),
		imageWidth: resolveImageWidth(getInput('comment-image-width'), defaults.imageWidth, warnings),
		imageHeight: resolveEnum({name: 'comment-image-height', allowed: IMAGE_HEIGHTS, fallback: defaults.imageHeight}, getInput('comment-image-height'), warnings),
		mode: resolveEnum({name: 'comment-mode', allowed: MODES, fallback: defaults.mode}, getInput('comment-mode'), warnings),
		tag: resolveTag(getInput('comment-tag'), defaults.tag, warnings),
		headline: String(getInput('comment-headline') ?? '').trim() || defaults.headline,
		footer: resolveSwitch('comment-footer', getInput('comment-footer'), defaults.footer, warnings),
	};
	options.section = resolveSection(getInput('comment-section'), options, warnings);
	return {options, warnings};
}

export {
	DEFAULT_COMMENT_OPTIONS,
	GROUP_BYS,
	IMAGE_HEIGHTS,
	LAYOUTS,
	MODES,
	OPEN_MODES,
	resolveCommentOptions,
	sanitizeTag,
	slugifySectionName,
};
