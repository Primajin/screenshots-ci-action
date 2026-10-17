// Renders the PR comment body for the uploaded screenshots (pure, unit tested).
//
// Captures of very tall pages consist of several files named
// `<name>-part<N>[-<commit hash>].<ext>`; the parts of one capture are shown
// together, with the images directly next to each other (no whitespace between
// the tags), so they read as one continuous page.
//
// The look is configurable (see README "PR comments"):
// - layout:  details (a collapsible <details> per group), inline (a heading per
//            group, images shown directly) or links (only a list of links)
// - open:    which <details> start open (none, first, all)
// - groupBy: one group per capture, one for everything, or one per image
// - imageWidth: widest display width in CSS pixels; every <img> gets width and
//   height from the known pixel size, so the page does not jump when the
//   pictures load (0 = no width and height attributes)

const PART = /^(?<before>.*)-part(?<part>\d+)(?<after>(?:-[^.]*)?\.[\dA-Za-z]+)$/v;
const EXTENSION = /\.[\dA-Za-z]+$/v;
// The suffix the action appends: 7 character commit sha or a Date.now() fallback
const HASH_SUFFIX = /-(?:[\da-f]{7}|\d{13})$/v;
const DESKTOP = /^desktopPage(?<width>\d+)x\d+$/v;

const DEFAULT_OPTIONS = {
	layout: 'details',
	open: 'none',
	groupBy: 'capture',
	imageWidth: 600,
	headline: 'Screenshots',
	tag: 'screenshots',
	footer: null,
};

// Hidden first line that lets the next run find (and edit) its earlier comment.
function commentMarker(tag) {
	return `<!-- screenshots-ci-action:${tag} -->`;
}

const escapeHtml = value =>
	String(value)
		.replaceAll('&', '&amp;')
		.replaceAll('"', '&quot;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;');

const formatNumber = value => value.toLocaleString('en-US');

// Splits "<name>-part<N>[-<hash>].<ext>" into the name without the part and the
// part number (null for files that are not parts).
function parseFileName(fileName) {
	const match = PART.exec(fileName);
	if (!match) {
		return {group: fileName, part: null};
	}

	return {
		group: `${match.groups.before}${match.groups.after}`,
		part: Number(match.groups.part),
	};
}

