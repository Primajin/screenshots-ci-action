#!/usr/bin/env node
// Zero-dependency assertions for the screenshots produced by the action.
// Used by the scenario workflows (.github/workflows/_pass_*.yml). Exits 1 and
// prints every violated expectation when something is off.
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

// SOF0-SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
const isSofMarker = (marker) =>
  marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

// Returns 'png', 'jpeg' or undefined based on the magic bytes.
export function detectFormat(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return 'png';
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpeg';
  }

  return undefined;
}

function parsePngSize(buffer) {
  // 8 byte signature, 4 byte length, "IHDR", then width and height (uint32 BE).
  if (buffer.length < 24 || buffer.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('PNG without IHDR chunk');
  }

  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function parseJpegSize(buffer) {
  let offset = 2;
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) {
      throw new Error(`JPEG marker expected at byte ${offset}`);
    }

    const marker = buffer[offset + 1];
    if (marker === 0xff) {
      offset += 1; // Fill byte
      continue;
    }

    if (isSofMarker(marker)) {
      return {
        width: buffer.readUInt16BE(offset + 7),
        height: buffer.readUInt16BE(offset + 5),
      };
    }

    offset += 2 + buffer.readUInt16BE(offset + 2);
  }

  throw new Error('JPEG without SOF marker');
}

// Reads {format, width, height} from the file header without any dependency.
export function parseImage(buffer) {
  const format = detectFormat(buffer);
  if (format === 'png') {
    return { format, ...parsePngSize(buffer) };
  }

  if (format === 'jpeg') {
    return { format, ...parseJpegSize(buffer) };
  }

  throw new Error('neither PNG nor JPEG magic bytes');
}

// Supports "*" and "?" only, which is all the scenarios need.
export function globToRegExp(glob) {
  const source = [...glob]
    .map((character) => {
      if (character === '*') {
        return '.*';
      }

      return character === '?'
        ? '.'
        : character.replace(/[$()+.[\\\]^{|}]/g, '\\$&');
    })
    .join('');
  return new RegExp(`^${source}$`);
}

const parseDimensions = (value) => {
  const match = /^(\d+)x(\d+)$/.exec(value);
  if (!match) {
    throw new Error(`Invalid dimensions "${value}", expected WxH`);
  }

  return { width: Number(match[1]), height: Number(match[2]) };
};

// <name>-<7 hex commit hash> or <name>-<epoch millis> before the extension.
const HASH_SUFFIX = /-(?:[\da-f]{7}|\d{10,})\.[a-z]+$/;

function checkRow(row, options, errors) {
  const { name, width, height, format } = row;
  if (
    options.expectFromName &&
    globToRegExp(options.expectFromName).test(name)
  ) {
    const fromName = /(\d+)x(\d+)(?:-|\.)/.exec(name);
    if (!fromName) {
      errors.push(`${name}: no <W>x<H> in the file name`);
    } else if (
      Number(fromName[1]) !== width ||
      Number(fromName[2]) !== height
    ) {
      errors.push(
        `${name}: file name says ${fromName[1]}x${fromName[2]}, image is ${width}x${height}`
      );
    }
  }

  if (options.minHeight !== undefined && height < options.minHeight) {
    errors.push(
      `${name}: height ${height} is below the expected minimum ${options.minHeight}`
    );
  }

  if (options.maxHeight !== undefined && height > options.maxHeight) {
    errors.push(
      `${name}: height ${height} is above the expected maximum ${options.maxHeight}`
    );
  }

  if (options.type) {
    const extension = path.extname(name).slice(1);
    if (format !== options.type || extension !== options.type) {
      errors.push(
        `${name}: expected ${options.type}, got ${format} content with .${extension} extension`
      );
    }
  }

  if (options.noHash && HASH_SUFFIX.test(name)) {
    errors.push(`${name}: file name carries a commit hash or timestamp suffix`);
  }

  if (options.withHash && !HASH_SUFFIX.test(name)) {
    errors.push(`${name}: file name has no commit hash or timestamp suffix`);
  }
}

