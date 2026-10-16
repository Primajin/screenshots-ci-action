import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  checkScreenshots,
  detectFormat,
  globToRegExp,
  main,
  parseImage,
  toMarkdown,
} from './assert-screenshots.mjs';

const png = (width, height) => {
  const buffer = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
};

// SOI, an APP0 segment (must be skipped), then SOF0 with height/width.
const jpeg = (width, height, marker = 0xc0) => {
  const app0 = Buffer.from([0xff, 0xe0, 0x00, 0x04, 0x00, 0x00]);
  const sof = Buffer.alloc(11);
  sof[0] = 0xff;
  sof[1] = marker;
  sof.writeUInt16BE(9, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, sof]);
};

describe('parseImage', () => {
  it('reads PNG dimensions from the IHDR chunk', () => {
    expect(parseImage(png(1170, 1992))).toEqual({
      format: 'png',
      width: 1170,
      height: 1992,
    });
  });

  it('reads JPEG dimensions from the SOF marker, skipping other segments', () => {
    expect(parseImage(jpeg(540, 405))).toEqual({
      format: 'jpeg',
      width: 540,
      height: 405,
    });
    expect(parseImage(jpeg(10, 20, 0xc2))).toMatchObject({
      width: 10,
      height: 20,
    });
  });

  it('rejects unknown content and truncated files', () => {
    expect(() => parseImage(Buffer.from('GIF89a'))).toThrow('magic bytes');
    expect(() => parseImage(png(1, 1).subarray(0, 20))).toThrow('IHDR');
    expect(() =>
      parseImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 2]))
    ).toThrow('SOF');
    expect(() =>
      parseImage(
        Buffer.from([
          0xff, 0xd8, 0xff, 0xe0, 0x00, 0x02, 0x11, 0x22, 0x33, 0x44,
        ])
      )
    ).toThrow('marker expected');
  });

  it('detects the format by magic bytes only', () => {
    expect(detectFormat(png(1, 1))).toBe('png');
    expect(detectFormat(jpeg(1, 1))).toBe('jpeg');
    expect(detectFormat(Buffer.alloc(2))).toBeUndefined();
  });
});

describe('globToRegExp', () => {
  it('supports * and ? and escapes everything else', () => {
    expect(globToRegExp('desktopPage*').test('desktopPage540x405.png')).toBe(
      true
    );
    expect(globToRegExp('a?c.png').test('abc.png')).toBe(true);
    expect(globToRegExp('a.png').test('abpng')).toBe(false);
  });
});