function formatBytes(bytes) {
	return bytes >= 1024 * 1024
		? `${(bytes / 1024 / 1024).toFixed(1)} MB`
		: `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

// Readable name of a capture: "iPhone_13-abc1234.jpeg" -> "iPhone 13",
// "desktopPage540x405-abc1234.jpeg" -> "Desktop 540".
function captureLabel(group) {
	const base = group.replace(EXTENSION, '').replace(HASH_SUFFIX, '');
	const desktop = DESKTOP.exec(base);
	return desktop ? `Desktop ${desktop.groups.width}` : base.replaceAll('_', ' ');
}

// Highest part number per group, from every local file name, so the part count
// is known even when a part failed to upload.
function countParts(allFiles) {
	const expectedParts = new Map();
	for (const fileName of allFiles) {
		const {group, part} = parseFileName(fileName);
		if (part !== null) {
			expectedParts.set(group, Math.max(expectedParts.get(group) ?? 0, part));
		}
	}

	return expectedParts;
}

// Display size in CSS pixels: never wider than `imageWidth`, aspect ratio kept.
function displaySize({width, height}, imageWidth) {
	if (!imageWidth || !width || !height) {
		return undefined;
	}

	const shown = Math.min(width, imageWidth);
	return {width: shown, height: Math.max(1, Math.round((height * shown) / width))};
}

function sizeAttributes(entry, imageWidth) {
	const shown = displaySize(entry, imageWidth);
	return shown ? ` width="${shown.width}" height="${shown.height}"` : '';
}

// Pixel size of a capture: as wide as its widest part, as tall as all parts.
function captureDimensions(entries) {
	if (entries.some(entry => !entry.width || !entry.height)) {
		return undefined;
	}

	return {
		width: Math.max(...entries.map(entry => entry.width)),
		height: entries.reduce((sum, entry) => sum + entry.height, 0),
	};
}

function buildCaptures(uploaded, allFiles) {
	const expectedParts = countParts(allFiles);
	const byGroup = new Map();
	for (const entry of uploaded) {
		const {group, part} = parseFileName(entry.fileName);
		byGroup.set(group, [...byGroup.get(group) ?? [], {...entry, part}]);
	}

	const captures = [...byGroup].map(([group, entries]) => {
		const sorted = entries.toSorted((a, b) => (a.part ?? 0) - (b.part ?? 0));
		const total = expectedParts.get(group) ?? null;
		const missing = total === null
			? []
			: Array.from({length: total}, (_, index) => index + 1)
				.filter(part => sorted.every(entry => entry.part !== part));
		return {
			group, label: captureLabel(group), entries: sorted, total, missing,
		};
	});

	// Desktop sizes first, then the devices; numbers sort numerically
	const rank = capture => capture.group.startsWith('desktopPage') ? 0 : 1;
	return captures.toSorted((a, b) =>
		rank(a) - rank(b)
		|| a.group.localeCompare(b.group, 'en', {numeric: true}),
	);
}

// Captures that have no uploaded file at all (everything failed)
function findLostCaptures(captures, allFiles) {
	const known = new Set(captures.map(capture => capture.group));
	const lost = new Map();
	for (const fileName of allFiles) {
		const {group} = parseFileName(fileName);
		if (!known.has(group)) {
			lost.set(group, captureLabel(group));
		}
	}

	return lost.values().toArray();
}

function failureText(missing) {
	return `part${missing.length > 1 ? 's' : ''} ${missing.join(', ')} failed to upload`;
}

function partSuffix(capture, entry) {
	return entry.part === null ? '' : `part ${entry.part} of ${capture.total}`;
}

function imageTag(capture, entry, imageWidth) {
	const suffix = partSuffix(capture, entry);
	const alt = escapeHtml(suffix ? `${capture.label}, ${suffix}` : capture.label);
	return `<img src="${escapeHtml(entry.url)}" alt="${alt}"${sizeAttributes(entry, imageWidth)}>`;
}

function formatDimensions(dimensions) {
	return dimensions?.width && dimensions.height
		? `${formatNumber(dimensions.width)} × ${formatNumber(dimensions.height)} px`
		: '';
}

const joinMeta = parts => parts.filter(Boolean).join(' · ');

// Groups: {title, meta, captures: [{...capture, entries}]}
function buildGroups(captures, groupBy) {
	if (groupBy === 'all') {
		const entries = captures.flatMap(capture => capture.entries);
		const bytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
		return [{
			title: 'All captures',
			meta: joinMeta([
				`${captures.length} capture${captures.length === 1 ? '' : 's'}`,
				`${entries.length} image${entries.length === 1 ? '' : 's'}`,
				formatBytes(bytes),
			]),
			captures,
			combined: true,
		}];
	}

	if (groupBy === 'none') {
		return captures.flatMap(capture => capture.entries.map(entry => {
			const suffix = partSuffix(capture, entry);
			return {
				title: suffix ? `${capture.label} · ${suffix}` : capture.label,
				meta: joinMeta([formatDimensions(entry), formatBytes(entry.bytes)]),
				captures: [{...capture, entries: [entry]}],
				combined: false,
			};
		}));
	}

	return captures.map(capture => {
		const bytes = capture.entries.reduce((sum, entry) => sum + entry.bytes, 0);
		return {
			title: capture.label,
			meta: joinMeta([
				formatDimensions(captureDimensions(capture.entries)),
				capture.total > 1 ? `${capture.total} parts` : '',
				formatBytes(bytes),
				capture.missing.length > 0 ? failureText(capture.missing) : '',
			]),
			captures: [capture],
			combined: false,
		};
	});
}

// Links and images of one group (details and inline layout)
function renderBody(group, imageWidth) {
	const sections = group.captures.map(capture => {
		const heading = group.combined
			? `**${escapeHtml(capture.label)}** · ${joinMeta([
				formatDimensions(captureDimensions(capture.entries)),
				capture.total > 1 ? `${capture.total} parts` : '',
				capture.missing.length > 0 ? failureText(capture.missing) : '',
			])}\n\n`
			: '';
		const links = capture.entries.map(entry => {
			const suffix = partSuffix(capture, entry);
			return `- ${suffix ? `${suffix}: ` : ''}${entry.url}`;
		});
		const images = capture.entries
			.map(entry => imageTag(capture, entry, imageWidth))
			.join('');
		return `${heading}${links.join('\n')}\n\n${images}\n\n`;
	});
	return sections.join('');
}

// "[part 1 of 3](url)" per image, "[image](url)" for a single one
function captureLinks(capture) {
	return capture.entries.map(entry => {
		const suffix = partSuffix(capture, entry);
		return `[${suffix ? escapeHtml(suffix) : 'image'}](${entry.url})`;
	});
}

function isOpen(open, index) {
	return open === 'all' || (open === 'first' && index === 0);
}

function renderGroup(group, index, options) {
	const title = escapeHtml(group.title);
	const meta = escapeHtml(group.meta);
	if (options.layout === 'details') {
		const open = isOpen(options.open, index) ? ' open' : '';
		return `<details${open}>\n<summary><b>${title}</b> · ${meta}</summary>\n\n${renderBody(group, options.imageWidth)}</details>\n\n`;
	}

	if (options.layout === 'inline') {
		return `#### ${title} · ${meta}\n\n${renderBody(group, options.imageWidth)}`;
	}

	if (group.combined) {
		const nested = group.captures.map(capture =>
			`  - **${escapeHtml(capture.label)}**: ${captureLinks(capture).join(' · ')}`,
		);
		return `- **${title}** · ${meta}\n${nested.join('\n')}\n`;
	}

	const links = group.captures.flatMap(capture => captureLinks(capture));
	return `- **${title}** · ${meta}: ${links.join(' · ')}\n`;
}