// Pure check so it can be unit tested. Returns {errors, rows}.
export function checkScreenshots(directory, options = {}) {
  const errors = [];
  const rows = [];
  const exists = fs.existsSync(directory);
  const matchGlob = options.match || '*';
  const matcher = globToRegExp(matchGlob);
  const allNames = exists ? fs.readdirSync(directory).sort() : [];
  const names = allNames.filter((name) => matcher.test(name));

  if (!exists) {
    errors.push(`Directory "${directory}" does not exist`);
  }

  for (const name of names) {
    const buffer = fs.readFileSync(path.join(directory, name));
    try {
      rows.push({ name, ...parseImage(buffer), bytes: buffer.length });
    } catch (error) {
      errors.push(`${name}: ${error.message}`);
    }
  }

  if (
    options.expectCount !== undefined &&
    names.length !== options.expectCount
  ) {
    errors.push(
      `Expected ${options.expectCount} file(s) matching "${matchGlob}", found ${
        names.length
      }: ${names.join(', ')}`
    );
  }

  for (const row of rows) {
    checkRow(row, options, errors);
  }

  for (const expectation of options.expect || []) {
    const [glob, dimensions] = expectation.split('=');
    const expected = parseDimensions(dimensions);
    const expectedMatcher = globToRegExp(glob);
    const candidates = rows.filter((row) => expectedMatcher.test(row.name));
    if (candidates.length === 0) {
      errors.push(`--expect ${expectation}: no file matches "${glob}"`);
    }

    for (const row of candidates) {
      if (row.width !== expected.width || row.height !== expected.height) {
        errors.push(
          `${row.name}: expected ${dimensions}, got ${row.width}x${row.height}`
        );
      }
    }
  }

  for (const glob of options.expectAbsent || []) {
    const absentMatcher = globToRegExp(glob);
    for (const name of allNames.filter((file) => absentMatcher.test(file))) {
      errors.push(`${name}: no file matching "${glob}" expected`);
    }
  }

  return { errors, rows };
}

export function toMarkdown(title, rows) {
  const lines = [
    `### ${title}`,
    '',
    '| File | Format | Dimensions | Size |',
    '| --- | --- | --- | --- |',
  ];
  for (const row of rows) {
    lines.push(
      `| ${row.name} | ${row.format} | ${row.width}x${row.height} | ${(
        row.bytes / 1024
      ).toFixed(1)} KiB |`
    );
  }

  return `${lines.join('\n')}\n\n`;
}

const toNumber = (name, value) => {
  if (value === undefined) {
    return undefined;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`--${name} must be a non-negative integer`);
  }

  return number;
};

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: 'string', default: 'screenshots' },
      match: { type: 'string', default: '*' },
      'expect-count': { type: 'string' },
      expect: { type: 'string', multiple: true },
      'expect-absent': { type: 'string', multiple: true },
      'expect-from-name': { type: 'string' },
      'min-height': { type: 'string' },
      'max-height': { type: 'string' },
      type: { type: 'string' },
      'no-hash': { type: 'boolean', default: false },
      'with-hash': { type: 'boolean', default: false },
      title: { type: 'string' },
      'archive-to': { type: 'string' },
    },
  });

  const { errors, rows } = checkScreenshots(values.dir, {
    match: values.match,
    expectCount: toNumber('expect-count', values['expect-count']),
    expect: values.expect,
    expectAbsent: values['expect-absent'],
    expectFromName: values['expect-from-name'],
    minHeight: toNumber('min-height', values['min-height']),
    maxHeight: toNumber('max-height', values['max-height']),
    type: values.type,
    noHash: values['no-hash'],
    withHash: values['with-hash'],
  });

  for (const row of rows) {
    console.log(
      `${row.name}: ${row.format} ${row.width}x${row.height} ${row.bytes} bytes`
    );
  }

  // Reported even on failure so reviewers see what was produced.
  if (values.title && process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      toMarkdown(values.title, rows)
    );
  }

  if (values['archive-to']) {
    fs.mkdirSync(values['archive-to'], { recursive: true });
    for (const row of rows) {
      fs.copyFileSync(
        path.join(values.dir, row.name),
        path.join(values['archive-to'], row.name)
      );
    }
  }

  if (errors.length > 0) {
    for (const error of errors) {
      console.error(`::error::${error}`);
    }

    return 1;
  }

  console.log(`OK: ${rows.length} screenshot(s) passed all assertions`);
  return 0;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exitCode = 2;
  }
}
