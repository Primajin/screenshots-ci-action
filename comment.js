// Renders the PR comment body for the uploaded screenshots (pure, unit tested).
// Captures of very tall pages consist of several files named
// `<name>-part<N>[-<commit hash>].<ext>`; they are shown under one heading with
// the images directly next to each other (no whitespace between the tags), so
// they read as one continuous page.

const PART = /^(?<before>.*)-part(?<part>\d+)(?<after>(?:-[^.]*)?\.[\dA-Za-z]+)$/v;
const PART_IN_NAME = /-part\d+(?=(?:-[^.]*)?\.[^.]+$)/v;

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

function renderGroup(entries, total) {
	const [first] = entries;
	if (first.part === null) {
		return {
			key: first.url,
			text: `## ${first.name}\n- ${first.url}\n\n<img src=${first.url} />\n\n`,
		};
	}

	const size = formatBytes(entries.reduce((sum, entry) => sum + entry.bytes, 0));
	const heading = first.name.replace(PART_IN_NAME, '');
	const lines = entries.map(entry => `- part ${entry.part} of ${total}: ${entry.url}`);
	const images = entries
		.map(entry => `<img src=${entry.url} alt="part ${entry.part} of ${total}" />`)
		.join('');
	return {
		key: first.url,
		text: `## ${heading} (${total} parts, ${size} total)\n${lines.join('\n')}\n\n${images}\n\n`,
	};
}

// Uploaded: {fileName (local), name (asset name), url, bytes}[]
// allFiles: every local file name
function renderCommentBody(uploaded, allFiles) {
	const expectedParts = countParts(allFiles);
	const groups = new Map();
	for (const entry of uploaded) {
		const {group, part} = parseFileName(entry.fileName);
		groups.set(group, [...groups.get(group) ?? [], {...entry, part}]);
	}

	const blocks = [...groups].map(([group, entries]) =>
		renderGroup(
			entries.toSorted((a, b) => (a.part ?? 0) - (b.part ?? 0)),
			expectedParts.get(group),
		),
	);

	return blocks
		.toSorted((a, b) => a.key.localeCompare(b.key))
		.map(block => block.text)
		.join('');
}

export {formatBytes, parseFileName, renderCommentBody};