function renderFooter(footer) {
	if (!footer) {
		return '';
	}

	const parts = [
		footer.sha ? `Commit ${footer.sha.slice(0, 7)}` : '',
		footer.runUrl ? `[workflow run](${footer.runUrl})` : '',
	].filter(Boolean);
	return parts.length > 0 ? `<sub>${parts.join(' · ')}</sub>\n` : '';
}

// Failures that the group headings do not show
function renderWarnings(captures, lost, groupBy) {
	const lines = [
		...groupBy === 'capture'
			? []
			: captures
				.filter(capture => capture.missing.length > 0)
				.map(capture => `${escapeHtml(capture.label)}: ${failureText(capture.missing)}`),
		...lost.map(label => `${escapeHtml(label)}: failed to upload`),
	];
	return lines.length > 0
		? `> [!WARNING]\n${lines.map(line => `> ${line}`).join('\n')}\n\n`
		: '';
}

/**
 Render the PR comment.
 @param {{fileName: string, name: string, url: string, bytes: number, width?: number, height?: number}[]} uploaded The uploaded images (fileName is the local file name).
 @param {string[]} allFiles Every local file name, so failed parts are known.
 @param {object} [options] layout, open, groupBy, imageWidth, headline, tag and footer ({sha, runUrl} or null).
 @returns {string} The markdown, starting with the hidden marker line; empty when nothing was uploaded.
 */
function renderComment(uploaded, allFiles, options = {}) {
	const settings = {...DEFAULT_OPTIONS, ...options};
	const captures = buildCaptures(uploaded, allFiles);
	if (captures.length === 0) {
		return '';
	}

	const groups = buildGroups(captures, settings.groupBy);
	const lost = findLostCaptures(captures, allFiles);
	const list = groups.map((group, index) => renderGroup(group, index, settings));
	return [
		`${commentMarker(settings.tag)}\n`,
		`### ${escapeHtml(settings.headline)}\n\n`,
		// A bullet list needs no trailing blank line per item, close it once
		settings.layout === 'links' ? `${list.join('')}\n` : list.join(''),
		renderWarnings(captures, lost, settings.groupBy),
		renderFooter(settings.footer),
	].join('');
}

export {
	DEFAULT_OPTIONS,
	captureLabel,
	commentMarker,
	displaySize,
	formatBytes,
	parseFileName,
	renderComment,
};
