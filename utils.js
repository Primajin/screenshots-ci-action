// Pure helpers (no browser, no GitHub context) so they can be unit tested.

const DEFAULT_WAITUNTIL_OPTION = 'networkidle';
const DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT = 30000; // 30 seconds

// Values accepted by Playwright's page.goto({ waitUntil }).
const PLAYWRIGHT_WAITUNTIL_OPTIONS = [
  'load',
  'domcontentloaded',
  'networkidle',
  'commit',
];

// Legacy Puppeteer values mapped onto their closest Playwright equivalent.
// Playwright has a single network-idle mode (no network connections for 500ms),
// which is closest to Puppeteer's networkidle0; networkidle2 is approximated.
const LEGACY_WAITUNTIL_MAP = {
  networkidle0: 'networkidle',
  networkidle2: 'networkidle',
};

const DEVICES_DOCS_URL =
  'https://github.com/microsoft/playwright/blob/main/packages/playwright-core/src/server/deviceDescriptorsSource.json';

/**
 * Resolve the `waitUntil` input to a Playwright value.
 * Unknown / empty values fall back to the default.
 * @param {string} [input]
 * @returns {{ value: string, fallback: boolean, mappedFrom?: string }}
 */
function mapWaitUntil(input) {
  const raw = `${input || ''}`.trim().toLowerCase();
  if (!raw) {
    return { value: DEFAULT_WAITUNTIL_OPTION, fallback: false };
  }
  if (PLAYWRIGHT_WAITUNTIL_OPTIONS.includes(raw)) {
    return { value: raw, fallback: false };
  }
  if (Object.prototype.hasOwnProperty.call(LEGACY_WAITUNTIL_MAP, raw)) {
    return {
      value: LEGACY_WAITUNTIL_MAP[raw],
      fallback: false,
      mappedFrom: raw,
    };
  }
  return { value: DEFAULT_WAITUNTIL_OPTION, fallback: true };
}

function levenshtein(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] =
        a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, row[j], row[j - 1]);
      prev = tmp;
    }
  }
  return row[b.length];
}

const normalize = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Case-insensitive "did you mean" suggestions for an unknown device name.
 * @param {string} name
 * @param {string[]} deviceNames
 * @param {number} [limit]
 * @returns {string[]}
 */
function findCloseDevices(name, deviceNames, limit = 5) {
  const needle = normalize(name);
  if (!needle) {
    return [];
  }
  const scored = [];
  for (const candidate of deviceNames) {
    const hay = normalize(candidate);
    let score;
    if (hay === needle) {
      score = 0;
    } else if (hay.includes(needle) || needle.includes(hay)) {
      score = 1 + Math.abs(hay.length - needle.length) / 100;
    } else {
      const distance = levenshtein(needle, hay);
      if (distance <= 3) {
        score = 2 + distance;
      }
    }
    if (score !== undefined) {
      scored.push({ candidate, score });
    }
  }
  return scored
    .sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
    .slice(0, limit)
    .map(({ candidate }) => candidate);
}

/**
 * Split the comma separated `devices` input and resolve each entry against the
 * known device names. An entry matching exactly one device case-insensitively
 * is accepted and normalised to that device's name.
 * @param {string} input
 * @param {string[]} deviceNames
 * @returns {{ valid: string[], invalid: { name: string, suggestions: string[] }[] }}
 */
function resolveDevices(input, deviceNames) {
  const requested = `${input || ''}`
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  const valid = [];
  const invalid = [];
  for (const name of requested) {
    if (deviceNames.includes(name)) {
      valid.push(name);
      continue;
    }
    const ci = deviceNames.filter(
      (d) => d.toLowerCase() === name.toLowerCase()
    );
    if (ci.length === 1) {
      valid.push(ci[0]);
      continue;
    }
    invalid.push({ name, suggestions: findCloseDevices(name, deviceNames) });
  }
  return { valid: [...new Set(valid)], invalid };
}

/**
 * Human readable error for unknown devices.
 * @param {{ name: string, suggestions: string[] }[]} invalid
 * @returns {string}
 */
function formatInvalidDevicesError(invalid) {
  const lines = ['Following device names are invalid:'];
  for (const { name, suggestions } of invalid) {
    lines.push(
      suggestions.length
        ? `- "${name}" (did you mean: ${suggestions
            .map((s) => `"${s}"`)
            .join(', ')}?)`
        : `- "${name}"`
    );
  }
  lines.push(
    `See Playwright's device list for valid names: ${DEVICES_DOCS_URL}`
  );
  return lines.join('\n');
}

/**
 * Build the arguments for Playwright's page.waitForSelector.
 * - visible -> state "visible", hidden -> state "hidden", else "attached".
 *   If both are set, "visible" wins.
 * - timeout: empty/invalid/negative -> 30000, 0 -> 0 (timeout disabled).
 * @param {{ visible?: boolean, hidden?: boolean, timeout?: string|number }} opts
 * @returns {{ state: 'attached'|'visible'|'hidden', timeout: number }}
 */
function buildSelectorWaitOptions({ visible, hidden, timeout } = {}) {
  let state = 'attached';
  if (visible) {
    state = 'visible';
  } else if (hidden) {
    state = 'hidden';
  }

  const raw = `${
    timeout === undefined || timeout === null ? '' : timeout
  }`.trim();
  let parsed = raw === '' ? NaN : Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    parsed = DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT;
  }
  return { state, timeout: parsed };
}

module.exports = {
  DEFAULT_WAITUNTIL_OPTION,
  DEFAULT_WAIT_FOR_SELECTOR_TIMEOUT,
  DEVICES_DOCS_URL,
  PLAYWRIGHT_WAITUNTIL_OPTIONS,
  buildSelectorWaitOptions,
  findCloseDevices,
  formatInvalidDevicesError,
  mapWaitUntil,
  resolveDevices,
};
