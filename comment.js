// Renders the PR comment body for the uploaded screenshots (pure, unit tested).
// Captures of very tall pages consist of several files named
// `<name>-part<N>[-<commit hash>].<ext>`; they are shown under one heading with
// the images directly next to each other (no whitespace between the tags), so
// they read as one continuous page.

const PART = /^(.*)-part(\d+)((?:-[^.]*)?\.[A-Za-z0-9]+)$/;

/** @returns {{ group: string, part: number | null }} */
function parseFileName(fileName) {
  const match = PART.exec(fileName);
  if (!match) {
    return { group: fileName, part: null };
  }
  return { group: `${match[1]}${match[3]}`, part: Number(match[2]) };
}

function formatBytes(bytes) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * @param {{ fileName: string, name: string, url: string, bytes: number }[]} uploaded
 *   fileName is the local name, name the uploaded asset name
 * @param {string[]} allFiles every local file name, to know how many parts a
 *   capture has even when some part failed to upload
 */
function renderCommentBody(uploaded, allFiles) {
  const expectedParts = {};
  allFiles.forEach((fileName) => {
    const { group, part } = parseFileName(fileName);
    if (part !== null) {
      expectedParts[group] = Math.max(expectedParts[group] || 0, part);
    }
  });

  const groups = new Map();
  uploaded.forEach((entry) => {
    const { group, part } = parseFileName(entry.fileName);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group).push({ ...entry, part });
  });

  const blocks = [];
  groups.forEach((entries, group) => {
    entries.sort((a, b) => (a.part || 0) - (b.part || 0));
    if (entries[0].part === null) {
      const [{ name, url }] = entries;
      blocks.push({
        key: url,
        text: `## ${name}\n- ${url}\n\n<img src=${url} />\n\n`,
      });
      return;
    }
    const total = expectedParts[group];
    const size = formatBytes(entries.reduce((sum, e) => sum + e.bytes, 0));
    const heading = entries[0].name.replace(
      /-part\d+(?=(-[^.]*)?\.[^.]+$)/,
      ''
    );
    const lines = entries.map((e) => `- part ${e.part} of ${total}: ${e.url}`);
    const images = entries
      .map((e) => `<img src=${e.url} alt="part ${e.part} of ${total}" />`)
      .join('');
    blocks.push({
      key: entries[0].url,
      text: `## ${heading} (${total} parts, ${size} total)\n${lines.join(
        '\n'
      )}\n\n${images}\n\n`,
    });
  });

  return blocks
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((block) => block.text)
    .join('');
}

module.exports = { formatBytes, parseFileName, renderCommentBody };