describe('checkScreenshots', () => {
  let directory;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-screenshots-'));
  });

  afterEach(() => {
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const write = (name, buffer) =>
    fs.writeFileSync(path.join(directory, name), buffer);

  it('passes when every expectation holds', () => {
    write('desktopPage540x405-abc1234.png', png(540, 405));
    write('iPhone_13-abc1234.png', png(1170, 1992));
    const { errors, rows } = checkScreenshots(directory, {
      expectCount: 2,
      expect: ['iPhone_13*=1170x1992'],
      expectFromName: 'desktopPage*',
      type: 'png',
      withHash: true,
      minHeight: 405,
      maxHeight: 1992,
    });
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
  });

  it('derives the expected size from the file name', () => {
    write('desktopPage540x405.png', png(540, 405));
    write('desktopPage600x450.png', png(600, 400));
    const { errors } = checkScreenshots(directory, {
      match: 'desktopPage*',
      expectFromName: 'desktopPage*',
    });
    expect(errors).toEqual([
      'desktopPage600x450.png: file name says 600x450, image is 600x400',
    ]);
  });

  it('reports a name without dimensions', () => {
    write('iPhone_13.png', png(1, 1));
    expect(checkScreenshots(directory, { expectFromName: '*' }).errors).toEqual(
      ['iPhone_13.png: no <W>x<H> in the file name']
    );
  });

  it('flags wrong count, wrong size and unmatched expectations', () => {
    write('a-1234567.png', png(10, 10));
    const { errors } = checkScreenshots(directory, {
      expectCount: 2,
      expect: ['a*=20x20', 'b*=1x1'],
    });
    expect(errors).toEqual([
      'Expected 2 file(s) matching "*", found 1: a-1234567.png',
      'a-1234567.png: expected 20x20, got 10x10',
      '--expect b*=1x1: no file matches "b*"',
    ]);
  });

  it('flags height bounds', () => {
    write('a.png', png(10, 100));
    expect(checkScreenshots(directory, { minHeight: 200 }).errors[0]).toMatch(
      'below the expected minimum 200'
    );
    expect(checkScreenshots(directory, { maxHeight: 50 }).errors[0]).toMatch(
      'above the expected maximum 50'
    );
  });

  it('checks type by magic bytes and extension', () => {
    write('real.jpeg', jpeg(5, 5));
    write('fake.png', jpeg(5, 5));
    write('renamed.jpeg', png(5, 5));
    const { errors } = checkScreenshots(directory, { type: 'jpeg' });
    expect(errors).toEqual([
      'fake.png: expected jpeg, got jpeg content with .png extension',
      'renamed.jpeg: expected jpeg, got png content with .jpeg extension',
    ]);
  });

  it('detects hash and timestamp suffixes', () => {
    write('desktopPage540x405-abc1234.png', png(1, 1));
    write('iPhone_13-1700000000000.png', png(1, 1));
    write('iPad_Pro_11.png', png(1, 1));
    const noHash = checkScreenshots(directory, { noHash: true }).errors;
    expect(noHash).toHaveLength(2);
    expect(noHash[0]).toMatch('desktopPage540x405-abc1234.png');
    const withHash = checkScreenshots(directory, { withHash: true }).errors;
    expect(withHash).toEqual([
      'iPad_Pro_11.png: file name has no commit hash or timestamp suffix',
    ]);
  });

  it('supports absence checks and reports corrupt files', () => {
    write('desktopPage1x1.png', png(1, 1));
    write('broken.png', Buffer.from('nope'));
    const { errors } = checkScreenshots(directory, {
      expectAbsent: ['desktopPage*', 'nothing*'],
    });
    expect(errors).toEqual([
      'broken.png: neither PNG nor JPEG magic bytes',
      'desktopPage1x1.png: no file matching "desktopPage*" expected',
    ]);
  });

  it('fails for a missing directory', () => {
    expect(
      checkScreenshots(path.join(directory, 'missing'), { expectAbsent: ['*'] })
        .errors
    ).toEqual([
      'Directory "' + path.join(directory, 'missing') + '" does not exist',
    ]);
  });

  it('rejects malformed dimensions', () => {
    write('a.png', png(1, 1));
    expect(() => checkScreenshots(directory, { expect: ['a*=big'] })).toThrow(
      'expected WxH'
    );
  });
});

describe('toMarkdown', () => {
  it('renders a table row per file', () => {
    expect(
      toMarkdown('Title', [
        { name: 'a.png', format: 'png', width: 2, height: 3, bytes: 2048 },
      ])
    ).toBe(
      '### Title\n\n| File | Format | Dimensions | Size |\n| --- | --- | --- | --- |\n| a.png | png | 2x3 | 2.0 KiB |\n\n'
    );
  });
});

describe('main (CLI)', () => {
  let directory;
  let summary;

  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'assert-screenshots-'));
    summary = path.join(directory, 'summary.md');
    fs.mkdirSync(path.join(directory, 'shots'));
    fs.writeFileSync(
      path.join(directory, 'shots', 'iPhone_13.jpeg'),
      jpeg(1170, 1992)
    );
    vi.stubEnv('GITHUB_STEP_SUMMARY', summary);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    fs.rmSync(directory, { recursive: true, force: true });
  });

  const run = (...args) =>
    main(['--dir', path.join(directory, 'shots'), ...args]);

  it('returns 0, writes the summary and archives the files on success', () => {
    const archive = path.join(directory, 'archive');
    expect(
      run(
        '--expect',
        'iPhone_13*=1170x1992',
        '--title',
        'T',
        '--archive-to',
        archive
      )
    ).toBe(0);
    expect(fs.readFileSync(summary, 'utf8')).toContain(
      '| iPhone_13.jpeg | jpeg | 1170x1992 |'
    );
    expect(fs.existsSync(path.join(archive, 'iPhone_13.jpeg'))).toBe(true);
  });

  it('returns 1 and annotates every failure', () => {
    expect(run('--expect-count', '2', '--type', 'png')).toBe(1);
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid numbers', () => {
    expect(() => run('--min-height', 'abc')).toThrow('non-negative integer');
  });
});
